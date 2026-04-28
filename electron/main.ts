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

function loadSync(win: BrowserWindow): void {
  const syncPath = path.join(__dirname, 'sync.html')
  win.loadFile(syncPath)
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
        {
          label: 'Sync Tool…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => {
            if (mainWindow) loadSync(mainWindow)
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

// ── Sync helpers (shared by compare and transfer IPC handlers) ────────────────

async function syncLogin(baseUrl: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'admin', password }),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`Login failed on ${baseUrl.replace(/https?:\/\//, '')} (${res.status})`)
  const data = await res.json() as { token: string }
  return data.token
}

async function syncFetch(baseUrl: string, token: string, endpoint: string): Promise<unknown> {
  const res = await fetch(`${baseUrl}${endpoint}`, {
    headers: { 'X-User-Token': token },
    signal: AbortSignal.timeout(60000),
  })
  if (!res.ok) throw new Error(`${endpoint} failed on ${baseUrl.replace(/https?:\/\//, '')} (${res.status})`)
  return res.json()
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

ipcMain.handle('compare-backends', async (_event, { password }: { password: string }) => {
  const localUrl  = store.get('localUrl',  '') as string
  const runpodUrl = store.get('runpodUrl', '') as string

  if (!localUrl || !runpodUrl) {
    return { error: 'Both Local and RunPod URLs must be configured in Settings before comparing.' }
  }

  function diffFiles(local: Array<{path:string;size:number}>, runpod: Array<{path:string;size:number}>) {
    const lMap = new Map(local.map(f => [f.path, f]))
    const rMap = new Map(runpod.map(f => [f.path, f]))
    return {
      totalLocal:  local.length,
      totalRunpod: runpod.length,
      onlyLocal:   local.filter(f => !rMap.has(f.path)),
      onlyRunpod:  runpod.filter(f => !lMap.has(f.path)),
      different:   local.filter(f => { const r = rMap.get(f.path); return r && r.size !== f.size }),
    }
  }

  function diffTable(local: Array<Record<string,unknown>>, runpod: Array<Record<string,unknown>>, key: string) {
    const lKeys = new Set(local.map(r => r[key]))
    const rKeys = new Set(runpod.map(r => r[key]))
    return {
      totalLocal:  local.length,
      totalRunpod: runpod.length,
      onlyLocal:   local.filter(r => !rKeys.has(r[key])),
      onlyRunpod:  runpod.filter(r => !lKeys.has(r[key])),
    }
  }

  try {
    const [localToken, runpodToken] = await Promise.all([
      syncLogin(localUrl,  password),
      syncLogin(runpodUrl, password),
    ])

    const [lFiles, rFiles, lModels, rModels, lDb, rDb] = await Promise.all([
      syncFetch(localUrl,  localToken,  '/api/sync/files')   as Promise<{files:  Array<{path:string;size:number}>}>,
      syncFetch(runpodUrl, runpodToken, '/api/sync/files')   as Promise<{files:  Array<{path:string;size:number}>}>,
      syncFetch(localUrl,  localToken,  '/api/sync/models')  as Promise<{models: Array<{path:string;size:number}>}>,
      syncFetch(runpodUrl, runpodToken, '/api/sync/models')  as Promise<{models: Array<{path:string;size:number}>}>,
      syncFetch(localUrl,  localToken,  '/api/sync/db-summary') as Promise<Record<string, Array<Record<string,unknown>>>>,
      syncFetch(runpodUrl, runpodToken, '/api/sync/db-summary') as Promise<Record<string, Array<Record<string,unknown>>>>,
    ])

    return {
      files:   diffFiles((lFiles  as any).files,   (rFiles  as any).files),
      models:  diffFiles((lModels as any).models,  (rModels as any).models),
      db: {
        users:    diffTable((lDb as any).users    ?? [], (rDb as any).users    ?? [], 'username'),
        groups:   diffTable((lDb as any).groups   ?? [], (rDb as any).groups   ?? [], 'name'),
        clients:  diffTable((lDb as any).clients  ?? [], (rDb as any).clients  ?? [], 'name'),
        projects: diffTable((lDb as any).projects ?? [], (rDb as any).projects ?? [], 'name'),
        tools:    diffTable((lDb as any).tools    ?? [], (rDb as any).tools    ?? [], 'name'),
      },
    }
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('transfer-files', async (event, {
  paths, password,
}: { paths: string[]; password: string }) => {
  const localUrl  = store.get('localUrl',  '') as string
  const runpodUrl = store.get('runpodUrl', '') as string

  if (!localUrl || !runpodUrl) {
    return { error: 'Both Local and RunPod URLs must be configured in Settings.' }
  }

  try {
    const [localToken, runpodToken] = await Promise.all([
      syncLogin(localUrl,  password),
      syncLogin(runpodUrl, password),
    ])

    const errors: Array<{ path: string; error: string }> = []

    for (let i = 0; i < paths.length; i++) {
      const filePath = paths[i]
      try {
        // Download from RunPod
        const dlRes = await fetch(
          `${runpodUrl}/api/sync/download?path=${encodeURIComponent(filePath)}`,
          { headers: { 'X-User-Token': runpodToken }, signal: AbortSignal.timeout(300_000) },
        )
        if (!dlRes.ok) throw new Error(`Download failed (${dlRes.status})`)
        const buffer = await dlRes.arrayBuffer()

        // Upload to local (NAS)
        const form = new FormData()
        form.append('file', new Blob([buffer]), filePath.split('/').pop() ?? 'file')
        const ulRes = await fetch(
          `${localUrl}/api/sync/upload?path=${encodeURIComponent(filePath)}`,
          {
            method: 'POST',
            headers: { 'X-User-Token': localToken },
            body: form,
            signal: AbortSignal.timeout(300_000),
          },
        )
        if (!ulRes.ok) throw new Error(`Upload failed (${ulRes.status})`)
      } catch (err: unknown) {
        errors.push({ path: filePath, error: err instanceof Error ? err.message : String(err) })
      }

      event.sender.send('transfer-progress', {
        done:  i + 1,
        total: paths.length,
        path:  filePath,
        error: errors.find(e => e.path === filePath)?.error ?? null,
      })
    }

    return { done: paths.length, errors }
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
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
