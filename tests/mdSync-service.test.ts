/**
 * Integration test for the in-app rename flow against the MD file:
 * updateTaskInMd must rewrite the bound line in place so that the following
 * merge does not append a duplicate and the file-watcher sync does not
 * resurrect the old title as a new task.
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

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db, initDB } from '../electron/db';
import { TaskService } from '../electron/db/service';
import {
  importFromMd,
  mergeTasksToMd,
  syncWithMd,
  updateTaskInMd,
  EPOCHTODO_FILENAME,
} from '../electron/mdSync/service';
import { hashContent } from '../electron/mdSync/pure';

let folder: string;
let filePath: string;

beforeAll(async () => {
  await initDB();
  const userData = (globalThis as Record<string, unknown>).__TEST_DB_DIR__ as string;
  folder = join(userData, 'notes');
  mkdirSync(folder, { recursive: true });
  filePath = join(folder, EPOCHTODO_FILENAME);
});

beforeEach(async () => {
  await db.deleteFrom('timers').execute();
  await db.deleteFrom('tasks').execute();
  writeFileSync(filePath, '- [ ] old task\n', 'utf-8');
});

afterAll(async () => {
  await db.destroy();
  const { cleanupTempUserDataDir } = await import('./helpers/integration-env');
  const dir = (globalThis as Record<string, unknown>).__TEST_DB_DIR__;
  if (typeof dir === 'string') cleanupTempUserDataDir(dir);
});

describe('in-app rename keeps the MD file consistent', () => {
  it('updateTaskInMd rewrites the line and the subsequent merge does not duplicate it', async () => {
    const { created } = await importFromMd(filePath, true);
    expect(created).toBe(1);
    const [task] = await TaskService.getAllTasks();
    expect(task.title).toBe('old task');
    expect(task.md_file_path).toBe(filePath);

    // What main.ts now does on update-task with a title:
    await updateTaskInMd(filePath, task.id, 'renamed task');

    expect(readFileSync(filePath, 'utf-8')).toBe('- [ ] renamed task\n');

    // The task's DB title is updated afterwards by the same IPC flow
    await TaskService.updateTask(task.id, { title: 'renamed task' });

    // Export-merge (triggered by broadcastFetchTasks) must not append a copy
    await mergeTasksToMd(filePath, await TaskService.getAllTasks());
    const afterMerge = readFileSync(filePath, 'utf-8');
    expect(afterMerge).toBe('- [ ] renamed task\n');

    // And the file→DB sync must not resurrect the old title
    const result = await syncWithMd(filePath);
    expect(result.created).toBe(0);
    const tasks = await TaskService.getAllTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('renamed task');
    expect(tasks[0].md_line_hash).toBe(hashContent('renamed task'));
  });

  it('updateTaskInMd is a no-op for tasks without an MD binding', async () => {
    const task = await TaskService.createTask('unbound');
    writeFileSync(filePath, '- [ ] something else\n', 'utf-8');
    await updateTaskInMd(filePath, task.id, 'new name');
    expect(readFileSync(filePath, 'utf-8')).toBe('- [ ] something else\n');
  });
});
