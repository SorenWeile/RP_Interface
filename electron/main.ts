import { app, BrowserWindow, ipcMain, Menu, session } from 'electron'
import Store from 'electron-store'
import path from 'path'

interface StoreSchema {
  backendUrl: string
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

function installApiRedirect(): void {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['file://*/*'] },
    (details, callback) => {
      const backendUrl = store.get('backendUrl', '') as string
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
    title: 'RP Interface',
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const backendUrl = store.get('backendUrl', '') as string
  if (backendUrl) {
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
      label: 'RP Interface',
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
  event.returnValue = store.get('backendUrl', '')
})

ipcMain.handle('get-backend-url', () => store.get('backendUrl', ''))

ipcMain.handle('save-backend-url', (_event, url: string) => {
  store.set('backendUrl', url.replace(/\/+$/, ''))
  if (mainWindow) {
    // Reload the local React app — preload will re-read the new URL from store.
    mainWindow.loadFile(frontendPath())
  }
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
