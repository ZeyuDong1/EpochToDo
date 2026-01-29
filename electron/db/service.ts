import { db } from './index';
import { Task, Project, HistoryEntry, Gpu } from '../../src/shared/types';

export const TaskService = {
  async createTask(title: string, tag?: string, type: Task['type'] = 'standard', projectId?: number, parentId?: number): Promise<Task> {
    // Check for existing non-archived task with same title
    const existing = await db.selectFrom('tasks')
      .selectAll()
      .where('title', '=', title)
      .where('status', '!=', 'archived')
      .executeTakeFirst();
    
    if (existing) {
        return existing as unknown as Task;
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
        'tasks.sort_order',
        'tasks.created_at',
        'timers.started_at as started_at',
        'timers.target_timestamp as target_timestamp',
        'timers.type as timer_type',
        'tasks.gpu_id',
        'tasks.last_focused_at'
      ])
      .orderBy('tasks.sort_order', 'asc')
      .execute();

    // Deduplicate: If multiple timers exist for a task (rare bug case), prefer the one with active timer data
    const taskMap = new Map<number, any>();
    for (const row of tasks) {
        if (!taskMap.has(row.id)) {
            taskMap.set(row.id, row);
        } else {
            const existing = taskMap.get(row.id);
            // Replace if new row has timer info and existing doesn't
            if ((row.started_at || row.target_timestamp) && (!existing.started_at && !existing.target_timestamp)) {
                taskMap.set(row.id, row);
            }
        }
    }

    return Array.from(taskMap.values()) as unknown as Task[];
  },

  async updateTaskStatus(id: number, status: Task['status']): Promise<void> {
    await db.updateTable('tasks').set({ status }).where('id', '=', id).execute();
  },

  async updateTask(id: number, updates: Partial<Task>): Promise<void> {
    // @ts-ignore
    await db.updateTable('tasks').set(updates).where('id', '=', id).execute();
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
    await db.deleteFrom('tasks').where('id', '=', id).execute();
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

  async updateProject(id: number, updates: Partial<Project>): Promise<void> {
      await db.updateTable('projects')
        .set({
            ...updates,
            // @ts-ignore
            id: undefined, // ensure id is not overwritten
            // @ts-ignore
            created_at: undefined
        })
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
      
    return gpus.map(g => {
        const t = activeTasks.find(at => at.gpu_id === g.id);
        return {
            ...g,
            activeTaskId: t ? t.id : undefined
        };
    }) as unknown as Gpu[];
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
      // Unassign tasks (move to queue / remove gpu_id)
      await db.updateTable('tasks')
        .set({ gpu_id: null, status: 'queued' })
        .where('gpu_id', '=', id)
        .where('status', '=', 'active') // Only if active? Or all assigned? Specs say Active training uses GPU.
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
  async get(key: string, defaultValue?: any): Promise<any> {
    const res = await db.selectFrom('settings')
      .select('value')
      .where('key', '=', key)
      .executeTakeFirst();
    
    if (res) {
      try {
        return JSON.parse(res.value);
      } catch (e) {
        return res.value;
      }
    }
    return defaultValue;
  },

  async set(key: string, value: any): Promise<void> {
    const strVal = JSON.stringify(value);
    await db.insertInto('settings')
      .values({ key, value: strVal })
      .onConflict((oc) => oc.column('key').doUpdateSet({ value: strVal }))
      .execute();
  }
};
