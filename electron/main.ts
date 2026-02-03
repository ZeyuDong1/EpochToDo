import { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, screen, dialog } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import http from 'node:http'
import { initDB, dbPath } from './db'
import { TaskService, ProjectService, HistoryService, SettingsService, GpuService } from './db/service'
import { TimerManager } from './timer/manager'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let dashboardWindow: BrowserWindow | null = null
let spotlightWindow: BrowserWindow | null = null
let reminderWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

// --- Window Creation ---

function createDashboardWindow() {
  dashboardWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(process.env.VITE_PUBLIC, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
    // Dashboard is main window, always visible on start
    show: false 
  })

  // Load params
  const url = VITE_DEV_SERVER_URL 
    ? `${VITE_DEV_SERVER_URL}?type=dashboard` 
    : path.join(RENDERER_DIST, 'index.html?type=dashboard') // This might need 'file://' protocol handling if just path. usually loadFile doesn't take params easily.
  
  if (VITE_DEV_SERVER_URL) {
    dashboardWindow.loadURL(url)
  } else {
    dashboardWindow.loadFile(path.join(RENDERER_DIST, 'index.html'), { query: { type: 'dashboard' } })
  }

  dashboardWindow.once('ready-to-show', () => {
    dashboardWindow?.show()
  })

  dashboardWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      dashboardWindow?.hide()
    }
    return false
  })

  dashboardWindow.on('closed', () => {
    dashboardWindow = null
  })
}

function createTray() {
  const iconPath = path.join(process.env.VITE_PUBLIC, 'icon.png')
  // Depending on behavior, you might need a properly resized png/ico for tray. 
  // SVG might work on some OS, but png is safer. 
  // Assuming the user has an icon that works or we fallback.
  // Ideally, use a dedicated tray icon.
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  
  tray = new Tray(icon)
  tray.setToolTip('DayFlowGemini')
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Dashboard', click: () => dashboardWindow?.show() },
    { label: 'Quit', click: () => {
        isQuitting = true
        app.quit()
      } 
    }
  ])
  
  tray.setContextMenu(contextMenu)
  
  tray.on('click', () => {
    dashboardWindow?.show()
  })
}

function createSpotlightWindow() {
  spotlightWindow = new BrowserWindow({
    width: 800,
    height: 600, // Large enough for lists
    frame: false, // Frameless
    transparent: true,
    resizable: false, // Fixed size for now? Or allow resize?
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false, // Hidden by default
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  const url = VITE_DEV_SERVER_URL 
    ? `${VITE_DEV_SERVER_URL}?type=spotlight` 
    : path.join(RENDERER_DIST, 'index.html?type=spotlight')

  if (VITE_DEV_SERVER_URL) {
    spotlightWindow.loadURL(url)
  } else {
    spotlightWindow.loadFile(path.join(RENDERER_DIST, 'index.html'), { query: { type: 'spotlight' } })
  }
}

function createReminderWindow() {
  if (reminderWindow && !reminderWindow.isDestroyed()) {
    reminderWindow.show();
    reminderWindow.focus();
    return;
  }

  reminderWindow = new BrowserWindow({
    width: 500,
    height: 450,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#00000000',
    focusable: true,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  const url = VITE_DEV_SERVER_URL 
    ? `${VITE_DEV_SERVER_URL}?type=reminder` 
    : path.join(RENDERER_DIST, 'index.html?type=reminder')

  if (VITE_DEV_SERVER_URL) {
    reminderWindow.loadURL(url)
  } else {
    reminderWindow.loadFile(path.join(RENDERER_DIST, 'index.html'), { query: { type: 'reminder' } })
  }

  reminderWindow.once('ready-to-show', () => {
    // Position on current display
    const point = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(point);
    const x = display.bounds.x + (display.bounds.width - 500) / 2;
    const y = display.bounds.y + (display.bounds.height - 450) / 2;
    reminderWindow?.setBounds({ x: Math.floor(x), y: Math.floor(y), width: 500, height: 450 });

    reminderWindow?.show();
    reminderWindow?.focus();
  });

  // Keep the reminder window always on top and focused
  reminderWindow.on('blur', () => {
    if (reminderWindow && !reminderWindow.isDestroyed() && reminderWindow.isVisible()) {
      // Bring back to front after a short delay
      setTimeout(() => {
        if (reminderWindow && !reminderWindow.isDestroyed()) {
          // Instead of forcing focus (which can be annoying), we just ensure it's still top-most
          reminderWindow.setAlwaysOnTop(true, 'screen-saver');
        }
      }, 100);
    }
  });

  reminderWindow.on('closed', () => {
    reminderWindow = null
  })
}

function showReminderWindow() {
  if (reminderWindow && !reminderWindow.isDestroyed()) {
    // Position on current display
    const point = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(point);
    const x = display.bounds.x + (display.bounds.width - 500) / 2;
    const y = display.bounds.y + (display.bounds.height - 450) / 2;
    reminderWindow.setBounds({ x: Math.floor(x), y: Math.floor(y), width: 500, height: 450 });

    if (reminderWindow.isMinimized()) reminderWindow.restore();
    reminderWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    reminderWindow.setAlwaysOnTop(true, 'screen-saver');
    reminderWindow.show();
    reminderWindow.focus();
    
    // Flash the frame to get attention if focus didn't work purely
    reminderWindow.flashFrame(true);
  } else {
    createReminderWindow();
    // Position is handled in createReminderWindow's ready-to-show
  }
}

let overlaySaveTimeout: NodeJS.Timeout | null = null;

async function createOverlayWindow() {
  const savedBounds = await SettingsService.get('overlay_bounds', { x: 100, y: 100, width: 350, height: 250 });

  overlayWindow = new BrowserWindow({
    width: savedBounds.width,
    height: savedBounds.height,
    x: savedBounds.x,
    y: savedBounds.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    }
  });

  const url = VITE_DEV_SERVER_URL 
    ? `${VITE_DEV_SERVER_URL}?type=overlay` 
    : path.join(RENDERER_DIST, 'index.html?type=overlay');

  if (VITE_DEV_SERVER_URL) {
    overlayWindow.loadURL(url);
  } else {
    overlayWindow.loadFile(path.join(RENDERER_DIST, 'index.html'), { query: { type: 'overlay' } });
  }
  
  // Default to ignore mouse events (pass-through)
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');

  const saveBounds = () => {
      if (overlaySaveTimeout) clearTimeout(overlaySaveTimeout);
      overlaySaveTimeout = setTimeout(() => {
          if (overlayWindow && !overlayWindow.isDestroyed()) {
               SettingsService.set('overlay_bounds', overlayWindow.getBounds());
          }
      }, 1000);
  };

  overlayWindow.on('moved', saveBounds);
  overlayWindow.on('resized', saveBounds);

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
  
  overlayWindow.showInactive();
}

// --- App Lifecycle ---

app.on('before-quit', () => {
  isQuitting = true
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    dashboardWindow = null
    spotlightWindow = null
    reminderWindow = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createDashboardWindow()
    createSpotlightWindow()
  }
})

app.whenReady().then(async () => {
  try {
    await initDB();
  } catch (err) {
    console.error('FAILED TO INIT DB:', err);
    // Continue anyway to show UI window (which will likely fail data fetch, but visible)
    // Or we could show a dialog
  }

  // Disable default application menu to prevent Alt+Space from triggering Windows system menu
  Menu.setApplicationMenu(null);

  createDashboardWindow();
  // Open DevTools for debugging
  dashboardWindow?.webContents.openDevTools();
  
  createSpotlightWindow();
  spotlightWindow?.webContents.openDevTools({ mode: 'detach' });
  await createOverlayWindow();
  createTray();

  const timerManager = new TimerManager();

  // Make TimerManager talk to RENDERERS (including reminder window)
  timerManager.setBroadcaster((channel, ...args) => {
    dashboardWindow?.webContents.send(channel, ...args);
    spotlightWindow?.webContents.send(channel, ...args);
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send(channel, ...args);
    }
    
    // For timer:ended events, show and notify the reminder window
    if (channel === 'timer:ended') {
      showReminderWindow();
      // Delay to ensure window is ready and React is hydrated
      setTimeout(() => {
        reminderWindow?.webContents.send(channel, ...args);
      }, 1000);
    }
  });

  // Start External Hook Server
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method === 'POST' && req.url === '/hook') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const { title, message } = data;

          if (!title) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Title is required' }));
            return;
          }

          timerManager.triggerExternalNotification(title, message);
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(62222, '0.0.0.0', () => {
    console.log('External hook server listening on port 62222 (all interfaces)');
  });

  const broadcastFetchTasks = () => {
    try {
        dashboardWindow?.webContents.send('fetch-tasks');
        spotlightWindow?.webContents.send('fetch-tasks');
        if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send('fetch-tasks');
        }
    } catch (e) { console.error('Broadcast failed', e); }
  };

// Helper to register shortcut
const registerGlobalShortcut = (shortcut: string) => {
  globalShortcut.unregisterAll(); // Clear old ones
  const success = globalShortcut.register(shortcut, () => {
    if (spotlightWindow && !spotlightWindow.isDestroyed()) {
      if (spotlightWindow.isVisible()) {
        spotlightWindow.hide();
      } else {
        // Move to current mouse display
        const point = screen.getCursorScreenPoint();
        const display = screen.getDisplayNearestPoint(point);
        const x = display.bounds.x + (display.bounds.width - 800) / 2;
        const y = display.bounds.y + (display.bounds.height - 600) / 2;
        spotlightWindow.setBounds({ x: Math.floor(x), y: Math.floor(y), width: 800, height: 600 });
        
        spotlightWindow.show();
        spotlightWindow.focus();
      }
    } else {
      createSpotlightWindow();
      spotlightWindow?.once('ready-to-show', () => {
        // Move to current mouse display
        const point = screen.getCursorScreenPoint();
        const display = screen.getDisplayNearestPoint(point);
        const x = display.bounds.x + (display.bounds.width - 800) / 2;
        const y = display.bounds.y + (display.bounds.height - 600) / 2;
        spotlightWindow?.setBounds({ x: Math.floor(x), y: Math.floor(y), width: 800, height: 600 });

        spotlightWindow?.show();
        spotlightWindow?.focus();
      });
    }
  });

  if (!success) {
    console.error(`FAILED TO REGISTER SHORTCUT: ${shortcut}`);
    return false;
  } else {
    console.log(`Shortcut registered successfully: ${shortcut}`);
    return true;
  }
};

// ... inside app.whenReady ... 

  // Load Shortcut from DB or Default
  const savedShortcut = await SettingsService.get('global_shortcut', 'Alt+Space');
  registerGlobalShortcut(savedShortcut);

  // Settings IPC
  ipcMain.handle('get-settings', async (_, key, defaultValue) => {
    return await SettingsService.get(key, defaultValue);
  });

  ipcMain.handle('update-setting', async (_, key, value) => {
    await SettingsService.set(key, value);
    // If updating shortcut, re-register
    if (key === 'global_shortcut') {
        registerGlobalShortcut(value);
    }
  });
  
  ipcMain.handle('register-shortcut', async (_, shortcut) => {
      // Frontend validation check helper
      const success = registerGlobalShortcut(shortcut);
      if (success) {
          await SettingsService.set('global_shortcut', shortcut);
      }
      return success;
  });

  // Temporarily unregister shortcuts (for recording new ones)
  ipcMain.handle('unregister-shortcuts', () => {
      globalShortcut.unregisterAll();
      return true;
  });

  // Task IPC

  // Task IPC
  ipcMain.handle('get-tasks', async () => {
    return await TaskService.getAllTasks();
  });

  ipcMain.handle('create-task', async (_, title: string, tag?: string, type?: any, projectId?: number, parentId?: number) => {
    const task = await TaskService.createTask(title, tag, type, projectId, parentId);
    broadcastFetchTasks();
    return task;
  });

  ipcMain.handle('update-task', async (_, id: number, updates: any) => {
     const res = await TaskService.updateTask(id, updates);
     broadcastFetchTasks();
     return res;
  });

  ipcMain.handle('delete-task', async (_, id: number) => {
     const res = await TaskService.deleteTask(id);
     broadcastFetchTasks();
     return res;
  });

  ipcMain.handle('delete-all-tasks', async () => {
     timerManager.cancelAll();
     const res = await TaskService.deleteAllTasks();
     broadcastFetchTasks();
     return res;
  });
  
  ipcMain.handle('get-suggestions', async (_, maxDuration) => {
    return await TaskService.getSuggestions(maxDuration);
  });
  
  ipcMain.on('timer:add-memo', async (_, taskId, content) => {
    await TaskService.appendMemo(taskId, content);
    broadcastFetchTasks();
  });

  // GPU IPC
  ipcMain.handle('get-gpus', async () => {
    return await GpuService.getAllGpus();
  });

  ipcMain.handle('create-gpu', async (_, name: string, color?: string) => {
    const gpu = await GpuService.createGpu(name, color);
    broadcastFetchTasks();
    return gpu;
  });

  ipcMain.handle('delete-gpu', async (_, id: number) => {
    await GpuService.deleteGpu(id);
    broadcastFetchTasks();
  });

  ipcMain.on('gpu:assign-task', async (_, taskId: number, gpuId: number, durationMinutes: number) => {
      // Duration is in minutes from frontend? Let's assume minutes based on prompt "Input Name & Duration (2h)".
      // But typically "startWait" takes Seconds?
      // Let's check startWait call site. Preload: startWait: (taskId, duration) -> ipcRenderer.send('timer:start-wait', taskId, duration).
      // Command parser usually parses to minutes.
      // TimerManager.startWait takes durationSeconds.
      // Let's assume frontend passes MINUTES, we convert to SECONDS.
      await timerManager.startTraining(taskId, gpuId, durationMinutes * 60);
      broadcastFetchTasks();
  });

  // Project IPC
  ipcMain.handle('get-projects', async () => {
    return await ProjectService.getAllProjects();
  });

  ipcMain.handle('create-project', async (_, name: string, description?: string, color?: string) => {
    const project = await ProjectService.createProject(name, description, color);
    broadcastFetchTasks();
    return project;
  });

  ipcMain.handle('update-project', async (_, id: number, updates: any) => {
    const res = await ProjectService.updateProject(id, updates);
    broadcastFetchTasks();
    return res;
  });

  ipcMain.handle('delete-project', async (_, id: number) => {
    await ProjectService.deleteProject(id);
    broadcastFetchTasks();
  });

  ipcMain.handle('get-history', async (_, dateStr?: string) => {
    return await HistoryService.getHistory(dateStr);
  });
  
  ipcMain.handle('delete-history', async (_, id: number) => {
    const res = await HistoryService.deleteHistory(id);
    broadcastFetchTasks();
    return res;
  });

  // --- Data Backup & Import ---
  ipcMain.handle('export-data', async () => {
    const result = await dialog.showSaveDialog({
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
    }
  });

  ipcMain.handle('import-data', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import Database Backup',
      filters: [{ name: 'SQLite Database', extensions: ['db'] }],
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, message: 'Import cancelled' };
    }

    const sourcePath = result.filePaths[0];

    try {
      // Create a backup of the current database before overwriting
      const backupPath = dbPath.replace('.db', `-backup-${Date.now()}.db`);
      fs.copyFileSync(dbPath, backupPath);

      // Copy the imported file to the database path
      fs.copyFileSync(sourcePath, dbPath);

      return {
        success: true,
        message: `Database imported from ${sourcePath}. A backup was saved to ${backupPath}. Please restart the app.`,
        needsRestart: true,
      };
    } catch (err: any) {
      console.error('Import failed:', err);
      return { success: false, message: `Import failed: ${err.message}` };
    }
  });

  ipcMain.on('spotlight:hide', () => {
    spotlightWindow?.hide();
  });
  
  // Reminder IPC
  ipcMain.on('reminder:hide', () => {
    reminderWindow?.hide();
  });

  ipcMain.on('reminder:snooze', async (_, taskId, minutes) => {
    // For training tasks, reschedule the reminder
    await timerManager.snoozeTrainingReminder(taskId, minutes);
    broadcastFetchTasks();
  });
  
  // Timer IPC
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

  ipcMain.handle('timer:stop-training', async (_, taskId, forceComplete) => {
    await timerManager.stopTraining(taskId, forceComplete);
    broadcastFetchTasks();
  });

  ipcMain.on('set-overlay-ignore-mouse', (_, ignore: boolean) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.setIgnoreMouseEvents(ignore, { forward: true });
        // Make it focusable/clickable if ignore is false. But actually ignoreMouse:false is enough to receive events.
        // If ignore is false, we want it to be draggable (which requires receiving mouse events).
    }
  });

  ipcMain.on('reset-overlay-position', () => {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
          const primaryDisplay = screen.getPrimaryDisplay();
          const { width, height } = primaryDisplay.workAreaSize;
          const w = 350; // default width
          const h = 250; // default height
          const x = Math.round((width - w) / 2);
          const y = Math.round((height - h) / 2);
          
          overlayWindow.setBounds({ x, y, width: w, height: h });
          
          // Also save these new bounds
          SettingsService.set('overlay_bounds', { x, y, width: w, height: h });
      }
  });

});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

