import { Notification } from 'electron';
import { db } from '../db';
import { GpuService, TaskService } from '../db/service';

export class TimerManager {
  private waitTimers: Map<number, NodeJS.Timeout> = new Map();
  private gpuNotificationState: Map<number, number> = new Map(); // gpuId -> lastNotifiedMinutes
  private broadcaster: ((channel: string, ...args: any[]) => void) | null = null;

  constructor() {
    this.syncActiveTimers();
    this.ensureGpuIdleState();
    // Start GPU idle checker & Task Nagging
    setInterval(() => {
         this.checkGpuIdle();
         this.checkTaskNagging();
    }, 60000); // Check every minute
  }

  public setBroadcaster(broadcaster: (channel: string, ...args: any[]) => void) {
    this.broadcaster = broadcaster;
  }

  private notify(channel: string, ...args: any[]) {
    if (this.broadcaster) {
      this.broadcaster(channel, ...args);
    }
  }

  // --- Initialization ---

  async syncActiveTimers() {
    // recover timers from DB on app launch
    const activeTimers = await db
      .selectFrom('timers')
      .selectAll()
      .execute();

    const now = Date.now();

    for (const timer of activeTimers) {
      if (timer.type === 'wait' && timer.target_timestamp) {
        const target = new Date(timer.target_timestamp).getTime();
        const remaining = target - now;

        if (remaining > 0) {
          this.scheduleWaitCompletion(timer.task_id, remaining);
        } else {
          // Timer already expired while app was closed
          this.handleTimerExpiration(timer.task_id);
        }
      }
      // Focus timers don't need scheduling, just existing is enough
    }
  }

  // --- Focus Timer Logic ---
  // Focus timers are "Stopwatches", they just run until stopped.
  // We record 'started_at' in DB to calculate elapsed time.

  async startFocus(taskId: number) {
    // 1. Stop any existing focus timer (auto-suspend)
    await this.stopFocus();

    // 2. Defensive: Ensure NO OTHER task is in 'active' status
    await db.updateTable('tasks')
      .set({ status: 'queued' })
      .where('status', '=', 'active')
      .where('id', '!=', taskId)
      .where('type', '!=', 'training') // Don't stop training tasks
      .execute();

    // 2.5 Clean up any existing timers (wait/training) for this task to prevent duplicates (double entries in getAllTasks)
    // If we are focusing it, we are canceling any wait/training state on it.
    await db.deleteFrom('timers').where('task_id', '=', taskId).execute();
    if (this.waitTimers.has(taskId)) {
        clearTimeout(this.waitTimers.get(taskId)!);
        this.waitTimers.delete(taskId);
    }

    // 3. Create new focus timer in DB
    const now = new Date().toISOString();
    await db.insertInto('timers')
      .values({
        task_id: taskId,
        type: 'focus',
        started_at: now,
        target_timestamp: null, 
        original_duration: null
      })
      .execute();
      
    // 3. Update task status to active
    await db.updateTable('tasks')
      .set({ status: 'active' })
      .where('id', '=', taskId)
      .execute();
      
    // 4. Notify frontend
    this.notifyStateChange();
  }

  async stopFocus() {
    // Find ALL active focus timers (in case of race conditions/bugs producing duplicates)
    const activeTimers = await db.selectFrom('timers')
      .where('type', '=', 'focus')
      .selectAll()
      .execute();

    if (activeTimers.length === 0) return;

    for (const activeFocus of activeTimers) {
        // Calculate elapsed
        if (activeFocus.started_at) {
          const start = new Date(activeFocus.started_at).getTime();
          const end = Date.now();
          const elapsedSeconds = Math.floor((end - start) / 1000);

          const task = await db.selectFrom('tasks')
            .select(['total_duration', 'title'])
            .where('id', '=', activeFocus.task_id)
            .executeTakeFirst();

          if (task) {
            // Only save if session >= 3 minutes (180 seconds)
            if (elapsedSeconds >= 180) {
              await db.updateTable('tasks')
                .set({ 
                  total_duration: (task.total_duration || 0) + elapsedSeconds, 
                  status: 'queued' 
                })
                .where('id', '=', activeFocus.task_id)
                .execute();

              // LOG TO HISTORY
              await db.insertInto('history')
                .values({
                  task_id: activeFocus.task_id,
                  title: task.title,
                  type: 'focus',
                  start_time: activeFocus.started_at!,
                  end_time: new Date(end).toISOString()
                })
                .execute();
            } else {
              // Just update status to queued, discard the short session
              await db.updateTable('tasks')
                .set({ status: 'queued' })
                .where('id', '=', activeFocus.task_id)
                .execute();
              console.log(`Discarding short focus session: ${elapsedSeconds}s for task ${task.title}`);
            }
          }
        }

        // Delete timer record
        await db.deleteFrom('timers')
          .where('id', '=', activeFocus.id)
          .execute();
    }
      
    this.notifyStateChange();
  }

  // --- Wait Timer Logic ---
  // Wait timers are "Countdowns". 
  
  async startWait(taskId: number, durationSeconds: number) {
    const now = Date.now();
    const target = now + (durationSeconds * 1000);
    const targetIso = new Date(target).toISOString();

    // 1. Create/Update timer in DB
    // Check if exists first? assume new for now or replace
    await db.deleteFrom('timers').where('task_id', '=', taskId).execute();
    
    await db.insertInto('timers')
      .values({
        task_id: taskId,
        type: 'wait',
        target_timestamp: targetIso,
        original_duration: durationSeconds,
        started_at: new Date().toISOString()
      })
      .execute();

    // 2. Update status
    await db.updateTable('tasks')
      .set({ status: 'waiting' })
      .where('id', '=', taskId)
      .execute();

    // 3. Schedule in-memory
    this.scheduleWaitCompletion(taskId, durationSeconds * 1000);
    
    this.notifyStateChange();
  }

  async cancelWait(taskId: number) {
    // 1. Fetch task to check type
    const task = await db.selectFrom('tasks').select('type').where('id', '=', taskId).executeTakeFirst();

    // 2. Remove from DB (Timer)
    await db.deleteFrom('timers')
      .where('task_id', '=', taskId)
      .where('type', '=', 'wait')
      .execute();
      
    // 3. Update Status or Delete
    // Delete ad-hoc and training tasks entirely when cancelled
    if (task?.type === 'training' || task?.type === 'ad-hoc') {
        // Free GPU if applicable
        const taskInfo = await db.selectFrom('tasks').select('gpu_id').where('id', '=', taskId).executeTakeFirst();
        if (taskInfo && taskInfo.gpu_id) {
            await GpuService.setGpuIdle(taskInfo.gpu_id);
        }
        await db.deleteFrom('tasks').where('id', '=', taskId).execute();
    } else {
        await db.updateTable('tasks')
          .set({ status: 'queued' })
          .where('id', '=', taskId)
          .execute();
    }

    // 4. Clear Timeout
    if (this.waitTimers.has(taskId)) {
      clearTimeout(this.waitTimers.get(taskId)!);
      this.waitTimers.delete(taskId);
    }
    
    this.notifyStateChange();
  }

  // --- Internal Helpers ---

  private scheduleWaitCompletion(taskId: number, delayMs: number) {
    // Clear existing if any
    if (this.waitTimers.has(taskId)) {
      clearTimeout(this.waitTimers.get(taskId)!);
    }

    const timeout = setTimeout(() => {
      this.handleTimerExpiration(taskId);
    }, delayMs);

    this.waitTimers.set(taskId, timeout);
  }

  private async handleTimerExpiration(taskId: number) {
    this.waitTimers.delete(taskId);
    
    // 1. Fetch Task Details for Notification
    const task = await db.selectFrom('tasks')
      .selectAll()
      .where('id', '=', taskId)
      .executeTakeFirst();
      
    if (task) {
      // If training task, free the GPU
      if (task.type === 'training' && task.gpu_id) {
          await GpuService.setGpuIdle(task.gpu_id);
      }

      // System notification as a fallback (primary UI is the reminder window)
      new Notification({
        title: task.type === 'training' ? 'Training Complete' : 'Timer Finished',
        body: task.title,
        silent: true, // Reminder window plays its own sound
      }).show();
    }

    // 2. Notify Frontend (triggers reminder window)
    this.notify('timer:ended', taskId, task);
    this.notifyStateChange();
  }

  private notifyStateChange() {
    this.notify('timer:update');
  }

  // Snooze reminder - reschedule for X minutes later (works for training, ad-hoc, standard)
  async snoozeTrainingReminder(taskId: number, minutes: number) {
    const task = await db.selectFrom('tasks')
      .selectAll()
      .where('id', '=', taskId)
      .executeTakeFirst();
    
    if (!task) return;

    // Update the timer target timestamp
    const newTarget = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    
    await db.updateTable('timers')
      .set({ target_timestamp: newTarget })
      .where('task_id', '=', taskId)
      .execute();

    // Clear any existing timer
    if (this.waitTimers.has(taskId)) {
      clearTimeout(this.waitTimers.get(taskId)!);
      this.waitTimers.delete(taskId);
    }

    // Schedule new reminder
    this.scheduleWaitCompletion(taskId, minutes * 60 * 1000);
    
    this.notifyStateChange();
  }

  public cancelAll() {
    for (const t of this.waitTimers.values()) {
        clearTimeout(t);
    }
    this.waitTimers.clear();
  }

  // --- Training Logic ---

  async startTraining(taskId: number, gpuId: number, durationSeconds: number) {
      // 1. Check if GPU is busy
      const busyTask = await db.selectFrom('tasks')
          .select(['id', 'title'])
          .where('gpu_id', '=', gpuId)
          .where('status', '=', 'active')
          .executeTakeFirst();

      if (busyTask) {
          // Pause existing task
          await this.pauseTraining(busyTask.id);
      }

      // 2. Start new task
      const now = Date.now();
      const target = now + (durationSeconds * 1000);
      
      // Upsert Timer
      await db.deleteFrom('timers').where('task_id', '=', taskId).execute();
      await db.insertInto('timers')
          .values({
              task_id: taskId,
              type: 'training',
              target_timestamp: new Date(target).toISOString(),
              started_at: new Date(now).toISOString(),
              original_duration: durationSeconds
          })
          .execute();

      // Mark GPU Busy
      await GpuService.setGpuBusy(gpuId);

      // Update Task
      await db.updateTable('tasks')
          .set({ 
              status: 'active',
              gpu_id: gpuId 
          })
          .where('id', '=', taskId)
          .execute();

      // Schedule
      this.scheduleWaitCompletion(taskId, durationSeconds * 1000);
      this.notifyStateChange();
  }

  async pauseTraining(taskId: number) {
      // 0. Free GPU
      const t = await db.selectFrom('tasks').select('gpu_id').where('id', '=', taskId).executeTakeFirst();
      if (t && t.gpu_id) await GpuService.setGpuIdle(t.gpu_id);

      // 1. Calculate remaining time (optional, maybe store in memo or estimated_duration?)
      // For now, just stop the timer constants.
      // 2. Clear Timeout
      if (this.waitTimers.has(taskId)) {
          clearTimeout(this.waitTimers.get(taskId)!);
          this.waitTimers.delete(taskId);
      }
      
      // 3. Delete Timer Record
    const timer = await db.selectFrom('timers').selectAll().where('task_id', '=', taskId).executeTakeFirst();
    if (timer && timer.target_timestamp) {
           const remaining = new Date(timer.target_timestamp).getTime() - Date.now();
           if (remaining > 0) {
               // Update estimated duration to remaining minutes?
               // await db.updateTable('tasks').set({ estimated_duration: Math.ceil(remaining/60000) }).where('id', '=', taskId).execute();
           }
      }
      await db.deleteFrom('timers').where('task_id', '=', taskId).execute();

      // 4. Update Task Status (Keep GPU ID or clear? "Pause" usually implies keeping context but not running. But "Queue" implies pool.)
      // "Old task -> Queue". "Queue" usually don't have GPU assigned in UI list (Sidebar Region 2).
      // If we keep GPU ID, it might show in GPU card as "Paused"?
      // Spec says: "queue state ... can have no GPU Name".
      // "If GPU was busy, old task -> Queue".
      // Usually implies unassigning to free up the GPU.
      await db.updateTable('tasks')
          .set({ status: 'queued', gpu_id: null })
          .where('id', '=', taskId)
          .execute();
          
      this.notifyStateChange();
  }

  // Explicit Stop/Cancel for Training Tasks
  async stopTraining(taskId: number, forceComplete: boolean = false) {
      // 1. Get Timer Info
      const timer = await db.selectFrom('timers').selectAll().where('task_id', '=', taskId).executeTakeFirst();
      const task = await db.selectFrom('tasks').selectAll().where('id', '=', taskId).executeTakeFirst();

      if (!task) return;
      if (task.gpu_id) await GpuService.setGpuIdle(task.gpu_id);
      
      let isFinished = false;
      if (timer && timer.target_timestamp) {
          const remaining = new Date(timer.target_timestamp).getTime() - Date.now();
          if (remaining <= 0) isFinished = true;
      }
      
      if (forceComplete) isFinished = true;

      await db.deleteFrom('timers').where('task_id', '=', taskId).execute();

      if (isFinished) {
          // Completed -> Archive old task, Create new "Process..." task
          await db.updateTable('tasks').set({ status: 'archived' }).where('id', '=', taskId).execute();
          await TaskService.createTask(`Process ${task.title}`, undefined, 'standard', task.project_id || undefined);
      } else {
          // Cancelled/Interrupted -> Back to Queue
          await db.updateTable('tasks').set({ status: 'queued', gpu_id: null }).where('id', '=', taskId).execute();
      }

      this.notifyStateChange();
  }

  // --- Nagging Logic ---
  private async checkTaskNagging() {
      // 1. Get Interval
      let nagInterval = 15;
      const setting = await db.selectFrom('settings').selectAll().where('key', '=', 'reminder_nag_interval').executeTakeFirst();
      if (setting && setting.value) {
           nagInterval = parseInt(setting.value);
           if (isNaN(nagInterval) || nagInterval < 1) nagInterval = 15;
      }

      // 2. Find Overdue Timers
      const overdueTimers = await db.selectFrom('timers')
         .select(['task_id', 'target_timestamp'])
         .where('type', '!=', 'focus')
         .execute();
      
      const now = Date.now();
      for (const tm of overdueTimers) {
          if (!tm.target_timestamp) continue;
          const targetTime = new Date(tm.target_timestamp).getTime();
          const diffMs = now - targetTime;
          
          if (diffMs > 0) {
              const overdueMinutes = Math.floor(diffMs / 60000);
              // Fire only at intervals (skipping 0 because that is handled by standard timeout)
              if (overdueMinutes > 0 && overdueMinutes % nagInterval === 0) {
                   this.handleTimerExpiration(tm.task_id);
              }
          }
      }
  }

  // --- GPU Idle Checker ---
  private async checkGpuIdle() {
      // 1. Check Quiet Hours
      const settings = await db.selectFrom('settings').selectAll().where('key', '=', 'gpu_quiet_hours').executeTakeFirst();
      if (settings && settings.value) {
          try {
              const { start, end } = JSON.parse(settings.value); // e.g. { start: 23, end: 8 }
              const nowH = new Date().getHours();
              // Check if in range
              // If start <= end (e.g. 9am to 5pm): start <= now < end
              // If start > end (e.g. 11pm to 8am): now >= start OR now < end
              let isQuiet = false;
              if (start <= end) {
                  isQuiet = nowH >= start && nowH < end;
              } else {
                  isQuiet = nowH >= start || nowH < end;
              }
              
              if (isQuiet) return; // Silent mode
          } catch (e) {
              console.error('Failed to parse quiet hours', e);
          }
      } else {
          // Default Quiet Hours (optional default? per prompt "e.g. 11pm to 8am")
          // Let's implement generic default blocking late night?
          // Or strictly follow user setting. If no setting, assume ALWAYS alert.
          // User said "Can set in settings", enabling the feature. Default to OFF (always alert) probably safer or 23-8.
      // Let's check a hardcoded default 23 - 8 for safety as requested by "ensure correct... e.g."
          const nowH = new Date().getHours();
          if (nowH >= 23 || nowH < 8) return; 
      }

      // Check Idle Interval (default 15)
      let idleInterval = 15;
      const intervalSetting = await db.selectFrom('settings').selectAll().where('key', '=', 'gpu_idle_interval').executeTakeFirst();
      if (intervalSetting && intervalSetting.value) {
          try {
             idleInterval = parseInt(intervalSetting.value);
             if (isNaN(idleInterval) || idleInterval < 1) idleInterval = 15;
          } catch(e) {}
      }

      const gpus = await GpuService.getAllGpus();
      const now = Date.now();
      
      for (const gpu of gpus) {
          // If active task, it's busy.
          if (gpu.activeTaskId) {
              this.gpuNotificationState.delete(gpu.id);
              continue;
          }

          // If last_active_at is set, check duration
          if (gpu.last_active_at) {
              const idleTime = now - new Date(gpu.last_active_at).getTime();
              const idleMinutes = Math.floor(idleTime / 60000);
              
              // Key change: Check boundaries using checkpoints to tolerate skipped minutes
              const currentCheckpoint = Math.floor(idleMinutes / idleInterval) * idleInterval;
              const lastNotified = this.gpuNotificationState.get(gpu.id) || 0;

              // If we reached a new checkpoint (>= interval) and haven't notified for it yet
              if (currentCheckpoint >= idleInterval && currentCheckpoint > lastNotified) {
                  this.gpuNotificationState.set(gpu.id, currentCheckpoint);
                  
                  // Trigger Reminder Window
                  this.notify('timer:ended', -1 * gpu.id, { 
                      id: -1 * gpu.id, 
                      title: `GPU "${gpu.name}" is Idle (${Math.floor(idleMinutes)}m)`,
                      type: 'gpu-idle',
                      gpuName: gpu.name,
                      status: 'active',
                      created_at: new Date().toISOString(),
                      total_duration: 0,
                      is_next_action: 0,
                      sort_order: 0,
                      context_memo: null,
                      estimated_duration: null,
                      tag: null,
                      project_id: null,
                      parent_id: null,
                      gpu_id: gpu.id
                  });
              }
          }
      }
  }

  // Ensure all idle GPUs have a baseline timestamp (fixes null last_active_at)
  private async ensureGpuIdleState() {
      const gpus = await db.selectFrom('gpus').selectAll().execute();
      const activeTasks = await db.selectFrom('tasks')
          .select('gpu_id')
          .where('status', '=', 'active')
          .where('gpu_id', 'is not', null)
          .execute();
      const activeGpuIds = activeTasks.map(t => t.gpu_id);
      
      const now = new Date().toISOString();
      
      for (const gpu of gpus) {
          // If idle (not in activeGpuIds) and last_active_at is missing
          if (!activeGpuIds.includes(gpu.id) && !gpu.last_active_at) {
              await db.updateTable('gpus')
                  .set({ last_active_at: now })
                  .where('id', '=', gpu.id)
                  .execute();
          }
      }
  }
}


