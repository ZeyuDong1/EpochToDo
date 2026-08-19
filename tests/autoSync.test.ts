/**
 * Integration tests for AutoSyncManager — real temp folder, real file
 * watcher, real SQLite (via the node:sqlite shim). These exercise the
 * full bidirectional pipeline including debounce timings, so they run
 * in real time and take a few seconds.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';

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
import { AutoSyncManager } from '../electron/mdSync/autoSync';
import { EPOCHTODO_FILENAME } from '../electron/mdSync/service';

let folder: string;
let filePath: string;
let onSyncComplete: ReturnType<typeof vi.fn>;
let manager: AutoSyncManager;

beforeAll(async () => {
  await initDB();
});

beforeEach(async () => {
  await db.deleteFrom('timers').execute();
  await db.deleteFrom('history').execute();
  await db.deleteFrom('tasks').execute();

  const userData = (globalThis as Record<string, unknown>).__TEST_DB_DIR__ as string;
  folder = join(userData, `notes-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(folder, { recursive: true });
  filePath = join(folder, EPOCHTODO_FILENAME);

  onSyncComplete = vi.fn();
  manager = new AutoSyncManager(() => onSyncComplete());
});

afterEach(() => {
  manager.stop();
});

afterAll(async () => {
  await db.destroy();
  const { cleanupTempUserDataDir } = await import('./helpers/integration-env');
  const dir = (globalThis as Record<string, unknown>).__TEST_DB_DIR__;
  if (typeof dir === 'string') cleanupTempUserDataDir(dir);
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait until cond() is truthy (real-time, for debounced watcher paths) */
async function waitFor(cond: () => boolean, timeoutMs = 12_000): Promise<void> {
  await vi.waitFor(
    () => {
      if (!cond()) throw new Error('condition not met yet');
    },
    { timeout: timeoutMs, interval: 200 }
  );
}

const readMd = () => {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
};

describe('AutoSyncManager', () => {
  it('creates epochtodo.md from DB tasks when the file does not exist', async () => {
    await TaskService.createTask('seed task');

    await manager.start(folder);

    expect(readMd()).toContain('- [ ] seed task');
    expect(manager.getStatus().enabled).toBe(true);
    expect(manager.getStatus().lastError).toBeNull();
  });

  it('imports existing MD bullets into the DB on start', async () => {
    writeFileSync(filePath, '- [ ] from md\n  - [ ] md child\n', 'utf-8');

    await manager.start(folder);

    const tasks = await TaskService.getAllTasks();
    const root = tasks.find(t => t.title === 'from md');
    const child = tasks.find(t => t.title === 'md child');
    expect(root).toBeDefined();
    expect(child).toBeDefined();
    expect(child!.parent_id).toBe(root!.id);
    expect(root!.status).toBe('queued');
    expect(root!.is_next_action).toBe(1);
    expect(root!.md_file_path).toBe(filePath);
  });

  it('detects an external MD edit and syncs the new bullet into the DB', async () => {
    writeFileSync(filePath, '- [ ] original\n', 'utf-8');
    await manager.start(folder);

    // Wait for the import to land and the write-suppression window to clear
    await waitFor(async () => (await TaskService.getAllTasks()).some(t => t.title === 'original'));
    await sleep(1800);

    // External edit: append a new bullet
    writeFileSync(filePath, '- [ ] original\n- [ ] added externally\n', 'utf-8');

    await waitFor(async () => (await TaskService.getAllTasks()).some(t => t.title === 'added externally'));
    expect(onSyncComplete).toHaveBeenCalled();
  }, 20_000);

  it('checking a bullet off in the MD deletes the active task from the DB', async () => {
    writeFileSync(filePath, '- [ ] to be checked\n', 'utf-8');
    await manager.start(folder);
    await waitFor(async () => (await TaskService.getAllTasks()).some(t => t.title === 'to be checked'));
    await sleep(1800);

    // User ticks the checkbox in their editor
    writeFileSync(filePath, '- [x] to be checked\n', 'utf-8');

    await waitFor(async () => !(await TaskService.getAllTasks()).some(t => t.title === 'to be checked'));
  }, 20_000);

  it('triggerExport writes newly created tasks back into the MD file', async () => {
    await TaskService.createTask('pre-existing');
    await manager.start(folder);
    await waitFor(() => (readMd() ?? '').includes('pre-existing'));

    await TaskService.createTask('created after start');
    manager.triggerExport();

    await waitFor(() => (readMd() ?? '').includes('created after start'));
    const content = readMd()!;
    expect(content.indexOf('pre-existing')).toBeGreaterThan(-1);
    expect(content.indexOf('created after start')).toBeGreaterThan(-1);
  }, 20_000);

  it('stop() disables sync: further triggers are ignored', async () => {
    writeFileSync(filePath, '- [ ] base\n', 'utf-8');
    await manager.start(folder);
    manager.stop();

    await TaskService.createTask('never exported');
    manager.triggerExport();
    await sleep(1200);

    expect(readMd()).not.toContain('never exported');
    expect(manager.getStatus().enabled).toBe(false);
  });
});
