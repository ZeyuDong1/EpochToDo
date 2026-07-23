/**
 * AutoSyncManager — bidirectional automatic sync between DB tasks and epochtodo.md.
 *
 * - File watcher: detects external MD edits → syncWithMd → refresh UI
 * - Task hook: after task CRUD → exportToMd (suppressed watcher)
 */

import fs from 'fs';
import * as fsp from 'fs/promises';
import path from 'path';

import type { Task } from '../../src/shared/types';
import { TaskService } from '../db/service';
import {
  EPOCHTODO_FILENAME,
  mergeTasksToMd,
  syncWithMd,
} from './service';

export interface AutoSyncStatus {
  enabled: boolean;
  folderPath: string;
  filePath: string;
  lastSyncTime: number | null;
  lastError: string | null;
}

type SyncCompleteCallback = () => void;

const FILE_DEBOUNCE_MS = 2000;
const TASK_DEBOUNCE_MS = 500;
const SUPPRESS_DELAY_MS = 1500;

export class AutoSyncManager {
  private enabled = false;
  private folderPath = '';
  private filePath = '';
  private watcher: fs.FSWatcher | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private lastPollMtime = 0;
  private fileDebounce: ReturnType<typeof setTimeout> | null = null;
  private taskDebounce: ReturnType<typeof setTimeout> | null = null;
  private suppressWatch = false;
  private lastWrittenContent: string | null = null;
  private lastSyncTime: number | null = null;
  private lastError: string | null = null;

  constructor(private onSyncComplete: SyncCompleteCallback) {}

  getStatus(): AutoSyncStatus {
    return {
      enabled: this.enabled,
      folderPath: this.folderPath,
      filePath: this.filePath,
      lastSyncTime: this.lastSyncTime,
      lastError: this.lastError,
    };
  }

  /**
   * Start automatic sync for the given folder.
   * Does an initial sync then begins watching the file.
   */
  async start(folderPath: string): Promise<void> {
    this.stop();
    this.enabled = true;
    this.folderPath = folderPath;
    this.filePath = path.join(folderPath, EPOCHTODO_FILENAME);
    this.lastError = null;
    this.lastWrittenContent = null;

    // Record initial mtime for polling baseline
    try { this.lastPollMtime = (await fsp.stat(this.filePath)).mtimeMs; } catch { this.lastPollMtime = 0; }

    await this.initialSync();
    this.startWatcher();
  }

  /** Stop sync and clean up watchers. */
  stop(): void {
    this.enabled = false;
    this.closeWatcher();
    if (this.fileDebounce) {
      clearTimeout(this.fileDebounce);
      this.fileDebounce = null;
    }
    if (this.taskDebounce) {
      clearTimeout(this.taskDebounce);
      this.taskDebounce = null;
    }
    this.suppressWatch = false;
  }

  // ------------------------------------------------------------------
  // Internal: initial sync on start()
  // ------------------------------------------------------------------

  private async initialSync(): Promise<void> {
    const exists = await this.fileExists(this.filePath);
    if (exists) {
      // File already exists → import its bullets into DB
      await this.syncFromFile();
    } else {
      // File doesn't exist → export current tasks to create it
      await this.exportTasks();
    }
  }

  // ------------------------------------------------------------------
  // Internal: file watcher
  // ------------------------------------------------------------------

  private startWatcher(): void {
    this.closeWatcher();

    // Watch the DIRECTORY (not the file) — this survives atomic saves
    // (temp-file + rename) that break direct file watchers on Windows.
    try {
      this.watcher = fs.watch(this.folderPath, (_evt, filename) => {
        if (filename === EPOCHTODO_FILENAME) {
          this.debouncedSyncFromFile();
        }
      });
      this.watcher.on('error', () => {
        // Watcher error — polling fallback will keep working
        console.error('[mdSync] directory watcher error');
      });
    } catch {
      // Folder inaccessible — retry later
      setTimeout(() => {
        if (this.enabled) this.startWatcher();
      }, 2000);
      // Still start polling
    }

    // Polling fallback: check file mtime every 3s.
    // This catches changes that fs.watch misses (atomic saves, network drives, etc.)
    this.startPolling();
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollInterval = setInterval(async () => {
      if (!this.enabled) return;
      try {
        const stats = await fsp.stat(this.filePath);
        const mtime = stats.mtimeMs;
        if (mtime !== this.lastPollMtime) {
          if (this.lastPollMtime !== 0) {
            // File was modified — trigger sync
            this.debouncedSyncFromFile();
          }
          this.lastPollMtime = mtime;
        }
      } catch {
        // File might not exist yet
      }
    }, 3000);
  }

  private stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private closeWatcher(): void {
    this.stopPolling();
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {
        // ignore
      }
      this.watcher = null;
    }
  }

  private debouncedSyncFromFile(): void {
    if (this.fileDebounce) clearTimeout(this.fileDebounce);
    this.fileDebounce = setTimeout(() => {
      // If we just wrote the file ourselves, wait for suppress to clear
      // before syncing — but DON'T discard the event, because the user
      // may have also edited the file during our write window.
      if (this.suppressWatch) {
        this.debouncedSyncFromFile(); // re-schedule (shorter delay)
        return;
      }
      this.syncFromFile().catch((e) => {
        this.lastError = e instanceof Error ? e.message : String(e);
        console.error('[mdSync] file watcher sync error:', e);
      });
    }, this.suppressWatch ? 500 : FILE_DEBOUNCE_MS);
  }

  // ------------------------------------------------------------------
  // Sync direction: MD file → DB
  // ------------------------------------------------------------------

  private async syncFromFile(): Promise<void> {
    if (!this.enabled || !this.filePath) return;

    // Suppress watcher during sync — syncWithMd may update DB which
    // could indirectly trigger file writes.
    this.suppressWatch = true;
    try {
      // MD→DB only: do NOT regenerate/write the file back.
      // The user is actively editing the file — writing back would
      // overwrite their in-progress edits and cause duplicates.
      await syncWithMd(this.filePath, false);
      this.lastSyncTime = Date.now();
      this.lastError = null;
      // Refresh UI so renderer sees new/updated tasks from MD
      this.onSyncComplete();
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      console.error('[mdSync] syncFromFile error:', e);
    } finally {
      setTimeout(() => {
        this.suppressWatch = false;
      }, SUPPRESS_DELAY_MS);
    }
  }

  // ------------------------------------------------------------------
  // Sync direction: DB → MD file (called after task changes)
  // ------------------------------------------------------------------

  /**
   * Called after tasks change in the DB (create/update/delete).
   * Debounced — exports current tasks to epochtodo.md.
   */
  triggerExport(): void {
    if (!this.enabled) return;
    if (this.taskDebounce) clearTimeout(this.taskDebounce);
    this.taskDebounce = setTimeout(() => {
      this.exportTasks().catch((e) => {
        this.lastError = e instanceof Error ? e.message : String(e);
        console.error('[mdSync] exportTasks error:', e);
      });
    }, TASK_DEBOUNCE_MS);
  }

  private async exportTasks(): Promise<void> {
    const tasks: Task[] = await TaskService.getAllTasks();

    // Optimisation: skip write if content hasn't changed
    const newContent = this.tasksToMdPreview(tasks);
    if (newContent === this.lastWrittenContent) return;

    this.suppressWatch = true;
    try {
      await mergeTasksToMd(this.filePath, tasks);
      this.lastWrittenContent = newContent;
      this.lastSyncTime = Date.now();
      this.lastError = null;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      // Re-enable watcher after delay to skip our own write event
      setTimeout(() => {
        this.suppressWatch = false;
      }, SUPPRESS_DELAY_MS);
    }
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fsp.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generate a deterministic MD string from tasks for change detection.
   * Only includes active tasks (archived excluded). Used as a heuristic to
   * skip unnecessary merge writes — the actual merge output may differ.
   */
  private tasksToMdPreview(tasks: Task[]): string {
    // Skip archived — matches generateMdFromTasks
    const standardTasks = tasks.filter(
      (t) =>
        (t.type === 'standard' || t.type === undefined) &&
        t.status !== 'archived'
    );

    // Build children map (same as generateMdFromTasks)
    const childrenMap = new Map<number | null, Task[]>();
    for (const t of standardTasks) {
      const pid = t.parent_id ?? null;
      if (!childrenMap.has(pid)) childrenMap.set(pid, []);
      childrenMap.get(pid)!.push(t);
    }

    // Sort children by sort_order (same as generateMdFromTasks)
    for (const arr of childrenMap.values()) {
      arr.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    }

    const lines: string[] = [];

    function renderTask(task: Task, depth: number): void {
      const indent = '  '.repeat(depth);
      const checkPrefix =
        task.status === 'archived' ? '- [x] ' : '- [ ] ';
      lines.push(`${indent}${checkPrefix}${task.title}`);
      const children = childrenMap.get(task.id) ?? [];
      for (const child of children) {
        renderTask(child, depth + 1);
      }
    }

    const roots = childrenMap.get(null) ?? [];
    for (const root of roots) {
      renderTask(root, 0);
    }

    return lines.join('\n') + '\n';
  }
}
