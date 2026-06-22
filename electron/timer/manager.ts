import { randomUUID } from 'node:crypto';
import { Notification } from 'electron';
import { db } from '../db';
import { GpuService, TaskService } from '../db/service';
import { WandbPoller } from '../wandb/poller';
import { WandbRunFull } from '../wandb/client';
import { AiReminder, AiReminderStatus } from '../../src/shared/types';

export class TimerManager {
  private waitTimers: Map<number, NodeJS.Timeout> = new Map();
  private trainingStatus: Map<number, any> = new Map();
  private broadcaster: ((channel: string, ...args: any[]) => void) | null = null;
  private wandbPoller: WandbPoller | null = null;
  private lastIdleAlert: number = 0;

  // Cached settings — refreshed every 5 minutes instead of querying DB every minute
  private settingsCache: Map<string, string> = new Map();
  private settingsCacheTs: number = 0;
  private static SETTINGS_TTL = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.syncActiveTimers();
    this.ensureGpuIdleState();
    setInterval(() => {
         this.checkGpuHealth();
         this.checkTaskNagging();
    }, 60000);
    this.initWandb();
  }

  // ===== wandb integration =====

  async initWandb(): Promise<void> {
    try {
      await GpuService.cleanupWandbGpus();
      const apiKey = await this.getSetting('wandb_api_key');
      const entity = await this.getSetting('wandb_entity');
      if (apiKey && entity) {
        this.startWandbPolling(entity, apiKey);
      }
    } catch (err) {
      console.error('[TimerManager] wandb init error:', err);
    }
  }

  startWandbPolling(entity: string, apiKey: string): void {
    this.stopWandbPolling();
    this.wandbPoller = new WandbPoller({ entity, apiKey }, (result) => {
      this.handleWandbResult(result.active, result.finished);
    });
    this.wandbPoller.start();
    console.log(`[TimerManager] wandb polling started for entity="${entity}"`);
  }

  stopWandbPolling(): void {
    if (this.wandbPoller) {
      this.wandbPoller.stop();
      this.wandbPoller = null;
    }
  }

  private async handleWandbResult(active: WandbRunFull[], finished: WandbRunFull[]): Promise<void> {
    let changed = false;

    for (const run of active) {
      const task = await this.findOrCreateTrainingTask(run.name, run.project);
      if (!task) continue;

      const hostId = `wandb:${run.project}:${run.id}`;
      let gpu = await GpuService.findGpuByHostId(hostId);
      if (!gpu) {
        gpu = await GpuService.createGpu(run.name);
        await db.updateTable('gpus').set({ host_id: hostId }).where('id', '=', gpu.id).execute();
        changed = true;
      }

      if (task.gpu_id !== gpu.id) {
        await db.updateTable('tasks')
          .set({ status: 'active', gpu_id: gpu.id })
          .where('id', '=', task.id)
          .execute();
        await GpuService.setGpuBusy(gpu.id);
        changed = true;
      }

      const status = {
        taskId: task.id,
        modelName: run.name,
        metrics: run.summaryMetrics,
        lastUpdated: Date.now(),
        stalled: false,
        source: 'wandb' as const,
        wandbUrl: run.url,
      };
      this.trainingStatus.set(task.id, status);
      this.notify('timer:training-update', status);
    }

    for (const run of finished) {
      const tasks = await TaskService.getAllTasks();
      const task = tasks.find(t =>
        t.title === run.name && t.type === 'training' && t.status !== 'archived'
      );
      if (!task) continue;

      if (run.state === 'crashed' || run.state === 'killed') {
        const status = this.trainingStatus.get(task.id);
        if (status) {
          status.stalled = true;
          status.lastUpdated = Date.now();
          this.notify('timer:training-update', status);
        }
      } else {
        if (task.gpu_id) {
          const gpu = await GpuService.findGpuByHostId(`wandb:${run.project}:${run.id}`);
          if (gpu) {
            await GpuService.deleteGpu(gpu.id);
            changed = true;
          }
        }
        await TaskService.updateTask(task.id, { status: 'archived' });
        this.trainingStatus.delete(task.id);
        this.clearTrainingStatus(task.id);
      }
    }

    if (changed || active.length > 0 || finished.length > 0) {
      this.notifyStateChange();
    }
  }

  private async findOrCreateTrainingTask(runName: string, _projectName: string) {
    const tasks = await TaskService.getAllTasks();
    const existing = tasks.find(t =>
      t.title === runName && t.type === 'training' && t.status !== 'archived'
    );
    if (existing) return existing;

    const created = await TaskService.createTask(runName, undefined, 'training', undefined, undefined, true);
    await db.updateTable('tasks').set({ is_webhook: 1 }).where('id', '=', created.id).execute();
    return created;
  }

  /** Get a setting value, using cached value if fresh (< 5 min), otherwise re-fetch from DB */
  private async getSetting(key: string): Promise<string | undefined> {
    const now = Date.now();
    if (now - this.settingsCacheTs > TimerManager.SETTINGS_TTL) {
      // Refresh entire cache
      const rows = await db.selectFrom('settings').select(['key', 'value']).execute();
      this.settingsCache.clear();
      for (const r of rows) {
        if (r.key && r.value != null) {
          try { this.settingsCache.set(r.key, JSON.parse(r.value)); }
          catch { this.settingsCache.set(r.key, r.value); }
        }
      }
      this.settingsCacheTs = now;
    }
    return this.settingsCache.get(key);
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
      .set({ 
          status: 'queued',
          last_focused_at: new Date().toISOString()
      })
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
            .select(['total_duration', 'title', 'parent_id'])
            .where('id', '=', activeFocus.task_id)
            .executeTakeFirst();

          if (task) {
            const now = new Date().toISOString();
            // Only save if session >= 3 minutes (180 seconds)
            if (elapsedSeconds >= 180) {
              await db.updateTable('tasks')
                .set({ 
                  total_duration: (task.total_duration || 0) + elapsedSeconds, 
                  status: 'queued',
                  last_focused_at: now
                })
                .where('id', '=', activeFocus.task_id)
                .execute();

              // Propagate duration to parent(s)
              let currentParentId = task.parent_id;
              while (currentParentId) {
                  const parent = await db.selectFrom('tasks')
                      .select(['id', 'total_duration', 'parent_id'])
                      .where('id', '=', currentParentId)
                      .executeTakeFirst();
                  
                  if (parent) {
                      await db.updateTable('tasks')
                          .set({ total_duration: (parent.total_duration || 0) + elapsedSeconds })
                          .where('id', '=', parent.id)
                          .execute();
                      currentParentId = parent.parent_id;
                  } else {
                      break;
                  }
              }

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
              // Still update last_focused_at for sorting purposes
              await db.updateTable('tasks')
                .set({ status: 'queued', last_focused_at: now })
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
    // 1. Fetch task to check type and current status
    const task = await db.selectFrom('tasks').select(['type', 'status', 'gpu_id']).where('id', '=', taskId).executeTakeFirst();

    // 2. Remove from DB (Timer)
    await db.deleteFrom('timers')
      .where('task_id', '=', taskId)
      .where('type', '=', 'wait')
      .execute();
      
    // 3. Update Status or Delete
    // Delete ad-hoc and training tasks entirely when cancelled
    if (task?.type === 'training' || task?.type === 'ad-hoc') {
        // Free GPU if applicable
        if (task.gpu_id) {
            await GpuService.setGpuIdle(task.gpu_id);
        }
        await db.deleteFrom('tasks').where('id', '=', taskId).execute();
    } else if (task?.status !== 'archived') {
        // Only reset to queued if not already archived (completed)
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

  async completeTask(taskId: number) {
    // 1. Get Task Info
    const task = await db.selectFrom('tasks')
        .select(['status', 'parent_id', 'id'])
        .where('id', '=', taskId)
        .executeTakeFirst();
        
    if (!task) return;
    
    // Check if any active timer exists for this task (Timer table source of truth for focus)
    const activeTimer = await db.selectFrom('timers')
        .selectAll()
        .where('task_id', '=', taskId)
        .where('type', '=', 'focus')
        .executeTakeFirst();

    const isFocused = !!activeTimer;
    const parentId = task.parent_id;
    
    // 2. If focused and has parent, switch focus to parent
    if (isFocused && parentId) {
        await this.startFocus(parentId);
    } else if (isFocused) {
        // Just stop focus if no parent
        await this.stopFocus();
    }
    
    // 3. Archive this task and all children
    const idsToArchive = [taskId];
    
    // Find all children recursively
    let currentLevelIds = [taskId];
    // Safety break to prevent infinite loops if circular ref exists (though shouldn't)
    let depth = 0;
    while (currentLevelIds.length > 0 && depth < 20) {
        const children = await db.selectFrom('tasks')
            .select('id')
            .where('parent_id', 'in', currentLevelIds)
            .where('status', '!=', 'archived')
            .execute();
        
        if (children.length === 0) break;
        
        const childIds = children.map(c => c.id);
        idsToArchive.push(...childIds);
        currentLevelIds = childIds;
        depth++;
    }
    
    // Batch update status
    await db.updateTable('tasks')
        .set({ status: 'archived' })
        .where('id', 'in', idsToArchive)
        .execute();
        
    // 4. Cancel timers for all archived tasks
    await db.deleteFrom('timers')
        .where('task_id', 'in', idsToArchive)
        .execute();
        
    for (const id of idsToArchive) {
        if (this.waitTimers.has(id)) {
            clearTimeout(this.waitTimers.get(id)!);
            this.waitTimers.delete(id);
        }
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

      // Ad-hoc tasks use the soft reminder path: no system notification,
      // no Reminder window, no sound. They surface as a non-blocking banner
      // in Spotlight / Dashboard until the user dismisses them.
      if (task.type !== 'ad-hoc') {
        new Notification({
          title: task.type === 'training' ? 'Training Complete' : 'Timer Finished',
          body: task.title,
          silent: true, // Reminder window plays its own sound
        }).show();
      }
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

  // --- Training Status Logic ---

  async updateTrainingStatus(data: { task_id?: number, title?: string, gpu_name?: string, host_id?: string, model_name?: string, eta?: string, metrics?: Record<string, unknown> }) {
      // 0. wandb is primary — skip webhook entirely if wandb is actively tracking any training
      const wandbActive = Array.from(this.trainingStatus.values()).some(s => s.source === 'wandb');
      if (wandbActive) return true;

      let taskId = data.task_id;
      const taskTitle = data.title;

      // 1. Resolve Task
      if (!taskId && taskTitle) {
          // If GPU Name is provided, try to find a task running on that GPU first
          if (data.gpu_name) {
              const hostId = data.host_id || null;
              const gpu = await db.selectFrom('gpus')
                  .select('id')
                  .where('name', '=', data.gpu_name)
                  .where('host_id', hostId ? '=' : 'is', hostId ?? null)
                  .executeTakeFirst();
              
              if (gpu) {
                  // PRIORITY 1: Find webhook task on this GPU
                  const webhookTaskOnGpu = await db.selectFrom('tasks')
                      .select('id')
                      .where('gpu_id', '=', gpu.id)
                      .where('status', '=', 'active')
                      .where('is_webhook', '=', 1)
                      .executeTakeFirst();
                  
                  if (webhookTaskOnGpu) {
                      taskId = webhookTaskOnGpu.id;
                  } else {
                      // PRIORITY 2: Find any active task on this GPU
                      const taskOnGpu = await db.selectFrom('tasks')
                          .select('id')
                          .where('gpu_id', '=', gpu.id)
                          .where('status', '=', 'active')
                          .executeTakeFirst();
                      
                      if (taskOnGpu) {
                          taskId = taskOnGpu.id;
                      }
                  }
              }
          }

          // If no GPU match, try exact title match first, then fallback to fuzzy
          if (!taskId) {
              // PRIORITY 3: Exact title match on active/webhook tasks
              const exact = await db.selectFrom('tasks')
                  .select('id')
                  .where('title', '=', taskTitle)
                  .where('status', '=', 'active')
                  .where('is_webhook', '=', 1)
                  .executeTakeFirst();
              
              if (exact) {
                  taskId = exact.id;
              }
          }

          // PRIORITY 4 (fallback): Fuzzy search, prefer webhook tasks
          if (!taskId) {
              const candidates = await db.selectFrom('tasks')
                  .selectAll()
                  .where('title', 'like', `%${taskTitle}%`)
                  .where('status', '!=', 'archived')
                  .execute();
              
              // Sort: webhook tasks first
              const sorted = candidates.sort((a, b) => (b.is_webhook || 0) - (a.is_webhook || 0));
              
              for (const c of sorted) {
                  // Strict GPU Check
                  if (data.gpu_name) {
                      // If task has a GPU assigned, it MUST match the incoming GPU
                      if (c.gpu_id) {
                          const cGpu = await db.selectFrom('gpus').select('name').where('id', '=', c.gpu_id).executeTakeFirst();
                          if (cGpu && cGpu.name !== data.gpu_name) {
                              continue; // Skip this task, it's on a different GPU
                          }
                      }
                      // If task has NO GPU assigned, we can claim it? 
                      // Only claim webhook tasks, not regular ones.
                      if (!c.is_webhook) continue;
                  }
                  
                  // If we are here, either:
                  // 1. No GPU name in webhook (so any task matches)
                  // 2. GPU name provided AND task has matching GPU
                  // 3. GPU name provided AND task has NO GPU
                  taskId = c.id;
                  break;
              }
          }
      }

      if (!taskId) {
          // If no matching task found, create one automatically
          // Use title, or fallback to model_name, or gpu_name as the task name
          const autoTitle = taskTitle || data.model_name || (data.gpu_name ? `Training on ${data.gpu_name}` : null);
          
          if (autoTitle) {
              const newTask = await TaskService.createTask(autoTitle, undefined, 'training');
              taskId = newTask.id;
              
              // Mark as webhook-created task
              await db.updateTable('tasks')
                  .set({ 
                      status: 'active', 
                      last_focused_at: new Date().toISOString(),
                      is_webhook: 1 
                  })
                  .where('id', '=', taskId)
                  .execute();
          } else {
              console.warn('Webhook received but no matching task found and no title/model_name/gpu_name provided:', data);
              return false;
          }
      }

      // 2. Handle GPU Assignment
      if (data.gpu_name) {
          // Find GPU by name + host_id (unique per machine)
          const hostId = data.host_id || null;
          let gpu = await db.selectFrom('gpus')
              .selectAll()
              .where('name', '=', data.gpu_name)
              .where('host_id', hostId ? '=' : 'is', hostId ?? null)
              .executeTakeFirst();
          
          // Auto-create if not found
          if (!gpu) {
              const res = await GpuService.createGpu(data.gpu_name, '#4ade80');
              gpu = { id: res.id, name: data.gpu_name, host_id: hostId, color: '#4ade80', created_at: new Date().toISOString(), last_active_at: new Date().toISOString() };
              // Persist host_id
              await db.updateTable('gpus')
                  .set({ host_id: hostId })
                  .where('id', '=', gpu.id)
                  .execute();
          }

          if (gpu) {
              // Clear other non-webhook tasks from this GPU first (avoid conflicts)
              await db.updateTable('tasks')
                  .set({ gpu_id: null, status: 'queued' })
                  .where('gpu_id', '=', gpu.id)
                  .where('id', '!=', taskId)
                  .where('is_webhook', '!=', 1)
                  .execute();

              // Assign to Task if needed
              const task = await db.selectFrom('tasks').select('gpu_id').where('id', '=', taskId).executeTakeFirst();
              if (task && task.gpu_id !== gpu.id) {
                  await db.updateTable('tasks')
                      .set({ gpu_id: gpu.id, status: 'active' })
                      .where('id', '=', taskId)
                      .execute();
              } else if (task) {
                  // Ensure status is active
                  await db.updateTable('tasks')
                      .set({ status: 'active' })
                      .where('id', '=', taskId)
                      .execute();
              }
              
              // Mark GPU as active
              await db.updateTable('gpus')
                  .set({ last_active_at: new Date().toISOString() })
                  .where('id', '=', gpu.id)
                  .execute();
          }
      }

      // 2.5 Handle training completion
      const metrics = data.metrics as Record<string, unknown> | undefined;
      if (metrics && metrics.status === 'completed') {
          // Archive the webhook task
          await db.updateTable('tasks')
              .set({ status: 'archived' })
              .where('id', '=', taskId)
              .execute();

          // Release GPU (set idle)
          const task = await db.selectFrom('tasks').select('gpu_id').where('id', '=', taskId).executeTakeFirst();
          if (task && task.gpu_id) {
              await GpuService.setGpuIdle(task.gpu_id);
          }

          // Clean up in-memory training status (prevent stalled false alarm)
          this.trainingStatus.delete(taskId);

          // Create a follow-up standard task to remind checking results
          const taskTitle = await db.selectFrom('tasks').select('title').where('id', '=', taskId).executeTakeFirst();
          const followUpTitle = taskTitle ? `📋 Check results: ${taskTitle.title}` : '📋 Check training results';
          await TaskService.createTask(followUpTitle, undefined, 'standard');

          // Broadcast update
          this.notifyStateChange();
          return true;
      }

      // 3. wandb is primary — skip webhook update if wandb is tracking this task
      const existing = this.trainingStatus.get(taskId);
      if (existing?.source === 'wandb') {
          return true;
      }

      // 4. Update In-Memory Status
      const status = {
          taskId,
          gpuName: data.gpu_name,
          modelName: data.model_name,
          eta: data.eta,
          metrics: data.metrics,
          lastUpdated: Date.now(),
          stalled: false,
          lastReminded: 0,
          source: 'webhook' as const,
      };

      this.trainingStatus.set(taskId, status);

      // 5. Broadcast
      this.notify('timer:training-update', status);
      return true;
  }

  // ===== Unified GPU Health Check (hostname-level) =====

  private async isQuietHours(): Promise<boolean> {
      const quietHoursVal = await this.getSetting('gpu_quiet_hours');
      let start = 23, end = 8;
      if (quietHoursVal) {
          try {
              const parsed = typeof quietHoursVal === 'string' ? JSON.parse(quietHoursVal) : quietHoursVal;
              start = parsed.start ?? 23;
              end = parsed.end ?? 8;
          } catch { /* defaults */ }
      }
      const nowH = new Date().getHours();
      if (start <= end) return nowH >= start && nowH < end;
      return nowH >= start || nowH < end;
  }

  private async checkGpuHealth() {
      const now = Date.now();

      // 1. Quiet hours gate
      if (await this.isQuietHours()) return;

      // 2. Settings
      let stallThreshold = 5;
      let reminderInterval = 10;
      let idleInterval = 15;
      try {
          const s1 = await this.getSetting('webhook_stalled_threshold');
          if (s1) stallThreshold = parseInt(s1) || 5;
          const s2 = await this.getSetting('webhook_stalled_interval');
          if (s2) reminderInterval = parseInt(s2) || 10;
          const s3 = await this.getSetting('gpu_idle_interval');
          if (s3) idleInterval = parseInt(s3) || 15;
      } catch { /* defaults */ }

      const STALL_MS = stallThreshold * 60 * 1000;
      const REMIND_MS = Math.max(reminderInterval * 60 * 1000, 60000);
      const IDLE_MS = idleInterval * 60 * 1000;

      // 3. Stalled detection (all sources: wandb + webhook)
      const tasksToRemove: number[] = [];
      for (const [taskId, status] of this.trainingStatus.entries()) {
          const task = await db.selectFrom('tasks')
              .select(['id', 'status', 'title'])
              .where('id', '=', taskId)
              .executeTakeFirst();

          if (!task || task.status === 'archived') {
              tasksToRemove.push(taskId);
              continue;
          }

          const isStalled = now - status.lastUpdated > STALL_MS;

          if (isStalled) {
              if (!status.stalled) {
                  status.stalled = true;
                  status.lastReminded = 0;
                  this.trainingStatus.set(taskId, status);
                  this.notify('timer:training-update', status);
              }

              if (status.lastReminded === 0 || (now - status.lastReminded > REMIND_MS)) {
                  status.lastReminded = now;
                  this.trainingStatus.set(taskId, status);
                  this.notify('timer:ended', taskId, {
                      id: taskId,
                      title: `⚠️ 训练停滞: ${status.modelName || task.title}`,
                      type: 'training',
                      status: 'active',
                      gpu_id: null,
                      context_memo: `${status.source || 'webhook'} 来源 · ${Math.floor((now - status.lastUpdated) / 60000)} 分钟无更新`,
                  });
              }
          } else if (status.stalled) {
              status.stalled = false;
              status.lastReminded = 0;
              this.trainingStatus.set(taskId, status);
              this.notify('timer:training-update', status);
          }
      }
      for (const id of tasksToRemove) {
          this.trainingStatus.delete(id);
      }

      // 4. Hostname-level idle detection
      const activeTraining = await db.selectFrom('tasks')
          .select('id')
          .where('type', '=', 'training')
          .where('status', '=', 'active')
          .execute();

      if (activeTraining.length > 0) {
          this.lastIdleAlert = 0;
          return;
      }

      const queuedTraining = await db.selectFrom('tasks')
          .select(['id', 'title'])
          .where('type', '=', 'training')
          .where('status', '=', 'queued')
          .execute();

      if (queuedTraining.length === 0) return;

      if (this.lastIdleAlert > 0 && (now - this.lastIdleAlert < IDLE_MS)) return;
      this.lastIdleAlert = now;

      const names = queuedTraining.slice(0, 3).map(t => t.title).join(' / ');
      const extra = queuedTraining.length > 3 ? ` 等 ${queuedTraining.length} 个` : '';
      this.notify('timer:ended', -1, {
          id: -1,
          title: `GPU 空闲 · ${queuedTraining.length} 个训练任务排队`,
          type: 'gpu-idle',
          status: 'active',
          created_at: new Date().toISOString(),
          total_duration: 0,
          is_next_action: 0,
          sort_order: 0,
          context_memo: `排队: ${names}${extra}`,
          estimated_duration: null,
          tag: null,
          project_id: null,
          parent_id: null,
          gpu_id: null,
      });
  }

  // Public method to clear training status (called when GPU/task is deleted)
  clearTrainingStatus(taskId: number) {
      this.trainingStatus.delete(taskId);
      console.log(`[Webhook] Cleared training status for task ${taskId}`);
  }

  // --- Nagging Logic ---
  private async checkTaskNagging() {
      // 1. Get Interval
      let nagInterval = 15;
      const settingVal = await this.getSetting('reminder_nag_interval');
      if (settingVal) {
           nagInterval = parseInt(settingVal);
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

  public triggerExternalNotification(title: string, message?: string) {
      const notificationId = -1 * Date.now(); // Negative ID
      const task = {
          id: notificationId,
          title: title,
          type: 'external',
          status: 'active',
          created_at: new Date().toISOString(),
          total_duration: 0,
          is_next_action: 0,
          sort_order: 0,
          context_memo: message || null,
          estimated_duration: null,
          tag: null,
          project_id: null,
          parent_id: null,
          gpu_id: null
      };

      // Notify Frontend
      this.notify('timer:ended', notificationId, task);
  }

  async handleAiReminder(data: Record<string, unknown>): Promise<void> {
    const source = String(data.source ?? '').trim();
    const title = String(data.title ?? '').trim();
    if (!source || !title) {
      throw new Error('ai reminder requires "source" and "title"');
    }

    const known: AiReminderStatus[] = ['success', 'failure', 'needs_input', 'review', 'progress'];
    const status: AiReminderStatus = known.includes(data.status as AiReminderStatus)
      ? (data.status as AiReminderStatus)
      : 'info';

    const detail = data.detail != null ? String(data.detail) : undefined;
    const link = typeof data.link === 'string' ? data.link : undefined;
    // 兼容秒与毫秒：> 1e12 视作已为毫秒(ms)，否则按秒换算
    const rawTs = typeof data.timestamp === 'number' ? data.timestamp : null;
    const ts = rawTs === null ? Date.now() : (rawTs > 1e12 ? rawTs : rawTs * 1000);

    if (status === 'success') {
      try {
        await this.createAiSoftReminder({ source, title, detail, link });
        return;
      } catch (err) {
        console.error('[TimerManager] createAiSoftReminder failed, fallback to ephemeral:', err);
      }
    }

    const reminder: AiReminder = {
      id: randomUUID(),
      source,
      title,
      status,
      detail,
      link,
      timestamp: ts,
    };
    this.notify('ai:reminder', reminder);
  }

  async createAiSoftReminder(payload: {
    source: string; title: string; detail?: string; link?: string;
  }): Promise<void> {
    const taskTitle = `🤖 ${payload.source} · ${payload.title}`;
    const memo = [payload.detail, payload.link].filter(Boolean).join('\n') || null;

    const task = await TaskService.createTask(taskTitle, undefined, 'ad-hoc', undefined, undefined, true);

    if (memo) {
      await TaskService.updateTask(task.id, { context_memo: memo });
    }

    await db.deleteFrom('timers').where('task_id', '=', task.id).execute();
    await db.insertInto('timers')
      .values({
        task_id: task.id,
        type: 'wait',
        target_timestamp: new Date(Date.now() - 1000).toISOString(),
        original_duration: 0,
        started_at: new Date().toISOString(),
      })
      .execute();

    await db.updateTable('tasks')
      .set({ status: 'waiting' })
      .where('id', '=', task.id)
      .execute();

    this.notify('fetch-tasks');
  }
}


