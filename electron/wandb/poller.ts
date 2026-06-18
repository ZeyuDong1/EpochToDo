import os from 'os';
import { getRecentProjects, getRunningRuns, getRunState, WandbRunFull } from './client';

export interface WandbPollConfig {
  entity: string;
  apiKey: string;
  hostname?: string;
  intervalMs?: number;
  maxProjects?: number;
}

export interface WandbPollResult {
  active: WandbRunFull[];
  finished: WandbRunFull[];
}

type PollCallback = (result: WandbPollResult) => void;

export class WandbPoller {
  private timer: NodeJS.Timeout | null = null;
  private config: Required<WandbPollConfig>;
  private callback: PollCallback;
  private trackedRuns: Map<string, { project: string; run: WandbRunFull }> = new Map();
  private polling = false;

  constructor(config: WandbPollConfig, callback: PollCallback) {
    this.config = {
      hostname: os.hostname(),
      intervalMs: 30000,
      maxProjects: 5,
      ...config,
    };
    this.callback = callback;
  }

  start(): void {
    if (this.timer) return;
    this.poll();
    this.timer = setInterval(() => this.poll(), this.config.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.trackedRuns.clear();
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const { entity, apiKey, hostname, maxProjects } = this.config;
      const projects = await getRecentProjects(entity, apiKey, maxProjects);

      const activeRuns: WandbRunFull[] = [];
      const seenRunIds = new Set<string>();

      for (const proj of projects) {
        const runs = await getRunningRuns(entity, proj.name, apiKey);
        for (const run of runs) {
          if (hostname && run.host && run.host !== hostname) continue;

          const fullRun: WandbRunFull = { ...run, project: proj.name };
          activeRuns.push(fullRun);
          seenRunIds.add(run.id);
          this.trackedRuns.set(run.id, { project: proj.name, run: fullRun });
        }
      }

      const finishedRuns: WandbRunFull[] = [];
      for (const [runId, tracked] of this.trackedRuns) {
        if (!seenRunIds.has(runId)) {
          const finalState = await getRunState(entity, tracked.project, runId, apiKey);
          finishedRuns.push({
            ...tracked.run,
            state: finalState || 'finished',
          });
          this.trackedRuns.delete(runId);
        }
      }

      if (activeRuns.length > 0 || finishedRuns.length > 0) {
        this.callback({ active: activeRuns, finished: finishedRuns });
      }
    } catch (err) {
      console.error('[WandbPoller] poll error:', err);
    } finally {
      this.polling = false;
    }
  }
}
