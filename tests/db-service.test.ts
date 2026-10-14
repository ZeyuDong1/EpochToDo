/**
 * Integration tests for the database services against a real SQLite
 * database. The `electron` module is mocked so `app.getPath('userData')`
 * points at a fresh temp dir per test file — the DB singleton then
 * creates its file there.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

vi.mock('electron', async () => {
  const { makeTempUserDataDir } = await import('./helpers/integration-env');
  const dir = makeTempUserDataDir();
  (globalThis as Record<string, unknown>).__TEST_DB_DIR__ = dir;
  return { app: { getPath: () => dir } };
});

// better-sqlite3's shipped binary targets Electron's ABI; substitute the
// node:sqlite shim so tests run on the system Node.
vi.mock('better-sqlite3', async () => {
  const { BetterSqlite3Shim } = await import('./helpers/integration-env');
  return { default: BetterSqlite3Shim };
});

import { db, initDB } from '../electron/db';
import {
  TaskService,
  HistoryService,
  ProjectService,
  SettingsService,
  GpuService,
  SchedulerGpuService,
  SchedulerTaskService,
  SchedulerAssignmentService,
} from '../electron/db/service';

beforeAll(async () => {
  await initDB();
});

beforeEach(async () => {
  // Full state reset between cases (order respects FK cascade)
  await db.deleteFrom('scheduler_assignments').execute();
  await db.deleteFrom('scheduler_tasks').execute();
  await db.deleteFrom('scheduler_gpus').execute();
  await db.deleteFrom('timers').execute();
  await db.deleteFrom('history').execute();
  await db.deleteFrom('settings').execute();
  await db.deleteFrom('tasks').execute();
  await db.deleteFrom('projects').execute();
  await db.deleteFrom('gpus').execute();
});

afterAll(async () => {
  await db.destroy();
  const dir = (globalThis as Record<string, unknown>).__TEST_DB_DIR__;
  if (typeof dir === 'string') {
    const { cleanupTempUserDataDir } = await import('./helpers/integration-env');
    cleanupTempUserDataDir(dir);
  }
});

describe('initDB', () => {
  it('is idempotent (safe to run twice)', async () => {
    await initDB();
    await initDB();
    const t = await TaskService.createTask('survives re-init');
    expect(t.id).toBeGreaterThan(0);
  });
});

describe('TaskService', () => {
  it('creates tasks with Dashboard-visible defaults', async () => {
    const t = await TaskService.createTask('write tests');
    expect(t.title).toBe('write tests');
    expect(t.status).toBe('queued');
    expect(t.type).toBe('standard');
    expect(t.is_next_action).toBe(1);
    expect(t.total_duration).toBe(0);
    expect(t.project_id).toBeNull();
    expect(t.sort_order).toBeGreaterThan(0);
  });

  it('deduplicates by title unless skipDedup or archived', async () => {
    const a = await TaskService.createTask('same title');
    const b = await TaskService.createTask('same title');
    expect(b.id).toBe(a.id);

    await TaskService.updateTaskStatus(a.id, 'archived');
    const c = await TaskService.createTask('same title');
    expect(c.id).not.toBe(a.id);

    const d = await TaskService.createTask('same title', undefined, 'standard', undefined, undefined, true);
    expect(d.id).not.toBe(c.id);
  });

  it('never deduplicates training tasks', async () => {
    const a = await TaskService.createTask('train run', undefined, 'training');
    const b = await TaskService.createTask('train run', undefined, 'training');
    expect(b.id).not.toBe(a.id);
  });

  it('merges timer columns into getAllTasks and dedups duplicate timer rows', async () => {
    const t = await TaskService.createTask('timed task');
    // Two timer rows for one task (the "rare bug case") — dedup must keep
    // the row WITH timer data whichever order the join returns.
    await db.insertInto('timers')
      .values({ task_id: t.id, type: 'focus', target_timestamp: null, original_duration: null, started_at: null })
      .execute();
    await db.insertInto('timers')
      .values({ task_id: t.id, type: 'focus', target_timestamp: '2026-08-19T10:00:00Z', original_duration: 600, started_at: '2026-08-19T09:50:00Z' })
      .execute();

    const all = await TaskService.getAllTasks();
    const mine = all.filter(x => x.id === t.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].started_at).toBe('2026-08-19T09:50:00Z');
    expect(mine[0].target_timestamp).toBe('2026-08-19T10:00:00Z');
    expect(mine[0].timer_type).toBe('focus');
  });

  it('appendMemo appends with newline separation', async () => {
    const t = await TaskService.createTask('memo target');
    await TaskService.appendMemo(t.id, 'first');
    await TaskService.appendMemo(t.id, 'second');
    const [row] = await db.selectFrom('tasks').select('context_memo').where('id', '=', t.id).execute();
    expect(row.context_memo).toBe('first\nsecond');
  });

  it('deleteTask removes the whole subtree (children and grandchildren)', async () => {
    const root = await TaskService.createTask('root');
    const child = await TaskService.createTask('child', undefined, 'standard', undefined, root.id);
    await TaskService.createTask('grandchild', undefined, 'standard', undefined, child.id);
    await TaskService.createTask('unrelated');

    await TaskService.deleteTask(root.id);

    const titles = (await TaskService.getAllTasks()).map(t => t.title);
    expect(titles).toEqual(['unrelated']);
  });

  it('deleteAllTasks clears tasks and history', async () => {
    const t = await TaskService.createTask('doomed');
    await db.insertInto('history').values({
      task_id: t.id, title: 'doomed', type: 'focus',
      start_time: '2026-08-19T09:00:00Z', end_time: '2026-08-19T09:25:00Z',
    }).execute();

    await TaskService.deleteAllTasks();

    expect(await TaskService.getAllTasks()).toHaveLength(0);
    expect(await HistoryService.getHistory()).toHaveLength(0);
  });
});

describe('HistoryService', () => {
  it('filters by date prefix and deletes single entries', async () => {
    const t = await TaskService.createTask('historical');
    await db.insertInto('history').values([
      { task_id: t.id, title: 'a', type: 'focus', start_time: '2026-08-18T09:00:00Z', end_time: '2026-08-18T09:25:00Z' },
      { task_id: t.id, title: 'b', type: 'focus', start_time: '2026-08-19T09:00:00Z', end_time: '2026-08-19T09:25:00Z' },
    ]).execute();

    const aug19 = await HistoryService.getHistory('2026-08-19');
    expect(aug19.map(h => h.title)).toEqual(['b']);

    await HistoryService.deleteHistory(aug19[0].id);
    expect(await HistoryService.getHistory()).toHaveLength(1);
  });
});

describe('ProjectService', () => {
  it('computes per-project stats excluding archived tasks', async () => {
    const p = await ProjectService.createProject('Epoch', undefined, '#ff0000');
    await TaskService.createTask('active one', undefined, 'standard', p.id);
    const done = await TaskService.createTask('done one', undefined, 'standard', p.id);
    await db.updateTable('tasks').set({ total_duration: 120 }).where('id', '=', done.id).execute();
    await TaskService.updateTaskStatus(done.id, 'archived');

    const projects = await ProjectService.getAllProjects();
    const proj = projects.find(x => x.id === p.id)!;
    expect(proj.activeCount).toBe(1);       // archived task not counted
    expect(proj.totalFocused).toBe(0);      // its 120s not summed
  });

  it('deleteProject unassigns its tasks instead of deleting them', async () => {
    const p = await ProjectService.createProject('Doomed');
    const t = await TaskService.createTask('orphaned', undefined, 'standard', p.id);

    await ProjectService.deleteProject(p.id);

    const [row] = await db.selectFrom('tasks').selectAll().where('id', '=', t.id).execute();
    expect(row.project_id).toBeNull();
    expect(await ProjectService.getAllProjects()).toHaveLength(0);
  });
});

describe('SettingsService', () => {
  it('round-trips JSON values and overwrites on conflict', async () => {
    await SettingsService.set('key_str', 'hello');
    await SettingsService.set('key_num', 42);
    await SettingsService.set('key_bool', true);
    await SettingsService.set('key_obj', { nested: { deep: [1, 2] } });

    expect(await SettingsService.get('key_str')).toBe('hello');
    expect(await SettingsService.get('key_num')).toBe(42);
    expect(await SettingsService.get('key_bool')).toBe(true);
    expect(await SettingsService.get<{ nested: { deep: number[] } }>('key_obj')).toEqual({ nested: { deep: [1, 2] } });

    await SettingsService.set('key_str', 'updated');
    expect(await SettingsService.get('key_str')).toBe('updated');
  });

  it('returns the default for missing keys', async () => {
    expect(await SettingsService.get('missing', 'fallback')).toBe('fallback');
    expect(await SettingsService.get('missing_num', 15)).toBe(15);
  });

  it('returns raw string when the stored value is not valid JSON', async () => {
    await db.insertInto('settings').values({ key: 'raw', value: 'not json {' }).execute();
    expect(await SettingsService.get('raw')).toBe('not json {');
  });
});

describe('GpuService', () => {
  it('reports activeTaskId only for active training tasks on that GPU', async () => {
    const gpu = await GpuService.createGpu('A100');
    const busy = await TaskService.createTask('train A', undefined, 'training');
    await db.updateTable('tasks').set({ gpu_id: gpu.id, status: 'active' }).where('id', '=', busy.id).execute();
    const queued = await TaskService.createTask('queued train', undefined, 'training');
    await db.updateTable('tasks').set({ gpu_id: gpu.id, status: 'queued' }).where('id', '=', queued.id).execute();

    const gpus = await GpuService.getAllGpus();
    expect(gpus[0].activeTaskId).toBe(busy.id);
  });

  it('repairs a missing last_active_at in the background', async () => {
    // Simulate the wandb-created GPU that lost its idle timestamp
    const gpu = await db.insertInto('gpus')
      .values({ name: 'H100', color: '#00ff00', created_at: '2026-08-01T00:00:00Z', last_active_at: null, host_id: null })
      .returningAll().executeTakeFirstOrThrow();

    const gpus = await GpuService.getAllGpus();
    expect(gpus[0].last_active_at).toBe('2026-08-01T00:00:00Z'); // created_at fallback

    // The repair itself is scheduled via setTimeout(0) — let it run
    await new Promise(r => setTimeout(r, 20));
    const [row] = await db.selectFrom('gpus').selectAll().where('id', '=', gpu.id).execute();
    expect(row.last_active_at).not.toBeNull();
  });

  it('deleteGpu removes webhook tasks, requeues active standard tasks, drops the gpu', async () => {
    const gpu = await GpuService.createGpu('A100');
    const webhook = await TaskService.createTask('Training on A100', undefined, 'training', undefined, undefined, true);
    await db.updateTable('tasks').set({ gpu_id: gpu.id, status: 'active', is_webhook: 1 }).where('id', '=', webhook.id).execute();
    const mine = await TaskService.createTask('my training', undefined, 'training', undefined, undefined, true);
    await db.updateTable('tasks').set({ gpu_id: gpu.id, status: 'active' }).where('id', '=', mine.id).execute();

    await GpuService.deleteGpu(gpu.id);

    const all = await TaskService.getAllTasks();
    const titles = all.map(t => t.title);
    expect(titles).not.toContain('Training on A100');   // webhook task deleted
    const mineRow = all.find(t => t.id === mine.id)!;
    expect(mineRow.gpu_id).toBeNull();
    expect(mineRow.status).toBe('queued');              // unassigned → back to queue
    expect(await db.selectFrom('gpus').selectAll().execute()).toHaveLength(0);
  });
});

describe('Scheduler services', () => {
  it('creates assignments, rejects overlaps, and resets task status on delete', async () => {
    const gpu = await SchedulerGpuService.create('SGPU');
    const task = await SchedulerTaskService.create('job', 2);

    const a = await SchedulerAssignmentService.create(task.id, gpu.id, '2026-08-19T10:00:00Z', 2); // 10:00–12:00
    await expect(
      SchedulerAssignmentService.create(task.id, gpu.id, '2026-08-19T11:00:00Z', 1)
    ).rejects.toThrow(/conflict/i);
    const b = await SchedulerAssignmentService.create(task.id, gpu.id, '2026-08-19T13:00:00Z', 1); // no overlap

    const [scheduled] = await db.selectFrom('scheduler_tasks').select('status').where('id', '=', task.id).execute();
    expect(scheduled.status).toBe('scheduled');

    await SchedulerAssignmentService.delete(a.id);
    await SchedulerAssignmentService.delete(b.id);
    const [pending] = await db.selectFrom('scheduler_tasks').select('status').where('id', '=', task.id).execute();
    expect(pending.status).toBe('pending');
  });
});

describe('TaskService.setSideFocus', () => {
  it('enforces the two-task secondary focus limit', async () => {
    const a = await TaskService.createTask('副A', undefined, 'standard');
    const b = await TaskService.createTask('副B', undefined, 'standard');
    const c = await TaskService.createTask('副C', undefined, 'standard');

    expect(await TaskService.setSideFocus(a.id, true)).toBe(true);
    expect(await TaskService.setSideFocus(b.id, true)).toBe(true);
    // Third flag exceeds the cap: rejected, nothing changes
    expect(await TaskService.setSideFocus(c.id, true)).toBe(false);
    const all = await TaskService.getAllTasks();
    expect(all.find(t => t.id === a.id)?.is_side_focus).toBe(1);
    expect(all.find(t => t.id === c.id)?.is_side_focus).toBe(0);

    // Unflagging frees a slot
    expect(await TaskService.setSideFocus(a.id, false)).toBe(true);
    expect(await TaskService.setSideFocus(c.id, true)).toBe(true);

    // Re-flagging an already-flagged task never trips the limit
    expect(await TaskService.setSideFocus(c.id, true)).toBe(true);
  });
});

describe('TaskService.setSideFocus slot accounting', () => {
  it('archived or currently-active flagged tasks do not occupy a slot', async () => {
    const a = await TaskService.createTask('副占位A', undefined, 'standard');
    const b = await TaskService.createTask('副占位B', undefined, 'standard');
    const c = await TaskService.createTask('副占位C', undefined, 'standard');

    await TaskService.setSideFocus(a.id, true);
    await TaskService.setSideFocus(b.id, true);

    // b becomes the main focus (status 'active') → hidden from the side row → slot freed
    await TaskService.updateTaskStatus(b.id, 'active');
    expect(await TaskService.setSideFocus(c.id, true)).toBe(true);

    // archiving a flagged task also frees its slot
    await TaskService.updateTaskStatus(a.id, 'archived');
    const d = await TaskService.createTask('副占位D', undefined, 'standard');
    expect(await TaskService.setSideFocus(d.id, true)).toBe(true);
  });
});

describe('TaskService.pickSideFocusPromotion', () => {
  it('prefers the candidate with the most recent focus history', async () => {
    const a = await TaskService.createTask('晋升A', undefined, 'standard');
    const b = await TaskService.createTask('晋升B', undefined, 'standard');
    await TaskService.setSideFocus(a.id, true);
    await TaskService.setSideFocus(b.id, true);
    await TaskService.updateTask(a.id, { last_focused_at: '2026-01-05T00:00:00.000Z' });
    await TaskService.updateTask(b.id, { last_focused_at: '2026-03-01T00:00:00.000Z' });

    expect(await TaskService.pickSideFocusPromotion(999)).toBe(b.id);

    // a becomes the most recent → it wins instead
    await TaskService.updateTask(a.id, { last_focused_at: '2026-06-01T00:00:00.000Z' });
    expect(await TaskService.pickSideFocusPromotion(999)).toBe(a.id);
  });

  it('falls back to the earliest-flagged side when no focus history exists', async () => {
    const a = await TaskService.createTask('无史A', undefined, 'standard');
    const b = await TaskService.createTask('无史B', undefined, 'standard');
    await TaskService.setSideFocus(a.id, true);
    await TaskService.updateTask(a.id, { side_focus_at: '2026-05-01T00:00:00.000Z' });
    await TaskService.setSideFocus(b.id, true);
    await TaskService.updateTask(b.id, { side_focus_at: '2026-02-01T00:00:00.000Z' });

    expect(await TaskService.pickSideFocusPromotion(999)).toBe(b.id);
  });

  it('history beats recency of flagging, and null candidates are excluded', async () => {
    const noHist = await TaskService.createTask('无史C', undefined, 'standard');
    const hasHist = await TaskService.createTask('有史D', undefined, 'standard');
    await TaskService.setSideFocus(noHist.id, true); // flagged later
    await TaskService.setSideFocus(hasHist.id, true);
    await TaskService.updateTask(hasHist.id, { last_focused_at: '2026-01-01T00:00:00.000Z' });

    expect(await TaskService.pickSideFocusPromotion(999)).toBe(hasHist.id);
    expect(await TaskService.pickSideFocusPromotion(hasHist.id)).toBe(noHist.id);
  });

  it('returns null when there are no candidates', async () => {
    expect(await TaskService.pickSideFocusPromotion(999)).toBeNull();
  });

  it('setSideFocus stamps side_focus_at when enabling and clears the flag when disabling', async () => {
    const t = await TaskService.createTask('盖章E', undefined, 'standard');
    await TaskService.setSideFocus(t.id, true);
    let row = (await TaskService.getAllTasks()).find(x => x.id === t.id)!;
    expect(row.is_side_focus).toBe(1);
    expect(row.side_focus_at).toBeTruthy();

    await TaskService.setSideFocus(t.id, false);
    row = (await TaskService.getAllTasks()).find(x => x.id === t.id)!;
    expect(row.is_side_focus).toBe(0);
  });
});
