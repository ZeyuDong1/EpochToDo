import { sql } from 'kysely';
import { db } from './index';
import { Task, Project, HistoryEntry, Gpu, SchedulerGpu, SchedulerTask, SchedulerAssignment, SettingValue } from '../../src/shared/types';

export const TaskService = {
  async createTask(title: string, tag?: string, type: Task['type'] = 'standard', projectId?: number, parentId?: number, skipDedup: boolean = false): Promise<Task> {
    if (type !== 'training' && !skipDedup) {
        const existing = await db.selectFrom('tasks')
          .selectAll()
          .where('title', '=', title)
          .where('status', '!=', 'archived')
          .executeTakeFirst();

        if (existing) {
            return existing as unknown as Task;
        }
    }

    const result = await db
      .insertInto('tasks')
      .values({
        title,
        status: 'queued', 
        type,
        created_at: new Date().toISOString(),
        total_duration: 0,
        tag: tag || null,
        context_memo: null,
        project_id: projectId || null,
        parent_id: parentId || null,
        is_next_action: 1,
        sort_order: Date.now()
      })
      .returningAll()
      .executeTakeFirstOrThrow();
      
    return result as unknown as Task;
  },

  async getAllTasks(): Promise<Task[]> {
    const tasks = await db.selectFrom('tasks')
      .leftJoin('timers', 'tasks.id', 'timers.task_id')
      .select([
        'tasks.id',
        'tasks.title',
        'tasks.status',
        'tasks.type',
        'tasks.context_memo',
        'tasks.total_duration',
        'tasks.estimated_duration',
        'tasks.tag',
        'tasks.project_id',
        'tasks.parent_id',
        'tasks.is_next_action',
        'tasks.is_side_focus',
        'tasks.side_focus_at',
        'tasks.sort_order',
        'tasks.created_at',
        'tasks.dispatched_target',
        'timers.started_at as started_at',
        'timers.target_timestamp as target_timestamp',
        'timers.type as timer_type',
        'tasks.gpu_id',
        'tasks.last_focused_at',
        'tasks.md_file_path',
        'tasks.md_line_hash'
      ])
      .orderBy('tasks.sort_order', 'asc')
      .execute();

    // Deduplicate: If multiple timers exist for a task (rare bug case), prefer the one with active timer data
    const taskMap = new Map<number, (typeof tasks)[number]>();
    for (const row of tasks) {
        if (!taskMap.has(row.id)) {
            taskMap.set(row.id, row);
        } else {
            const existing = taskMap.get(row.id);
            // Replace if new row has timer info and existing doesn't
            if (existing && (row.started_at || row.target_timestamp) && (!existing.started_at && !existing.target_timestamp)) {
                taskMap.set(row.id, row);
            }
        }
    }

    return Array.from(taskMap.values()) as unknown as Task[];
  },

  async updateTaskStatus(id: number, status: Task['status']): Promise<void> {
    await db.updateTable('tasks').set({ status }).where('id', '=', id).execute();
  },

  async updateTask(id: number, updates: Partial<Omit<Task, 'started_at' | 'target_timestamp' | 'timer_type' | 'is_webhook'>>): Promise<void> {
    await db.updateTable('tasks').set(updates).where('id', '=', id).execute();
  },

  // Secondary focus: at most 2 tasks may carry the flag at once. Returns
  // false (and changes nothing) when enabling would exceed the limit.
  // Only slots the overlay actually shows count: archived tasks keep their
  // flag but free the slot, and a flagged task promoted to the current
  // focus (status 'active') is hidden from the side row, so it frees one too.
  async setSideFocus(id: number, enabled: boolean): Promise<boolean> {
    if (enabled) {
      const others = await db.selectFrom('tasks')
        .select('id')
        .where('is_side_focus', '=', 1)
        .where('status', 'not in', ['archived', 'active'])
        .where('id', '!=', id)
        .execute();
      if (others.length >= 2) return false;
    }
    await db.updateTable('tasks')
      .set(enabled
        ? { is_side_focus: 1, side_focus_at: new Date().toISOString() }
        : { is_side_focus: 0 })
      .where('id', '=', id)
      .execute();
    return true;
  },

  // Which side-focus task should be promoted to the main focus after the
  // current focus was demoted to side. Prefers the candidate with focus
  // history (most recent last_focused_at first); among candidates without any
  // history, falls back to the earliest-flagged side (legacy NULL timestamps
  // sort first and count as oldest).
  async pickSideFocusPromotion(excludeId: number): Promise<number | null> {
    const row = await db.selectFrom('tasks')
      .select('id')
      .where('is_side_focus', '=', 1)
      .where('status', 'not in', ['archived', 'active'])
      .where('id', '!=', excludeId)
      .orderBy(sql`(last_focused_at is null)`, 'asc')
      .orderBy('last_focused_at', 'desc')
      .orderBy(sql`(side_focus_at is null)`, 'asc')
      .orderBy('side_focus_at', 'asc')
      .limit(1)
      .executeTakeFirst();
    return row?.id ?? null;
  },

  async getActiveFocusTaskId(): Promise<number | null> {
    const row = await db.selectFrom('timers')
      .select('task_id')
      .where('type', '=', 'focus')
      .executeTakeFirst();
    return row?.task_id ?? null;
  },

  async appendMemo(id: number, content: string): Promise<void> {
    const task = await db.selectFrom('tasks').select('context_memo').where('id', '=', id).executeTakeFirst();
    const current = task?.context_memo || '';
    const newMemo = current ? `${current}\n${content}` : content;
    
    await db.updateTable('tasks')
      .set({ context_memo: newMemo })
      .where('id', '=', id)
      .execute();
  },

  async getSuggestions(maxDurationMinutes?: number): Promise<Task[]> {
    let query = db.selectFrom('tasks')
      .selectAll()
      .where('status', '=', 'queued');
      
    if (maxDurationMinutes) {
       query = query.where('estimated_duration', '<=', maxDurationMinutes);
    }
    
    const tasks = await query.limit(5).execute();
    return tasks as unknown as Task[];
  },

  async deleteTask(id: number): Promise<void> {
    // 递归收集所有后代 id（深度优先，避免删除父节点后子节点变孤儿）
    const idsToDelete: number[] = [];
    const visited = new Set<number>();
    const collect = async (currentId: number) => {
        if (visited.has(currentId)) return;
        visited.add(currentId);
        idsToDelete.push(currentId);
        const children = await db.selectFrom('tasks')
            .select('id')
            .where('parent_id', '=', currentId)
            .execute();
        for (const child of children) {
            await collect(child.id);
        }
    };
    await collect(id);
    await db.deleteFrom('tasks').where('id', 'in', idsToDelete).execute();
  },

  async deleteAllTasks(): Promise<void> {
    await db.deleteFrom('history').execute();
    await db.deleteFrom('tasks').execute();
  }
};

export const HistoryService = {
  async getHistory(dateStr?: string): Promise<HistoryEntry[]> {
    let query = db.selectFrom('history').selectAll();
    
    if (dateStr) {
      // dateStr is 'YYYY-MM-DD'
      query = query.where('start_time', 'like', `${dateStr}%`);
    }
    
    const results = await query.execute();
    return results as unknown as HistoryEntry[];
  },
  
  async deleteHistory(id: number): Promise<void> {
    await db.deleteFrom('history').where('id', '=', id).execute();
  }
};

export const ProjectService = {
  async getAllProjects(): Promise<Project[]> {
    const projects = await db.selectFrom('projects').selectAll().execute();
    
    // Fetch stats for each project
    const stats = await db.selectFrom('tasks')
      .select([
        'project_id',
        db.fn.count<number>('id').as('activeCount'),
        db.fn.sum<number>('total_duration').as('totalFocused')
      ])
      .where('status', '!=', 'archived')
      .groupBy('project_id')
      .execute();

    return projects.map(p => {
      const s = stats.find(stat => stat.project_id === p.id);
      return {
        ...p,
        activeCount: Number(s?.activeCount || 0),
        totalFocused: Number(s?.totalFocused || 0)
      } as unknown as Project;
    });
  },

  async createProject(name: string, description?: string, color?: string): Promise<Project> {
    const defaultColors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
    const randomColor = defaultColors[Math.floor(Math.random() * defaultColors.length)];

    const result = await db.insertInto('projects')
      .values({
        name,
        description: description || null,
        color: color || randomColor,
        created_at: new Date().toISOString()
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return result as unknown as Project;
  },

  async updateProject(id: number, updates: Partial<Omit<Project, 'id' | 'created_at'>>): Promise<void> {
      await db.updateTable('projects')
        .set(updates)
        .where('id', '=', id)
        .execute();
  },

  async deleteProject(id: number): Promise<void> {
    // Unassign tasks from this project
    await db.updateTable('tasks')
      .set({ project_id: null })
      .where('project_id', '=', id)
      .execute();
      
    await db.deleteFrom('projects')
      .where('id', '=', id)
      .execute();
  },

  async setGpuIdle(id: number): Promise<void> {
    await db.updateTable('gpus')
        .set({ last_active_at: new Date().toISOString() })
        .where('id', '=', id)
        .execute();
  },

  async setGpuBusy(id: number): Promise<void> {
    await db.updateTable('gpus')
        .set({ last_active_at: null })
        .where('id', '=', id)
        .execute();
  }
};

export const GpuService = {
  async getAllGpus(): Promise<Gpu[]> {
    const gpus = await db.selectFrom('gpus').selectAll().execute();
    
    // Find active tasks for each GPU
    const activeTasks = await db.selectFrom('tasks')
      .select(['id', 'gpu_id'])
      .where('status', '=', 'active')
      .where('type', '=', 'training')
      .where('gpu_id', 'is not', null)
      .execute();
    
    const now = new Date().toISOString();
    const gpusToRepair: number[] = [];
    const result = gpus.map(g => {
        const t = activeTasks.find(at => at.gpu_id === g.id);
        const isIdle = !t;
        // Idle GPUs should always have a last_active_at timestamp; otherwise the UI
        // shows "Idle: unknown". If a wandb-created GPU lost its idle timestamp,
        // fall back to the creation time and schedule a DB repair.
        if (isIdle && !g.last_active_at) {
            gpusToRepair.push(g.id);
            return { ...g, last_active_at: g.created_at || now };
        }
        return { ...g };
    });

    // Persist the repaired timestamps in the background
    if (gpusToRepair.length > 0) {
        setTimeout(() => {
            db.updateTable('gpus')
                .set({ last_active_at: now })
                .where('id', 'in', gpusToRepair)
                .execute()
                .catch(err => console.error('[GpuService] repair last_active_at failed:', err));
        }, 0);
    }
    
    return result.map(g => {
        const t = activeTasks.find(at => at.gpu_id === g.id);
        return { ...g, activeTaskId: t ? t.id : undefined };
    }) as unknown as Gpu[];
  },

  async findGpuByHostId(hostId: string): Promise<Gpu | null> {
    const gpu = await db.selectFrom('gpus')
      .selectAll()
      .where('host_id', '=', hostId)
      .executeTakeFirst();
    return gpu as unknown as Gpu | null;
  },

  async cleanupWandbGpus(): Promise<void> {
    // 1. Delete wandb-tracked GPUs (host_id starts with 'wandb:')
    const wandbGpus = await db.selectFrom('gpus')
      .select(['id'])
      .where('host_id', 'like', 'wandb:%')
      .execute();
    for (const g of wandbGpus) {
      await this.deleteGpu(g.id);
    }

    // 2. Delete webhook auto-created GPUs (have webhook tasks with auto-generated titles)
    const webhookGpus = await db.selectFrom('gpus')
      .select('gpus.id')
      .distinct()
      .innerJoin('tasks', 'tasks.gpu_id', 'gpus.id')
      .where('tasks.is_webhook', '=', 1)
      .where('tasks.title', 'like', 'Training on %')
      .execute();
    for (const g of webhookGpus) {
      await this.deleteGpu(g.id);
    }

    // 3. Delete orphaned webhook tasks (no GPU, auto-generated title)
    await db.deleteFrom('tasks')
      .where('is_webhook', '=', 1)
      .where('title', 'like', 'Training on %')
      .execute();
  },

  async createGpu(name: string, color?: string): Promise<Gpu> {
    const defaultColors = ['#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#f59e0b'];
    const randomColor = color || defaultColors[Math.floor(Math.random() * defaultColors.length)];

    const result = await db.insertInto('gpus')
      .values({
          name,
          color: randomColor,
          created_at: new Date().toISOString()
      })
      .returningAll()
      .executeTakeFirstOrThrow();
      
    return result as unknown as Gpu;
  },

  async deleteGpu(id: number): Promise<void> {
      // Delete webhook tasks that were bound to this GPU (they should be deleted together)
      await db.deleteFrom('tasks')
        .where('gpu_id', '=', id)
        .where('is_webhook', '=', 1)
        .execute();

      // Unassign non-webhook tasks (move to queue / remove gpu_id)
      await db.updateTable('tasks')
        .set({ gpu_id: null, status: 'queued' })
        .where('gpu_id', '=', id)
        .where('status', '=', 'active')
        .execute();
        
      await db.deleteFrom('gpus').where('id', '=', id).execute();
  },

  async setGpuIdle(id: number): Promise<void> {
    await db.updateTable('gpus')
        .set({ last_active_at: new Date().toISOString() })
        .where('id', '=', id)
        .execute();
  },

  async setGpuBusy(id: number): Promise<void> {
    await db.updateTable('gpus')
        .set({ last_active_at: null })
        .where('id', '=', id)
        .execute();
  }
};

export const SettingsService = {
  async get<T extends SettingValue = SettingValue>(key: string, defaultValue?: T): Promise<T> {
    const res = await db.selectFrom('settings')
      .select('value')
      .where('key', '=', key)
      .executeTakeFirst();
    
    if (res) {
      try {
        return JSON.parse(res.value) as T;
      } catch {
        return res.value as T;
      }
    }
    return defaultValue as T;
  },

  async set(key: string, value: unknown): Promise<void> {
    const strVal = JSON.stringify(value);
    await db.insertInto('settings')
      .values({ key, value: strVal })
      .onConflict((oc) => oc.column('key').doUpdateSet({ value: strVal }))
      .execute();
  }
};

// Scheduler Services (independent from main task system)
export const SchedulerGpuService = {
  async getAll(): Promise<SchedulerGpu[]> {
    const gpus = await db.selectFrom('scheduler_gpus').selectAll().execute();
    return gpus as unknown as SchedulerGpu[];
  },

  async create(name: string, color?: string): Promise<SchedulerGpu> {
    const defaultColors = ['#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#f59e0b', '#ec4899'];
    const randomColor = color || defaultColors[Math.floor(Math.random() * defaultColors.length)];

    const result = await db.insertInto('scheduler_gpus')
      .values({ name, color: randomColor, created_at: new Date().toISOString() })
      .returningAll()
      .executeTakeFirstOrThrow();
    return result as unknown as SchedulerGpu;
  },

  async update(id: number, updates: Partial<SchedulerGpu>): Promise<void> {
    await db.updateTable('scheduler_gpus').set(updates).where('id', '=', id).execute();
  },

  async delete(id: number): Promise<void> {
    // Delete assignments for this GPU
    await db.deleteFrom('scheduler_assignments').where('gpu_id', '=', id).execute();
    await db.deleteFrom('scheduler_gpus').where('id', '=', id).execute();
  }
};

export const SchedulerTaskService = {
  async getAll(): Promise<SchedulerTask[]> {
    const tasks = await db.selectFrom('scheduler_tasks').selectAll().execute();
    return tasks as unknown as SchedulerTask[];
  },

  async create(title: string, estimatedHours: number = 1, color?: string): Promise<SchedulerTask> {
    const defaultColors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
    const randomColor = color || defaultColors[Math.floor(Math.random() * defaultColors.length)];

    const result = await db.insertInto('scheduler_tasks')
      .values({
        title,
        estimated_hours: estimatedHours,
        status: 'pending',
        color: randomColor,
        created_at: new Date().toISOString()
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return result as unknown as SchedulerTask;
  },

  async update(id: number, updates: Partial<SchedulerTask>): Promise<void> {
    await db.updateTable('scheduler_tasks').set(updates).where('id', '=', id).execute();
  },

  async delete(id: number): Promise<void> {
    // Delete assignments for this task
    await db.deleteFrom('scheduler_assignments').where('task_id', '=', id).execute();
    await db.deleteFrom('scheduler_tasks').where('id', '=', id).execute();
  }
};

export const SchedulerAssignmentService = {
  async getAll(): Promise<SchedulerAssignment[]> {
    const assignments = await db.selectFrom('scheduler_assignments').selectAll().execute();
    return assignments as unknown as SchedulerAssignment[];
  },

  async create(taskId: number, gpuId: number, startTime: string, durationHours: number): Promise<SchedulerAssignment> {
    const newStart = new Date(startTime);
    const newEnd = new Date(newStart.getTime() + durationHours * 60 * 60 * 1000);

    // Get all assignments for this GPU to check for conflicts
    const allAssignments = await db.selectFrom('scheduler_assignments')
      .selectAll()
      .where('gpu_id', '=', gpuId)
      .execute();

    const hasConflict = allAssignments.some(a => {
      const aStart = new Date(a.start_time);
      const aEnd = new Date(aStart.getTime() + a.duration_hours * 60 * 60 * 1000);
      return (newStart < aEnd && newEnd > aStart);
    });

    if (hasConflict) {
      throw new Error('Time slot conflict detected');
    }

    const result = await db.insertInto('scheduler_assignments')
      .values({
        task_id: taskId,
        gpu_id: gpuId,
        start_time: startTime,
        duration_hours: durationHours,
        created_at: new Date().toISOString()
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // Update task status
    await db.updateTable('scheduler_tasks')
      .set({ status: 'scheduled' })
      .where('id', '=', taskId)
      .execute();

    return result as unknown as SchedulerAssignment;
  },

  async update(id: number, updates: Partial<SchedulerAssignment>): Promise<void> {
    await db.updateTable('scheduler_assignments').set(updates).where('id', '=', id).execute();
  },

  async delete(id: number): Promise<void> {
    const assignment = await db.selectFrom('scheduler_assignments')
      .select('task_id')
      .where('id', '=', id)
      .executeTakeFirst();
    
    await db.deleteFrom('scheduler_assignments').where('id', '=', id).execute();
    
    // Update task status back to pending if no other assignments
    if (assignment) {
      const remaining = await db.selectFrom('scheduler_assignments')
        .select('id')
        .where('task_id', '=', assignment.task_id)
        .execute();
      
      if (remaining.length === 0) {
        await db.updateTable('scheduler_tasks')
          .set({ status: 'pending' })
          .where('id', '=', assignment.task_id)
          .execute();
      }
    }
  },

  async deleteByTask(taskId: number): Promise<void> {
    await db.deleteFrom('scheduler_assignments').where('task_id', '=', taskId).execute();
    await db.updateTable('scheduler_tasks')
      .set({ status: 'pending' })
      .where('id', '=', taskId)
      .execute();
  },

  async clearAll(): Promise<void> {
    await db.deleteFrom('scheduler_assignments').execute();
    await db.updateTable('scheduler_tasks').set({ status: 'pending' }).execute();
  }
};
