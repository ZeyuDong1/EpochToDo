/**
 * Regression tests for WandbPoller's finished-run detection:
 * a transient getRunState failure (null) must NOT be treated as 'finished'.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WandbRunFull } from '../electron/wandb/client';

const getRecentProjects = vi.fn<() => Promise<{ id: string; name: string; entity: string }[]>>();
const getRunningRuns = vi.fn<() => Promise<WandbRunFull[]>>();
const getRunState = vi.fn<() => Promise<WandbRunFull['state'] | null>>();

vi.mock('../electron/wandb/client', () => ({
  getRecentProjects: (...args: unknown[]) => getRecentProjects(...(args as [])),
  getRunningRuns: (...args: unknown[]) => getRunningRuns(...(args as [])),
  getRunState: (...args: unknown[]) => getRunState(...(args as [])),
}));

import { WandbPoller } from '../electron/wandb/poller';

const RUN: WandbRunFull = {
  id: 'run1',
  name: 'pretrain-llama',
  state: 'running',
  config: {},
  summaryMetrics: {},
  project: 'llm-lab',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let poller: WandbPoller | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  getRecentProjects.mockResolvedValue([{ id: 'llm-lab', name: 'llm-lab', entity: 'me' }]);
});

afterEach(() => {
  poller?.stop();
  poller = null;
});

describe('WandbPoller finished-run detection', () => {
  it('keeps tracking a run when getRunState fails (no premature finish)', async () => {
    getRunningRuns.mockResolvedValueOnce([RUN]).mockResolvedValue([]); // seen once, then gone
    getRunState.mockResolvedValue(null); // transient API error

    const results: { active: WandbRunFull[]; finished: WandbRunFull[] }[] = [];
    poller = new WandbPoller({ entity: 'me', apiKey: 'k', intervalMs: 40 }, (r) => results.push(r));
    poller.start();

    await vi.waitFor(() => expect(results.length).toBeGreaterThanOrEqual(1));
    await sleep(250); // several more polls with the run absent + state unknown

    const finished = results.filter((r) => r.finished.length > 0);
    expect(finished).toHaveLength(0);
  });

  it('reports the run as finished once a concrete state is known', async () => {
    getRunningRuns.mockResolvedValueOnce([RUN]).mockResolvedValue([]);
    getRunState.mockResolvedValue('crashed');

    const results: { active: WandbRunFull[]; finished: WandbRunFull[] }[] = [];
    poller = new WandbPoller({ entity: 'me', apiKey: 'k', intervalMs: 40 }, (r) => results.push(r));
    poller.start();

    await vi.waitFor(() => expect(results.some((r) => r.finished.length > 0)).toBe(true));
    const fin = results.find((r) => r.finished.length > 0)!.finished[0];
    expect(fin.state).toBe('crashed');
    expect(fin.name).toBe('pretrain-llama');
  });
});
