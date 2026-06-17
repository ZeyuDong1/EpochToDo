import { app, BrowserWindow, ipcMain, globalShortcut, Menu, screen, dialog } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { initDB, dbPath, db } from './db'
import { TaskService, ProjectService, HistoryService, SettingsService, GpuService, SchedulerGpuService, SchedulerTaskService, SchedulerAssignmentService } from './db/service'
import { TimerManager } from './timer/manager'
import type { IpcInvokeMap } from '../src/shared/ipc-types'
import {
  createWindowRefs,
  createDashboardWindow,
  createTray,
  createSpotlightWindow,
  showReminderWindow,
  createOverlayWindow,
} from './windows'
import { createHookServer } from './server'

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
      showReminderWindow(refs);
      setTimeout(() => {
        refs.reminder?.webContents.send(channel, ...args);
      }, 1000);
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
  };

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
  handleIpc('get-settings', async (key, defaultValue) => { return await SettingsService.get(key, defaultValue); });

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

  handleIpc('create-task', async (title: string, tag?: string, type?: any, projectId?: number, parentId?: number, skipDedup?: boolean) => { const task = await TaskService.createTask(title, tag, type, projectId, parentId, skipDedup);
  broadcastFetchTasks();
  return task; });

  handleIpc('update-task', async (id: number, updates: any) => { const res = await TaskService.updateTask(id, updates);
  broadcastFetchTasks();
  return res; });

  handleIpc('delete-task', async (id: number) => { const res = await TaskService.deleteTask(id);
  broadcastFetchTasks();
  return res; });

  handleIpc('delete-all-tasks', async () => { timerManager.cancelAll();
  const res = await TaskService.deleteAllTasks();
  broadcastFetchTasks();
  return res; });

  handleIpc('get-suggestions', async (maxDuration) => { return await TaskService.getSuggestions(maxDuration); });

  ipcMain.on('timer:add-memo', async (_, taskId, content) => {
    await TaskService.appendMemo(taskId, content);
    broadcastFetchTasks();
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

  handleIpc('update-project', async (id: number, updates: any) => { const res = await ProjectService.updateProject(id, updates);
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
  } catch (err: any) {
    console.error('Export failed:', err);
    return { success: false, message: `Export failed: ${err.message}` };
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
  } catch (err: any) {
    console.error('Import failed:', err);
    return { success: false, message: `Import failed: ${err.message}` };
  } });

  // --- Window Control IPC ---
  ipcMain.on('spotlight:hide', () => {
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
    await timerManager.startFocus(taskId);
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

  // --- Scheduler IPC ---
  handleIpc('scheduler:get-gpus', async () => { return await SchedulerGpuService.getAll(); });
  handleIpc('scheduler:create-gpu', async (name: string, color?: string) => { return await SchedulerGpuService.create(name, color); });
  handleIpc('scheduler:update-gpu', async (id: number, updates: any) => { await SchedulerGpuService.update(id, updates); });
  handleIpc('scheduler:delete-gpu', async (id: number) => { await SchedulerGpuService.delete(id); });
  handleIpc('scheduler:get-tasks', async () => { return await SchedulerTaskService.getAll(); });
  handleIpc('scheduler:create-task', async (title: string, estimatedHours?: number, color?: string) => { return await SchedulerTaskService.create(title, estimatedHours, color); });
  handleIpc('scheduler:update-task', async (id: number, updates: any) => { await SchedulerTaskService.update(id, updates); });
  handleIpc('scheduler:delete-task', async (id: number) => { await SchedulerTaskService.delete(id); });
  handleIpc('scheduler:get-assignments', async () => { return await SchedulerAssignmentService.getAll(); });

  handleIpc('scheduler:create-assignment', async (taskId: number, gpuId: number, startTime: string, durationHours: number) => { try {
    return await SchedulerAssignmentService.create(taskId, gpuId, startTime, durationHours);
  } catch (e: any) {
    return { error: e.message };
  } });

  handleIpc('scheduler:update-assignment', async (id: number, updates: any) => { await SchedulerAssignmentService.update(id, updates); });
  handleIpc('scheduler:delete-assignment', async (id: number) => { await SchedulerAssignmentService.delete(id); });
  handleIpc('scheduler:clear-assignments', async () => { await SchedulerAssignmentService.clearAll(); });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
