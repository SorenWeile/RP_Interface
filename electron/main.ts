import { app, BrowserWindow, ipcMain, Menu, session } from 'electron'
import Store from 'electron-store'
import path from 'path'

interface StoreSchema {
  localUrl:      string
  runpodUrl:     string
  activeBackend: 'local' | 'runpod'
}

const store = new Store<StoreSchema>()

let mainWindow: BrowserWindow | null = null

// Absolute path to the bundled React app (works in dev and in packaged app).
function frontendPath(): string {
  return path.join(__dirname, '..', 'dist-frontend', 'index.html')
}

// ── Session-level request interceptor ────────────────────────────────────────
//
// When the React app is loaded from file://, any resource path starting with /
// (img src, video src, download links, WebSocket upgrades …) resolves to the
// local filesystem instead of the Docker backend.
//
// We intercept at the Electron session level so every request type is caught —
// not just fetch() calls. Any file:// request whose path contains /api/ is
// transparently forwarded to the configured backend URL.

function activeBackendUrl(): string {
  const which = store.get('activeBackend', 'local') as string
  return which === 'runpod'
    ? (store.get('runpodUrl', '') as string)
    : (store.get('localUrl',  '') as string)
}

function installApiRedirect(): void {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['file://*/*'] },
    (details, callback) => {
      const backendUrl = activeBackendUrl()
      if (!backendUrl) { callback({}); return }

      try {
        const parsed = new URL(details.url)
        // On Windows, pathname is e.g. /C:/api/gallery/image/...
        // On all platforms the segment we care about starts with /api/
        const apiIdx = parsed.pathname.indexOf('/api/')
        if (apiIdx !== -1) {
          const apiPath = parsed.pathname.slice(apiIdx) + parsed.search
          callback({ redirectURL: `${backendUrl}${apiPath}` })
          return
        }
      } catch { /* ignore malformed URLs */ }

      callback({})
    },
  )
}

// ── Window factory ────────────────────────────────────────────────────────────

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'AI Toolhouse',
    icon: path.join(__dirname, '..', 'dist-frontend', 'ai_toolhouse.png'),
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (activeBackendUrl()) {
    win.loadFile(frontendPath())
  } else {
    loadSettings(win)
  }

  return win
}

function loadSettings(win: BrowserWindow): void {
  const settingsPath = path.join(__dirname, 'settings.html')
  win.loadFile(settingsPath)
}

// ── Application menu ──────────────────────────────────────────────────────────

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'AI Toolhouse',
      submenu: [
        {
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            if (mainWindow) loadSettings(mainWindow)
          },
        },
        { type: 'separator' },
        {
          label: 'Switch to Local Docker',
          click: () => {
            const url = store.get('localUrl', '') as string
            if (!url) { if (mainWindow) loadSettings(mainWindow); return }
            store.set('activeBackend', 'local')
            if (mainWindow) mainWindow.loadFile(frontendPath())
          },
        },
        {
          label: 'Switch to RunPod Pod',
          click: () => {
            const url = store.get('runpodUrl', '') as string
            if (!url) { if (mainWindow) loadSettings(mainWindow); return }
            store.set('activeBackend', 'runpod')
            if (mainWindow) mainWindow.loadFile(frontendPath())
          },
        },
        { type: 'separator' },
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow?.reload(),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

// Synchronous read — called by preload before any renderer script runs.
ipcMain.on('get-backend-url-sync', (event) => {
  event.returnValue = activeBackendUrl()
})

ipcMain.handle('get-backend-url', () => activeBackendUrl())

ipcMain.handle('get-backend-config', () => ({
  localUrl:      store.get('localUrl',      '') as string,
  runpodUrl:     store.get('runpodUrl',     '') as string,
  activeBackend: store.get('activeBackend', 'local') as string,
}))

ipcMain.handle('save-backend-config', (_event, config: {
  localUrl: string, runpodUrl: string, activeBackend: 'local' | 'runpod'
}) => {
  store.set('localUrl',      config.localUrl.replace(/\/+$/, ''))
  store.set('runpodUrl',     config.runpodUrl.replace(/\/+$/, ''))
  store.set('activeBackend', config.activeBackend)
  if (mainWindow) {
    mainWindow.loadFile(frontendPath())
  }
  return { success: true }
})

// Legacy single-URL handler kept so old preload builds don't break.
ipcMain.handle('save-backend-url', (_event, url: string) => {
  const which = store.get('activeBackend', 'local') as string
  if (which === 'runpod') store.set('runpodUrl', url.replace(/\/+$/, ''))
  else                    store.set('localUrl',  url.replace(/\/+$/, ''))
  if (mainWindow) mainWindow.loadFile(frontendPath())
  return { success: true }
})

// ── Lifecycle ─────────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  installApiRedirect()
  buildMenu()
  mainWindow = createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
