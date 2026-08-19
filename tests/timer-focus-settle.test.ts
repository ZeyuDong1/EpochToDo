/**
 * Regression tests for focus-session settlement:
 * suspending a focused task (@25m) must accumulate the elapsed focus time
 * and write history instead of silently dropping the timer row.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

vi.mock('electron', async () => {
  const { makeTempUserDataDir } = await import('./helpers/integration-env');
  const dir = makeTempUserDataDir();
  (globalThis as Record<string, unknown>).__TEST_DB_DIR__ = dir;
  return { app: { getPath: () => dir } };
});

vi.mock('better-sqlite3', async () => {
  const { BetterSqlite3Shim } = await import('./helpers/integration-env');
  return { default: BetterSqlite3Shim };
});

import { db, initDB } from '../electron/db';
import { TaskService } from '../electron/db/service';
import { TimerManager } from '../electron/timer/manager';

let manager: TimerManager;

beforeAll(async () => {
  await initDB();
});

beforeEach(async () => {
  await db.deleteFrom('timers').execute();
  await db.deleteFrom('history').execute();
  await db.deleteFrom('tasks').execute();

  manager = new TimerManager();
  manager.setBroadcaster(vi.fn());
});

afterAll(async () => {
  await db.destroy();
  const { cleanupTempUserDataDir } = await import('./helpers/integration-env');
  const dir = (globalThis as Record<string, unknown>).__TEST_DB_DIR__;
  if (typeof dir === 'string') cleanupTempUserDataDir(dir);
});

/** Insert a focus timer whose session started `minutes` ago (simulates a
 *  long-running session without waiting in real time). */
async function seedFocusSession(taskId: number, minutes: number): Promise<void> {
  const startedAt = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  await db.insertInto('timers')
    .values({ task_id: taskId, type: 'focus', started_at: startedAt, target_timestamp: null, original_duration: null })
    .execute();
  await db.updateTable('tasks').set({ status: 'active' }).where('id', '=', taskId).execute();
}

describe('startWait settles the focus session first', () => {
  it('accumulates elapsed time, writes history, and no focus timer remains', async () => {
    const task = await TaskService.createTask('deep work');
    await seedFocusSession(task.id, 10); // 10-minute session

    await manager.startWait(task.id, 300);

    const [row] = await db.selectFrom('tasks').select(['status', 'total_duration']).where('id', '=', task.id).execute();
    expect(row.status).toBe('waiting');
    expect(row.total_duration).toBeGreaterThanOrEqual(599);
    expect(row.total_duration).toBeLessThanOrEqual(600);

    const history = await db.selectFrom('history').selectAll().execute();
    expect(history).toHaveLength(1);
    expect(history[0].task_id).toBe(task.id);
    expect(history[0].type).toBe('focus');

    const timers = await db.selectFrom('timers').selectAll().execute();
    expect(timers).toHaveLength(1);
    expect(timers[0].type).toBe('wait');
  });

  it('propagates the settled duration to parent tasks', async () => {
    const parent = await TaskService.createTask('parent');
    const child = await TaskService.createTask('child', undefined, 'standard', undefined, parent.id);
    await seedFocusSession(child.id, 5);

    await manager.startWait(child.id, 60);

    const [p] = await db.selectFrom('tasks').select('total_duration').where('id', '=', parent.id).execute();
    expect(p.total_duration).toBeGreaterThanOrEqual(299);
  });

  it('discards sessions shorter than 3 minutes (existing behavior)', async () => {
    const task = await TaskService.createTask('quick');
    await seedFocusSession(task.id, 1); // 1-minute session

    await manager.startWait(task.id, 60);

    const [row] = await db.selectFrom('tasks').select(['status', 'total_duration']).where('id', '=', task.id).execute();
    expect(row.status).toBe('waiting');
    expect(row.total_duration).toBe(0);
    expect(await db.selectFrom('history').selectAll().execute()).toHaveLength(0);
  });
});

describe('stopFocus still settles and requeues', () => {
  it('accounts time and returns the task to queued', async () => {
    const task = await TaskService.createTask('stop me');
    await seedFocusSession(task.id, 10);

    await manager.stopFocus();

    const [row] = await db.selectFrom('tasks').select(['status', 'total_duration']).where('id', '=', task.id).execute();
    expect(row.status).toBe('queued');
    expect(row.total_duration).toBeGreaterThanOrEqual(599);
    expect(await db.selectFrom('timers').selectAll().execute()).toHaveLength(0);
  });
});
