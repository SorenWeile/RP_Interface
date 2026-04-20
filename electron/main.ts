import { app, BrowserWindow, ipcMain, Menu } from 'electron'
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
