import { BrowserWindow, Tray, Menu, nativeImage, screen, app } from 'electron'
import path from 'node:path'
import { SettingsService } from './db/service'

const __dirname = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'))

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function getRendererDist(): string {
  return path.join(process.env.APP_ROOT!, 'dist')
}

const PRELOAD_PATH = path.join(__dirname, 'preload.mjs')

export interface WindowRefs {
  dashboard: BrowserWindow | null
  spotlight: BrowserWindow | null
  reminder: BrowserWindow | null
  overlay: BrowserWindow | null
  tray: Tray | null
  isQuitting: boolean
}

export function createWindowRefs(): WindowRefs {
  return { dashboard: null, spotlight: null, reminder: null, overlay: null, tray: null, isQuitting: false }
}

export function createDashboardWindow(refs: WindowRefs): void {
  refs.dashboard = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(process.env.VITE_PUBLIC!, 'icon.png'),
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  })

  if (VITE_DEV_SERVER_URL) {
    refs.dashboard.loadURL(`${VITE_DEV_SERVER_URL}?type=dashboard`)
  } else {
    refs.dashboard.loadFile(path.join(getRendererDist(), 'index.html'), { query: { type: 'dashboard' } })
  }

  refs.dashboard.once('ready-to-show', () => {
    refs.dashboard?.show()
  })

  refs.dashboard.on('close', (event) => {
    if (!refs.isQuitting) {
      event.preventDefault()
      refs.dashboard?.hide()
    }
  })

  refs.dashboard.on('closed', () => {
    refs.dashboard = null
  })
}

export function createTray(refs: WindowRefs): void {
  const iconPath = path.join(process.env.VITE_PUBLIC!, 'icon.png')
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })

  refs.tray = new Tray(icon)
  refs.tray.setToolTip('DayFlowGemini')

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Dashboard', click: () => refs.dashboard?.show() },
    { label: 'Quit', click: () => {
      refs.isQuitting = true
      app.quit()
    }},
  ])

  refs.tray.setContextMenu(contextMenu)
  refs.tray.on('click', () => {
    refs.dashboard?.show()
  })
}

export function createSpotlightWindow(refs: WindowRefs): void {
  refs.spotlight = new BrowserWindow({
    width: 800,
    height: 600,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    refs.spotlight.loadURL(`${VITE_DEV_SERVER_URL}?type=spotlight`)
  } else {
    refs.spotlight.loadFile(path.join(getRendererDist(), 'index.html'), { query: { type: 'spotlight' } })
  }
}

export function createReminderWindow(refs: WindowRefs): void {
  if (refs.reminder && !refs.reminder.isDestroyed()) {
    refs.reminder.show()
    refs.reminder.focus()
    return
  }

  refs.reminder = new BrowserWindow({
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
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    refs.reminder.loadURL(`${VITE_DEV_SERVER_URL}?type=reminder`)
  } else {
    refs.reminder.loadFile(path.join(getRendererDist(), 'index.html'), { query: { type: 'reminder' } })
  }

  refs.reminder.once('ready-to-show', () => {
    const point = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(point)
    const x = display.bounds.x + (display.bounds.width - 500) / 2
    const y = display.bounds.y + (display.bounds.height - 450) / 2
    refs.reminder?.setBounds({ x: Math.floor(x), y: Math.floor(y), width: 500, height: 450 })
    refs.reminder?.show()
    refs.reminder?.focus()
  })

  refs.reminder.on('blur', () => {
    if (refs.reminder && !refs.reminder.isDestroyed() && refs.reminder.isVisible()) {
      setTimeout(() => {
        if (refs.reminder && !refs.reminder.isDestroyed()) {
          refs.reminder.setAlwaysOnTop(true, 'screen-saver')
        }
      }, 100)
    }
  })

  refs.reminder.on('closed', () => {
    refs.reminder = null
  })
}

export function showReminderWindow(refs: WindowRefs): void {
  if (refs.reminder && !refs.reminder.isDestroyed()) {
    const point = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(point)
    const x = display.bounds.x + (display.bounds.width - 500) / 2
    const y = display.bounds.y + (display.bounds.height - 450) / 2
    refs.reminder.setBounds({ x: Math.floor(x), y: Math.floor(y), width: 500, height: 450 })

    if (refs.reminder.isMinimized()) refs.reminder.restore()
    refs.reminder.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    refs.reminder.setAlwaysOnTop(true, 'screen-saver')
    refs.reminder.show()
    refs.reminder.focus()
    refs.reminder.flashFrame(true)
  } else {
    createReminderWindow(refs)
  }
}

let overlaySaveTimeout: NodeJS.Timeout | null = null

export async function createOverlayWindow(refs: WindowRefs): Promise<void> {
  const savedBounds = await SettingsService.get('overlay_bounds', { x: 100, y: 100, width: 350, height: 250 })

  refs.overlay = new BrowserWindow({
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
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    refs.overlay.loadURL(`${VITE_DEV_SERVER_URL}?type=overlay`)
  } else {
    refs.overlay.loadFile(path.join(getRendererDist(), 'index.html'), { query: { type: 'overlay' } })
  }

  refs.overlay.setIgnoreMouseEvents(true, { forward: true })
  refs.overlay.setAlwaysOnTop(true, 'screen-saver')

  const saveBounds = () => {
    if (overlaySaveTimeout) clearTimeout(overlaySaveTimeout)
    overlaySaveTimeout = setTimeout(() => {
      if (refs.overlay && !refs.overlay.isDestroyed()) {
        SettingsService.set('overlay_bounds', refs.overlay.getBounds())
      }
    }, 1000)
  }

  refs.overlay.on('moved', saveBounds)
  refs.overlay.on('resized', saveBounds)
  refs.overlay.on('closed', () => { refs.overlay = null })
  refs.overlay.showInactive()
}
