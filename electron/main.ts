import { app, BrowserWindow, dialog, ipcMain, Menu, session } from 'electron'
import Store from 'electron-store'
import * as fs from 'fs'
import * as http from 'http'
import * as https from 'https'
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

function loadModelUpload(win: BrowserWindow): void {
  win.loadFile(path.join(__dirname, 'model-upload.html'))
}

// ── Streaming multipart upload helper ────────────────────────────────────────
//
// Streams a local file directly to the backend without buffering the whole
// file in memory — essential for multi-GB model files.

async function streamUploadModel(
  baseUrl: string,
  token: string,
  remoteRelPath: string,
  localFilePath: string,
  onProgress: (loaded: number, total: number) => void,
): Promise<void> {
  const stat       = fs.statSync(localFilePath)
  const totalBytes = stat.size
  const filename   = path.basename(localFilePath).replace(/"/g, '\\"')
  const boundary   = `Boundary${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`

  const preamble = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n`,
  )
  const epilogue      = Buffer.from(`\r\n--${boundary}--\r\n`)
  const contentLength = preamble.length + totalBytes + epilogue.length

  const url       = new URL(`${baseUrl}/api/sync/model-upload?path=${encodeURIComponent(remoteRelPath)}`)
  const transport = url.protocol === 'https:' ? https : http

  return new Promise<void>((resolve, reject) => {
    const req = transport.request(
      {
        hostname: url.hostname,
        port:     url.port ? parseInt(url.port) : (url.protocol === 'https:' ? 443 : 80),
        path:     url.pathname + url.search,
        method:   'POST',
        headers:  {
          'X-User-Token':  token,
          'Content-Type':  `multipart/form-data; boundary=${boundary}`,
          'Content-Length': contentLength,
        },
      },
      (res) => {
        let body = ''
        res.on('data', (c) => { body += c })
        res.on('end',  () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve()
          else reject(new Error(`Upload failed (${res.statusCode}): ${body.slice(0, 200)}`))
        })
      },
    )

    req.on('error', reject)
    req.write(preamble)

    let uploaded = 0
    const stream = fs.createReadStream(localFilePath, { highWaterMark: 1024 * 1024 })

    stream.on('data', (chunk: Buffer) => {
      uploaded += chunk.length
      const ok = req.write(chunk)
      onProgress(uploaded, totalBytes)
      if (!ok) { stream.pause(); req.once('drain', () => stream.resume()) }
    })
    stream.on('end',   () => { req.write(epilogue); req.end() })
    stream.on('error', reject)
  })
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
        {
          label: 'Model Uploader…',
          accelerator: 'CmdOrCtrl+Shift+M',
          click: () => {
            if (mainWindow) loadModelUpload(mainWindow)
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
      different:   local
        .filter(f => { const r = rMap.get(f.path); return r && r.size !== f.size })
        .map(f => ({ ...f, runpodSize: rMap.get(f.path)!.size })),
      synced:      local.filter(f => { const r = rMap.get(f.path); return r && r.size === f.size }),
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

ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select Model Files',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Model Files', extensions: ['safetensors', 'ckpt', 'pt', 'pth', 'bin', 'gguf', 'sft'] },
      { name: 'All Files',   extensions: ['*'] },
    ],
  })
  if (result.canceled) return []
  return result.filePaths.map(p => ({
    name:      path.basename(p),
    localPath: p,
    size:      fs.statSync(p).size,
  }))
})

ipcMain.handle('get-model-dirs', async (_event, { password }: { password: string }) => {
  const localUrl  = store.get('localUrl',  '') as string
  const runpodUrl = store.get('runpodUrl', '') as string

  const results: Record<string, { root: string; dirs: string[] } | { error: string }> = {}

  await Promise.allSettled([
    localUrl  ? syncLogin(localUrl,  password).then(t => syncFetch(localUrl,  t, '/api/sync/model-dirs')).then(d => { results.local  = d as { root: string; dirs: string[] } }).catch(e => { results.local  = { error: String(e) } }) : Promise.resolve(),
    runpodUrl ? syncLogin(runpodUrl, password).then(t => syncFetch(runpodUrl, t, '/api/sync/model-dirs')).then(d => { results.runpod = d as { root: string; dirs: string[] } }).catch(e => { results.runpod = { error: String(e) } }) : Promise.resolve(),
  ])

  const allDirs = new Set<string>()
  for (const r of Object.values(results)) {
    if ('dirs' in r) r.dirs.forEach(d => allDirs.add(d))
  }

  return { local: results.local, runpod: results.runpod, allDirs: [...allDirs].sort() }
})

ipcMain.handle('upload-models', async (event, {
  files, destDir, targets, password,
}: {
  files:   Array<{ name: string; localPath: string; size: number }>;
  destDir: string;
  targets: ('local' | 'runpod')[];
  password: string;
}) => {
  const urlMap: Record<string, string> = {
    local:  store.get('localUrl',  '') as string,
    runpod: store.get('runpodUrl', '') as string,
  }
  const tokens: Record<string, string> = {}

  try {
    await Promise.all(targets.map(async (t) => {
      if (!urlMap[t]) throw new Error(`${t} URL not configured`)
      tokens[t] = await syncLogin(urlMap[t], password)
    }))
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }

  const errors: Array<{ file: string; target: string; error: string }> = []

  for (let fi = 0; fi < files.length; fi++) {
    const f = files[fi]
    for (const target of targets) {
      const remoteRelPath = destDir ? `${destDir}/${f.name}` : f.name
      try {
        await streamUploadModel(
          urlMap[target], tokens[target], remoteRelPath, f.localPath,
          (loaded, total) => {
            event.sender.send('upload-progress', { fi, name: f.name, target, loaded, total, done: false, error: null })
          },
        )
        event.sender.send('upload-progress', { fi, name: f.name, target, loaded: f.size, total: f.size, done: true, error: null })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push({ file: f.name, target, error: msg })
        event.sender.send('upload-progress', { fi, name: f.name, target, loaded: 0, total: f.size, done: true, error: msg })
      }
    }
  }

  return { ok: true, errors }
})

ipcMain.handle('merge-db', async (_event, { password }: { password: string }) => {
  const localUrl  = store.get('localUrl',  '') as string
  const runpodUrl = store.get('runpodUrl', '') as string

  if (!localUrl || !runpodUrl) {
    return { error: 'Both Local and RunPod URLs must be configured in Settings before merging.' }
  }

  try {
    const [localToken, runpodToken] = await Promise.all([
      syncLogin(localUrl,  password),
      syncLogin(runpodUrl, password),
    ])

    // Export from both sides simultaneously
    const [nasDb, runpodDb] = await Promise.all([
      syncFetch(localUrl,  localToken,  '/api/sync/db-export'),
      syncFetch(runpodUrl, runpodToken, '/api/sync/db-export'),
    ])

    // Push NAS → RunPod  and  RunPod → NAS simultaneously
    const [runpodRes, nasRes] = await Promise.all([
      fetch(`${runpodUrl}/api/sync/db-import`, {
        method: 'POST',
        headers: { 'X-User-Token': runpodToken, 'Content-Type': 'application/json' },
        body: JSON.stringify(nasDb),
        signal: AbortSignal.timeout(30_000),
      }),
      fetch(`${localUrl}/api/sync/db-import`, {
        method: 'POST',
        headers: { 'X-User-Token': localToken, 'Content-Type': 'application/json' },
        body: JSON.stringify(runpodDb),
        signal: AbortSignal.timeout(30_000),
      }),
    ])

    if (!runpodRes.ok) throw new Error(`RunPod import failed (${runpodRes.status})`)
    if (!nasRes.ok)    throw new Error(`NAS import failed (${nasRes.status})`)

    const [runpodResult, nasResult] = await Promise.all([
      runpodRes.json() as Promise<{ ok: boolean; inserted: Record<string, number> }>,
      nasRes.json()    as Promise<{ ok: boolean; inserted: Record<string, number> }>,
    ])

    return { ok: true, toRunpod: runpodResult.inserted, toNas: nasResult.inserted }
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
