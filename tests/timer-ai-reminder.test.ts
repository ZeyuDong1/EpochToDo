/**
 * Integration tests for TimerManager's AI-reminder paths against the real
 * (shimmed) SQLite DB: hard reminders (success/needs_input/review) create
 * persistent notification tasks; ephemeral statuses only broadcast.
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
import { TimerManager } from '../electron/timer/manager';

interface Broadcast {
  channel: string;
  args: unknown[];
}

let manager: TimerManager;
let broadcasts: Broadcast[];

beforeAll(async () => {
  await initDB();
});

beforeEach(async () => {
  await db.deleteFrom('timers').execute();
  await db.deleteFrom('history').execute();
  await db.deleteFrom('tasks').execute();

  broadcasts = [];
  manager = new TimerManager();
  manager.setBroadcaster((channel: string, ...args: unknown[]) => {
    broadcasts.push({ channel, args });
  });
});

afterAll(async () => {
  await db.destroy();
  const { cleanupTempUserDataDir } = await import('./helpers/integration-env');
  const dir = (globalThis as Record<string, unknown>).__TEST_DB_DIR__;
  if (typeof dir === 'string') cleanupTempUserDataDir(dir);
});

describe('TimerManager.handleAiReminder', () => {
  it('success creates a persistent notification task and fires timer:ended', async () => {
    await manager.handleAiReminder({
      source: 'Claude Code',
      title: 'build passed',
      status: 'success',
      detail: '42 tests',
      link: 'https://ci/run/1',
    });

    const tasks = await db.selectFrom('tasks').selectAll().execute();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('🤖 Claude Code · build passed');
    expect(tasks[0].type).toBe('notification');

    const channels = broadcasts.map(b => b.channel);
    expect(channels).toContain('timer:ended');
    expect(channels).toContain('fetch-tasks');
    const ended = broadcasts.find(b => b.channel === 'timer:ended')!;
    expect(ended.args[1]).toMatchObject({ title: '🤖 Claude Code · build passed' });
  });

  it('needs_input also routes to the hard-reminder path', async () => {
    await manager.handleAiReminder({ source: 'bot', title: 'need approval', status: 'needs_input' });
    const tasks = await db.selectFrom('tasks').selectAll().execute();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('🤖 bot · need approval');
  });

  it('failure and progress stay ephemeral: no task, only ai:reminder broadcast', async () => {
    await manager.handleAiReminder({
      source: 'bot', title: 'crashed', status: 'failure', timestamp: 1_755_000_000,
    });
    await manager.handleAiReminder({ source: 'bot', title: 'halfway', status: 'progress' });

    expect(await db.selectFrom('tasks').selectAll().execute()).toHaveLength(0);

    const ai = broadcasts.filter(b => b.channel === 'ai:reminder');
    expect(ai).toHaveLength(2);
    // timestamp normalization: seconds → ms
    expect(ai[0].args[0]).toMatchObject({ status: 'failure', timestamp: 1_755_000_000_000 });
    expect(broadcasts.some(b => b.channel === 'timer:ended')).toBe(false);
  });

  it('rejects payloads without source/title', async () => {
    await expect(manager.handleAiReminder({ title: 'orphan' })).rejects.toThrow(/source/);
    await expect(manager.handleAiReminder({ source: 'bot' })).rejects.toThrow(/title/);
  });
});

describe('TimerManager.promoteAiReminder', () => {
  it('creates a reminder task with an already-expired wait timer (soft reminder)', async () => {
    await manager.promoteAiReminder({
      source: 'Cursor', title: 'review ready', detail: 'pr #142', link: 'https://pr/142',
    });

    const tasks = await db.selectFrom('tasks').selectAll().execute();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('🤖 Cursor · review ready');
    expect(tasks[0].type).toBe('reminder');
    expect(tasks[0].status).toBe('waiting');
    expect(tasks[0].context_memo).toBe('pr #142\nhttps://pr/142');

    const timers = await db.selectFrom('timers').selectAll().execute();
    expect(timers).toHaveLength(1);
    expect(timers[0].type).toBe('wait');
    // target in the past → surfaces immediately as an expired soft reminder
    expect(new Date(timers[0].target_timestamp!).getTime()).toBeLessThanOrEqual(Date.now());
    expect(broadcasts.some(b => b.channel === 'fetch-tasks')).toBe(true);
  });
});
