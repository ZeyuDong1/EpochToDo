import { app, BrowserWindow, ipcMain, globalShortcut, Menu, screen, dialog, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import './dataDir' // must precede ./db — redirects userData before the DB path resolves
import { initDB, dbPath, db } from './db'
import { TaskService, ProjectService, HistoryService, SettingsService, GpuService, SchedulerGpuService, SchedulerTaskService, SchedulerAssignmentService } from './db/service'
import { TimerManager } from './timer/manager'
import { validateCredentials } from './wandb/client'
import os from 'node:os'
import type { IpcInvokeMap } from '../src/shared/ipc-types'
import type { SettingValue } from '../src/shared/types'
import {
  createWindowRefs,
  createDashboardWindow,
  createTray,
  createSpotlightWindow,
  showReminderWindow,
  createOverlayWindow,
} from './windows'
import { createHookServer } from './server'
import { createRequire } from 'node:module'
// active-win 8.x ships as CommonJS with `export = activeWindow` (a callable namespace).
// Use createRequire to side-step ESM/CJS interop quirks in the Electron main process.
const require = createRequire(import.meta.url)
const activeWindow = require('active-win') as typeof import('active-win')
import { simulatePaste } from './native/automation'
import * as mdSync from './mdSync/service'
import { AutoSyncManager } from './mdSync/autoSync'

function handleIpc<K extends keyof IpcInvokeMap>(
  channel: K,
  handler: (...args: IpcInvokeMap[K]['args']) => Promise<IpcInvokeMap[K]['return']>
): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    try {
      return await handler(...(args as IpcInvokeMap[K]['args']));
    } catch (err) {
      console.error(`IPC error [${channel}]:`, err);
      return { success: false, error: (err as Error).message };
    }
  });
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

const refs = createWindowRefs()

// --- App Lifecycle ---

app.on('before-quit', () => {
  refs.isQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    refs.dashboard = null
    refs.spotlight = null
    refs.reminder = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createDashboardWindow(refs)
    createSpotlightWindow(refs)
  }
})

app.whenReady().then(async () => {
  try {
    await initDB();
  } catch (err) {
    console.error('FAILED TO INIT DB:', err);
  }

  Menu.setApplicationMenu(null);

  createDashboardWindow(refs);
  if (VITE_DEV_SERVER_URL) {
    refs.dashboard?.webContents.openDevTools();
  }

  createSpotlightWindow(refs);
  if (VITE_DEV_SERVER_URL) {
    refs.spotlight?.webContents.openDevTools({ mode: 'detach' });
  }
  await createOverlayWindow(refs);
  createTray(refs);

  const timerManager = new TimerManager();

  timerManager.setBroadcaster((channel, ...args) => {
    refs.dashboard?.webContents.send(channel, ...args);
    refs.spotlight?.webContents.send(channel, ...args);
    if (refs.overlay && !refs.overlay.isDestroyed()) {
      refs.overlay.webContents.send(channel, ...args);
    }

    if (channel === 'timer:ended') {
      // Soft reminder path for reminder tasks: don't pop the Reminder window,
      // don't steal focus. The task shows up as a non-blocking banner in
      // Spotlight / Dashboard instead. Hard reminder (window + chime) is
      // used for standard / training / notification tasks — including AI
      // reminders (task complete, needs approval).
      const endedTask = args[1] as { type?: string } | null;
      const isSoft = endedTask?.type === 'reminder';
      if (!isSoft) {
        showReminderWindow(refs);
        setTimeout(() => {
          refs.reminder?.webContents.send(channel, ...args);
        }, 1000);
      }
    }

    if (channel === 'ai:reminder-dismissed') {
      // An agent dismissed delivered AI cards after the user resumed the
      // conversation. If we actually deleted a hard-reminder task, the
      // full-screen Reminder popup (if still up) is stale — hide it.
      const dismissed = (args[0] as { dismissed?: number } | undefined)?.dismissed ?? 0;
      if (dismissed > 0) {
        refs.reminder?.hide();
      }
    }
  });

  // --- README/demo screenshot utility (dev aid) ---
  // CAPTURE_SHOTS=<dir> → after the windows load, capture each window's real
  // renderer output (webContents.capturePage — pixel-exact, immune to window
  // overlap) into <dir>/demo-<name>.png, then quit. Pair with demo data in DB.
  if (process.env.CAPTURE_SHOTS) {
    const shotDir = process.env.CAPTURE_SHOTS;
    const delay = Number(process.env.CAPTURE_SHOTS_DELAY_MS ?? 6000);
    setTimeout(async () => {
      // (delay lets you inject demo data / hook payloads before frames are taken)
      const targets: [string, BrowserWindow | null][] = [
        ['dashboard', refs.dashboard],
        ['spotlight', refs.spotlight],
        ['overlay', refs.overlay],
      ];
      // Show everything first and let layout/animations settle before capturing
      for (const [, win] of targets) {
        if (win && !win.isDestroyed()) { win.show(); win.moveTop(); }
      }
      await new Promise(r => setTimeout(r, 2000));
      for (const [name, win] of targets) {
        if (!win || win.isDestroyed()) { console.error(`[shots] ${name} unavailable`); continue; }
        try {
          win.moveTop();
          await new Promise(r => setTimeout(r, 400));
          const img = await win.webContents.capturePage();
          const out = path.join(shotDir, `demo-${name}.png`);
          fs.writeFileSync(out, img.toPNG());
          console.error(`[shots] saved ${out} (${img.getSize().width}x${img.getSize().height})`);
        } catch (e) {
          console.error(`[shots] capture ${name} failed:`, e);
        }
      }
      app.quit();
    }, delay);
  }

  // --- Auto-sync manager (bidirectional MD sync) ---
  // Created early so broadcastFetchTasks can reference it.
  // The onTasksChanged callback will broadcast fetch-tasks after file→DB sync.
  const autoSync = new AutoSyncManager(() => {
    // After importing from MD, refresh all windows
    refs.dashboard?.webContents.send('fetch-tasks');
    refs.spotlight?.webContents.send('fetch-tasks');
    if (refs.overlay && !refs.overlay.isDestroyed()) {
      refs.overlay.webContents.send('fetch-tasks');
    }
  });

  const broadcastFetchTasks = () => {
    try {
      refs.dashboard?.webContents.send('fetch-tasks');
      refs.spotlight?.webContents.send('fetch-tasks');
      if (refs.overlay && !refs.overlay.isDestroyed()) {
        refs.overlay.webContents.send('fetch-tasks');
      }
    } catch (e) { console.error('Broadcast failed', e); }
    // Trigger auto-sync (debounced — only fires if enabled)
    autoSync.triggerExport();
  };

  // Restore MD auto-sync from saved settings (must be after autoSync declaration)
  try {
    const mdEnabled = await SettingsService.get('md-sync-enabled', false);
    const mdFolder = await SettingsService.get('md-sync-folder', '');
    if (mdEnabled && mdFolder) {
      await autoSync.start(mdFolder);
    }
  } catch (err) {
    console.error('Failed to restore MD auto-sync:', err);
  }

  handleIpc('open-external', async (url: string) => {
    if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
      await shell.openExternal(url);
    }
  });

  handleIpc('ai-promote', async (source: string, title: string, detail?: string, link?: string) => {
    await timerManager.promoteAiReminder({ source, title, detail, link });
  });

  createHookServer({ timerManager, broadcastFetchTasks });

  // --- Global Shortcut ---
  const registerGlobalShortcut = (shortcut: string) => {
    globalShortcut.unregisterAll();
    const success = globalShortcut.register(shortcut, () => {
      if (refs.spotlight && !refs.spotlight.isDestroyed()) {
        if (refs.spotlight.isVisible()) {
          refs.spotlight.hide();
        } else {
          const point = screen.getCursorScreenPoint();
          const display = screen.getDisplayNearestPoint(point);
          const x = display.bounds.x + (display.bounds.width - 800) / 2;
          const y = display.bounds.y + (display.bounds.height - 600) / 2;
          refs.spotlight.setBounds({ x: Math.floor(x), y: Math.floor(y), width: 800, height: 600 });
          refs.spotlight.show();
          refs.spotlight.focus();
          refs.spotlight.webContents.focus();
        }
      } else {
        createSpotlightWindow(refs);
        refs.spotlight?.once('ready-to-show', () => {
          const point = screen.getCursorScreenPoint();
          const display = screen.getDisplayNearestPoint(point);
          const x = display.bounds.x + (display.bounds.width - 800) / 2;
          const y = display.bounds.y + (display.bounds.height - 600) / 2;
          refs.spotlight?.setBounds({ x: Math.floor(x), y: Math.floor(y), width: 800, height: 600 });
          refs.spotlight?.show();
          refs.spotlight?.focus();
        });
      }
    });

    if (!success) {
      console.error(`FAILED TO REGISTER SHORTCUT: ${shortcut}`);
      return false;
    }
    console.log(`Shortcut registered successfully: ${shortcut}`);
    return true;
  };

  const savedShortcut = await SettingsService.get('global_shortcut', 'Alt+Space');
  registerGlobalShortcut(savedShortcut);

  // --- Settings IPC ---
  handleIpc('get-settings', async (key, defaultValue) => { return await SettingsService.get(key, defaultValue as SettingValue | undefined); });

  handleIpc('update-setting', async (key, value) => { await SettingsService.set(key, value);
  if (key === 'global_shortcut') {
      registerGlobalShortcut(value as string);
  } });

  handleIpc('register-shortcut', async (shortcut) => {
  const success = registerGlobalShortcut(shortcut);
  if (success) {
      await SettingsService.set('global_shortcut', shortcut);
  }
  return success; });

  handleIpc('unregister-shortcuts', async () => { globalShortcut.unregisterAll();
  return true; });

  // --- Auto-launch IPC ---
  handleIpc('get-auto-launch', async () => { const settings = app.getLoginItemSettings();
  return settings.openAtLogin; });

  handleIpc('set-auto-launch', async (enabled: boolean) => { app.setLoginItemSettings({
    openAtLogin: enabled,
    path: app.getPath('exe'),
  });
  return true; });

  // --- Task IPC ---
  handleIpc('get-tasks', async () => { return await TaskService.getAllTasks(); });

  handleIpc('create-task', async (title, tag, type, projectId, parentId, skipDedup) => { const task = await TaskService.createTask(title, tag, type, projectId, parentId, skipDedup);
  broadcastFetchTasks();
  return task; });

  handleIpc('update-task', async (id, updates) => {
  const mdPath = autoSync.getStatus().filePath;
  // In-app renames must rewrite the bound MD line in place. Without this,
  // the next merge appends the new title as a duplicate line and the
  // file-watcher sync then resurrects the old title as a new task.
  const isHierarchyChange = updates.parent_id !== undefined;
  if (!isHierarchyChange && typeof updates.title === 'string' && mdPath) {
    try { await mdSync.updateTaskInMd(mdPath, id, updates.title); } catch { /* best-effort MD update */ }
  }
  const res = await TaskService.updateTask(id, updates);
  // Hierarchy change (indent/dedent): the in-place line rewrite cannot move
  // the line, so surgically move the task's subtree (bullet + notes) to the
  // position implied by the NEW DB tree. Without this the watcher's MD→DB
  // merge repairs parent_id back to the file's stale indentation.
  if (isHierarchyChange && mdPath) {
    try { await mdSync.moveTaskSubtreeInMd(mdPath, id); } catch { /* best-effort MD move */ }
  }
  broadcastFetchTasks();
  return res; });

  // Secondary focus flag — service enforces the 2-task cap and returns false on overflow.
  // Main/side are mutually exclusive: flagging the RUNNING focus demotes it —
  // its timer stops and a replacement side task is promoted to focus (most
  // recently focused in history first, else the earliest-flagged side).
  handleIpc('set-side-focus', async (id, enabled) => {
  let ok: boolean;
  if (enabled && (await TaskService.getActiveFocusTaskId()) === id) {
    await timerManager.stopFocus();
    // Unflag the replacement first so the demoted task fits the 2-slot cap
    const nextId = await TaskService.pickSideFocusPromotion(id);
    if (nextId !== null) await TaskService.setSideFocus(nextId, false);
    ok = await TaskService.setSideFocus(id, true);
    if (nextId !== null) await timerManager.startFocus(nextId);
  } else {
    ok = await TaskService.setSideFocus(id, enabled);
  }
  broadcastFetchTasks();
  return ok; });

  handleIpc('delete-task', async (id: number) => {
    // Remove from MD before DB delete (needs md_line_hash from DB)
    const mdPath = autoSync.getStatus().filePath;
    if (mdPath) { try { await mdSync.removeTaskFromMd(mdPath, id); } catch { /* best-effort MD cleanup */ } }
    const res = await TaskService.deleteTask(id);
  broadcastFetchTasks();
  return res; });

  handleIpc('delete-all-tasks', async () => { timerManager.cancelAll();
  const res = await TaskService.deleteAllTasks();
  broadcastFetchTasks();
  return res; });

  handleIpc('get-suggestions', async (maxDuration) => { return await TaskService.getSuggestions(maxDuration); });

  // The app's own executable (electron.exe in dev, EpochToDo.exe packaged).
  // Dropping a task on EpochToDo itself — including any drag within the task
  // tree, where the Spotlight window stays foreground — is not a cross-app
  // dispatch: don't record the association and don't paste into ourselves.
  const selfExecPath = process.execPath.toLowerCase();
  const isSelfWindow = (win: { owner?: { path?: string } } | null | undefined): boolean => {
    const p = win?.owner?.path;
    return !!p && p.toLowerCase() === selfExecPath;
  };

  // Identify foreground window for cross-app task dispatch.
  // Called from renderer's dragend handler; includes a short delay because the
  // target app may not yet have focus when the user releases the mouse.
  handleIpc('task:identify-target', async () => {
    try {
      // Wait briefly for the OS to switch foreground window after drop
      await new Promise(resolve => setTimeout(resolve, 150));
      const win = await activeWindow();
      if (!win || isSelfWindow(win)) return null;
      return {
        processName: win.owner?.name ?? 'unknown',
        windowTitle: win.title ?? '',
        executablePath: win.owner?.path ?? '',
        // bundleId is macOS-only; the active-win types model owner as a union
        // (MacOSOwner | BaseOwner) so we narrow at runtime instead of casting.
        bundleId: (win.owner as { bundleId?: string } | undefined)?.bundleId,
        timestamp: new Date().toISOString(),
      };
    } catch (e) {
      console.error('identify-target failed:', e);
      return null;
    }
  });

  // Full dispatch pipeline: identify target → record to DB → simulate Ctrl+V.
  // Called from BulletRow's dragend so a single IPC handles the entire flow
  // atomically and avoids races between focus switch / clipboard read.
  handleIpc('task:dispatch', async (taskId: number) => {
    try {
      // 1. Wait for the OS to switch foreground window to the drop target.
      await new Promise(resolve => setTimeout(resolve, 150));

      // 2. Identify the target window.
      const win = await activeWindow();
      if (isSelfWindow(win)) {
        // Dropped on EpochToDo itself — no association, no paste
        return { ok: false, error: 'self-window' };
      }
      if (win) {
        const target = {
          processName: win.owner?.name ?? 'unknown',
          windowTitle: win.title ?? '',
          executablePath: win.owner?.path ?? '',
          bundleId: (win.owner as { bundleId?: string } | undefined)?.bundleId,
          timestamp: new Date().toISOString(),
        };
        // 3. Record to DB (overwrite any previous target — "last dispatch wins").
        await TaskService.updateTask(taskId, {
          dispatched_target: JSON.stringify(target),
        });
        broadcastFetchTasks();
      }

      // 4. Simulate Ctrl+V so the title (already on clipboard from dragstart)
      //    pastes into the now-focused target input. Best-effort: on unsupported
      //    platforms the user can still paste manually.
      const pasteRes = simulatePaste();
      if (!pasteRes.ok && pasteRes.reason !== 'unsupported-platform') {
        console.warn('[task:dispatch] paste simulation failed:', pasteRes.message);
      }
      return { ok: true };
    } catch (e) {
      console.error('[task:dispatch] failed:', e);
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.on('timer:add-memo', async (_, taskId, content) => {
    await TaskService.appendMemo(taskId, content);
    broadcastFetchTasks();
  });

  // AI reminder dismissals are per-window Zustand state; echo the dismissal to
  // every window so closing a card in Spotlight/Dashboard also drops it in the
  // overlay (id-based single-card dismiss, or source+title reply-wide dismiss).
  ipcMain.on('ai:reminder-dismiss', (_, payload: { id?: string; source?: string; title?: string }) => {
    refs.dashboard?.webContents.send('ai:reminder-dismissed', payload);
    refs.spotlight?.webContents.send('ai:reminder-dismissed', payload);
    if (refs.overlay && !refs.overlay.isDestroyed()) {
      refs.overlay.webContents.send('ai:reminder-dismissed', payload);
    }
  });

  // --- GPU IPC ---
  handleIpc('get-gpus', async () => { return await GpuService.getAllGpus(); });

  handleIpc('create-gpu', async (name: string, color?: string) => { const gpu = await GpuService.createGpu(name, color);
  broadcastFetchTasks();
  return gpu; });

  handleIpc('delete-gpu', async (id: number) => {
  const webhookTasks = await db.selectFrom('tasks')
    .select('id')
    .where('gpu_id', '=', id)
    .where('is_webhook', '=', 1)
    .execute();
  await GpuService.deleteGpu(id);
  for (const task of webhookTasks) {
    timerManager.clearTrainingStatus(task.id);
  }
  broadcastFetchTasks(); });

  ipcMain.on('gpu:assign-task', async (_, taskId: number, gpuId: number, durationMinutes: number) => {
      await timerManager.startTraining(taskId, gpuId, durationMinutes * 60);
      broadcastFetchTasks();
  });

  // --- Project IPC ---
  handleIpc('get-projects', async () => { return await ProjectService.getAllProjects(); });

  handleIpc('create-project', async (name: string, description?: string, color?: string) => { const project = await ProjectService.createProject(name, description, color);
  broadcastFetchTasks();
  return project; });

  handleIpc('update-project', async (id, updates) => { const res = await ProjectService.updateProject(id, updates);
  broadcastFetchTasks();
  return res; });

  handleIpc('delete-project', async (id: number) => { await ProjectService.deleteProject(id);
  broadcastFetchTasks(); });

  handleIpc('get-history', async (dateStr?: string) => { return await HistoryService.getHistory(dateStr); });

  handleIpc('delete-history', async (id: number) => { const res = await HistoryService.deleteHistory(id);
  broadcastFetchTasks();
  return res; });

  // --- Data Backup & Import ---
  handleIpc('export-data', async () => { const result = await dialog.showSaveDialog({
    title: 'Export Database Backup',
    defaultPath: `flowtask-backup-${new Date().toISOString().slice(0, 10)}.db`,
    filters: [{ name: 'SQLite Database', extensions: ['db'] }],
  });
  if (result.canceled || !result.filePath) {
    return { success: false, message: 'Export cancelled' };
  }
  try {
    fs.copyFileSync(dbPath, result.filePath);
    return { success: true, message: `Database exported to ${result.filePath}` };
  } catch (err) {
    console.error('Export failed:', err);
    return { success: false, message: `Export failed: ${err instanceof Error ? err.message : String(err)}` };
  } });

  handleIpc('import-data', async () => { const result = await dialog.showOpenDialog({
    title: 'Import Database Backup',
    filters: [{ name: 'SQLite Database', extensions: ['db'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, message: 'Import cancelled' };
  }
  const sourcePath = result.filePaths[0];
  try {
    const backupPath = dbPath.replace('.db', `-backup-${Date.now()}.db`);
    fs.copyFileSync(dbPath, backupPath);
    fs.copyFileSync(sourcePath, dbPath);
    return {
      success: true,
      message: `Database imported from ${sourcePath}. A backup was saved to ${backupPath}. Please restart the app.`,
      needsRestart: true,
    };
  } catch (err) {
    console.error('Import failed:', err);
    return { success: false, message: `Import failed: ${err instanceof Error ? err.message : String(err)}` };
  } });

  // --- Window Control IPC ---
  ipcMain.on('spotlight:hide', async () => {
    // Close-time cleanup: delete tasks whose title is blank (created but never filled in).
    // 排除 active（进行中的专注）与 archived（历史），避免误删。
    try {
      const all = await TaskService.getAllTasks();
      const empties = all.filter(t => t.status !== 'active' && t.status !== 'archived' && !t.title.trim());
      if (empties.length > 0) {
        await Promise.all(empties.map(t => TaskService.deleteTask(t.id)));
        refs.dashboard?.webContents.send('fetch-tasks');
        refs.spotlight?.webContents.send('fetch-tasks');
      }
    } catch (err) {
      console.error('[spotlight:hide] cleanup empty tasks failed:', err);
    }
    refs.spotlight?.hide();
  });

  ipcMain.on('reminder:hide', () => {
    refs.reminder?.hide();
  });

  ipcMain.on('reminder:snooze', async (_, taskId, minutes) => {
    await timerManager.snoozeTrainingReminder(taskId, minutes);
    broadcastFetchTasks();
  });

  // --- Timer IPC ---
  ipcMain.on('timer:start-focus', async (_, taskId) => {
    // Remember the outgoing focus before switching, so it can be demoted below
    const prevFocusId = await TaskService.getActiveFocusTaskId();
    await timerManager.startFocus(taskId);
    // Promotion clears the side flag — a task cannot be main and side focus at once
    await TaskService.setSideFocus(taskId, false);
    // Rotation: when side slots are not full, the outgoing main focus is kept
    // as a side focus (setSideFocus silently skips it when 2 slots are taken)
    if (prevFocusId !== null && prevFocusId !== taskId) {
      await TaskService.setSideFocus(prevFocusId, true);
    }
    broadcastFetchTasks();
  });

  ipcMain.on('timer:stop-focus', async () => {
    await timerManager.stopFocus();
    broadcastFetchTasks();
  });

  ipcMain.on('timer:complete-task', async (_, taskId) => {
    await timerManager.completeTask(taskId);
    broadcastFetchTasks();
  });

  ipcMain.on('timer:start-wait', async (_, taskId, duration) => {
    await timerManager.startWait(taskId, duration);
    broadcastFetchTasks();
  });

  ipcMain.on('timer:cancel-wait', async (_, taskId) => {
    await timerManager.cancelWait(taskId);
    broadcastFetchTasks();
  });

  handleIpc('timer:stop-training', async (taskId, forceComplete) => { await timerManager.stopTraining(taskId, forceComplete);
  broadcastFetchTasks(); });

  ipcMain.on('set-overlay-ignore-mouse', (_, ignore: boolean) => {
    if (refs.overlay && !refs.overlay.isDestroyed()) {
        refs.overlay.setIgnoreMouseEvents(ignore, { forward: true });
    }
  });

  ipcMain.on('reset-overlay-position', () => {
      if (refs.overlay && !refs.overlay.isDestroyed()) {
          const primaryDisplay = screen.getPrimaryDisplay();
          const { width, height } = primaryDisplay.workAreaSize;
          const w = 350;
          const h = 250;
          const x = Math.round((width - w) / 2);
          const y = Math.round((height - h) / 2);
          refs.overlay.setBounds({ x, y, width: w, height: h });
          SettingsService.set('overlay_bounds', { x, y, width: w, height: h });
      }
  });

  ipcMain.on('wandb:update', () => {
    timerManager.initWandb();
  });

  handleIpc('wandb:test', async (entity: string, apiKey: string) => {
    const result = await validateCredentials(entity, apiKey);
    return { ...result, hostname: os.hostname() };
  });

  // --- Scheduler IPC ---
  handleIpc('scheduler:get-gpus', async () => { return await SchedulerGpuService.getAll(); });
  handleIpc('scheduler:create-gpu', async (name: string, color?: string) => { return await SchedulerGpuService.create(name, color); });
  handleIpc('scheduler:update-gpu', async (id, updates) => { await SchedulerGpuService.update(id, updates); });
  handleIpc('scheduler:delete-gpu', async (id: number) => { await SchedulerGpuService.delete(id); });
  handleIpc('scheduler:get-tasks', async () => { return await SchedulerTaskService.getAll(); });
  handleIpc('scheduler:create-task', async (title: string, estimatedHours?: number, color?: string) => { return await SchedulerTaskService.create(title, estimatedHours, color); });
  handleIpc('scheduler:update-task', async (id, updates) => { await SchedulerTaskService.update(id, updates); });
  handleIpc('scheduler:delete-task', async (id: number) => { await SchedulerTaskService.delete(id); });
  handleIpc('scheduler:get-assignments', async () => { return await SchedulerAssignmentService.getAll(); });

  handleIpc('scheduler:create-assignment', async (taskId: number, gpuId: number, startTime: string, durationHours: number) => { try {
    return await SchedulerAssignmentService.create(taskId, gpuId, startTime, durationHours);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  } });

  handleIpc('scheduler:update-assignment', async (id, updates) => { await SchedulerAssignmentService.update(id, updates); });
  handleIpc('scheduler:delete-assignment', async (id: number) => { await SchedulerAssignmentService.delete(id); });
  handleIpc('scheduler:clear-assignments', async () => { await SchedulerAssignmentService.clearAll(); });

  // --- MD Sync IPC ---
  handleIpc('md-sync:select-folder', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择 MD 同步文件夹',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }
    return { canceled: false, folderPath: result.filePaths[0] };
  });

  handleIpc('md-sync:check-file', async (folderPath: string) => {
    try {
      const info = await mdSync.checkEpochtodoExists(folderPath);
      return { success: true, ...info };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  handleIpc('md-sync:import', async (filePath: string, force: boolean, rootParentId?: number | null) => {
    try {
      const result = await mdSync.importFromMd(filePath, force, rootParentId ?? null);
      broadcastFetchTasks();
      return { success: true, result };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  handleIpc('md-sync:export', async (filePath: string, taskIds: number[]) => {
    try {
      const tasks = await TaskService.getAllTasks();
      const selectedTasks = tasks.filter((t) => taskIds.includes(t.id));
      const result = await mdSync.exportToMd(filePath, selectedTasks);
      broadcastFetchTasks();
      return { success: true, result };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  handleIpc('md-sync:sync', async (filePath: string) => {
    try {
      const result = await mdSync.syncWithMd(filePath);
      broadcastFetchTasks();
      return { success: true, result };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  handleIpc('md-sync:check-duplicates', async (titles: string[]) => {
    return await mdSync.findDuplicateTitles(titles);
  });

  handleIpc('md-sync:read-file', async (filePath: string) => {
    try {
      const fs = await import('fs/promises');
      const content = await fs.readFile(filePath, 'utf-8');
      return { success: true, content };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // Auto-sync config: start/stop auto-sync and persist settings to DB
  handleIpc('md-sync:set-config', async (enabled: boolean, folderPath: string) => {
    try {
      await SettingsService.set('md-sync-enabled', enabled);
      await SettingsService.set('md-sync-folder', folderPath);
      if (enabled && folderPath) {
        await autoSync.start(folderPath);
      } else {
        autoSync.stop();
      }
      return { success: true, status: autoSync.getStatus() };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  handleIpc('md-sync:get-status', async () => {
    return { success: true, status: autoSync.getStatus() };
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
