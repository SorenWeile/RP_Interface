"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const electron_store_1 = __importDefault(require("electron-store"));
const path_1 = __importDefault(require("path"));
const store = new electron_store_1.default();
let mainWindow = null;
// Absolute path to the bundled React app (works in dev and in packaged app).
function frontendPath() {
    return path_1.default.join(__dirname, '..', 'dist-frontend', 'index.html');
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
function activeBackendUrl() {
    const which = store.get('activeBackend', 'local');
    return which === 'runpod'
        ? store.get('runpodUrl', '')
        : store.get('localUrl', '');
}
function installApiRedirect() {
    electron_1.session.defaultSession.webRequest.onBeforeRequest({ urls: ['file://*/*'] }, (details, callback) => {
        const backendUrl = activeBackendUrl();
        if (!backendUrl) {
            callback({});
            return;
        }
        try {
            const parsed = new URL(details.url);
            // On Windows, pathname is e.g. /C:/api/gallery/image/...
            // On all platforms the segment we care about starts with /api/
            const apiIdx = parsed.pathname.indexOf('/api/');
            if (apiIdx !== -1) {
                const apiPath = parsed.pathname.slice(apiIdx) + parsed.search;
                callback({ redirectURL: `${backendUrl}${apiPath}` });
                return;
            }
        }
        catch { /* ignore malformed URLs */ }
        callback({});
    });
}
// ── Window factory ────────────────────────────────────────────────────────────
function createWindow() {
    const win = new electron_1.BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1024,
        minHeight: 700,
        title: 'AI Toolhouse',
        icon: path_1.default.join(__dirname, '..', 'dist-frontend', 'ai_toolhouse.png'),
        backgroundColor: '#0f0f0f',
        webPreferences: {
            preload: path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    if (activeBackendUrl()) {
        win.loadFile(frontendPath());
    }
    else {
        loadSettings(win);
    }
    return win;
}
function loadSettings(win) {
    const settingsPath = path_1.default.join(__dirname, 'settings.html');
    win.loadFile(settingsPath);
}
function loadSync(win) {
    const syncPath = path_1.default.join(__dirname, 'sync.html');
    win.loadFile(syncPath);
}
// ── Application menu ──────────────────────────────────────────────────────────
function buildMenu() {
    const template = [
        {
            label: 'AI Toolhouse',
            submenu: [
                {
                    label: 'Settings…',
                    accelerator: 'CmdOrCtrl+,',
                    click: () => {
                        if (mainWindow)
                            loadSettings(mainWindow);
                    },
                },
                {
                    label: 'Sync Tool…',
                    accelerator: 'CmdOrCtrl+Shift+S',
                    click: () => {
                        if (mainWindow)
                            loadSync(mainWindow);
                    },
                },
                { type: 'separator' },
                {
                    label: 'Switch to Local Docker',
                    click: () => {
                        const url = store.get('localUrl', '');
                        if (!url) {
                            if (mainWindow)
                                loadSettings(mainWindow);
                            return;
                        }
                        store.set('activeBackend', 'local');
                        if (mainWindow)
                            mainWindow.loadFile(frontendPath());
                    },
                },
                {
                    label: 'Switch to RunPod Pod',
                    click: () => {
                        const url = store.get('runpodUrl', '');
                        if (!url) {
                            if (mainWindow)
                                loadSettings(mainWindow);
                            return;
                        }
                        store.set('activeBackend', 'runpod');
                        if (mainWindow)
                            mainWindow.loadFile(frontendPath());
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
    ];
    electron_1.Menu.setApplicationMenu(electron_1.Menu.buildFromTemplate(template));
}
// ── Sync helpers (shared by compare and transfer IPC handlers) ────────────────
async function syncLogin(baseUrl, password) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'admin', password }),
        signal: AbortSignal.timeout(8000),
    });
    if (!res.ok)
        throw new Error(`Login failed on ${baseUrl.replace(/https?:\/\//, '')} (${res.status})`);
    const data = await res.json();
    return data.token;
}
async function syncFetch(baseUrl, token, endpoint) {
    const res = await fetch(`${baseUrl}${endpoint}`, {
        headers: { 'X-User-Token': token },
        signal: AbortSignal.timeout(60000),
    });
    if (!res.ok)
        throw new Error(`${endpoint} failed on ${baseUrl.replace(/https?:\/\//, '')} (${res.status})`);
    return res.json();
}
// ── IPC handlers ──────────────────────────────────────────────────────────────
// Synchronous read — called by preload before any renderer script runs.
electron_1.ipcMain.on('get-backend-url-sync', (event) => {
    event.returnValue = activeBackendUrl();
});
electron_1.ipcMain.handle('get-backend-url', () => activeBackendUrl());
electron_1.ipcMain.handle('get-backend-config', () => ({
    localUrl: store.get('localUrl', ''),
    runpodUrl: store.get('runpodUrl', ''),
    activeBackend: store.get('activeBackend', 'local'),
}));
electron_1.ipcMain.handle('save-backend-config', (_event, config) => {
    store.set('localUrl', config.localUrl.replace(/\/+$/, ''));
    store.set('runpodUrl', config.runpodUrl.replace(/\/+$/, ''));
    store.set('activeBackend', config.activeBackend);
    if (mainWindow) {
        mainWindow.loadFile(frontendPath());
    }
    return { success: true };
});
electron_1.ipcMain.handle('compare-backends', async (_event, { password }) => {
    const localUrl = store.get('localUrl', '');
    const runpodUrl = store.get('runpodUrl', '');
    if (!localUrl || !runpodUrl) {
        return { error: 'Both Local and RunPod URLs must be configured in Settings before comparing.' };
    }
    function diffFiles(local, runpod) {
        const lMap = new Map(local.map(f => [f.path, f]));
        const rMap = new Map(runpod.map(f => [f.path, f]));
        return {
            totalLocal: local.length,
            totalRunpod: runpod.length,
            onlyLocal: local.filter(f => !rMap.has(f.path)),
            onlyRunpod: runpod.filter(f => !lMap.has(f.path)),
            different: local
                .filter(f => { const r = rMap.get(f.path); return r && r.size !== f.size; })
                .map(f => ({ ...f, runpodSize: rMap.get(f.path).size })),
            synced: local.filter(f => { const r = rMap.get(f.path); return r && r.size === f.size; }),
        };
    }
    function diffTable(local, runpod, key) {
        const lKeys = new Set(local.map(r => r[key]));
        const rKeys = new Set(runpod.map(r => r[key]));
        return {
            totalLocal: local.length,
            totalRunpod: runpod.length,
            onlyLocal: local.filter(r => !rKeys.has(r[key])),
            onlyRunpod: runpod.filter(r => !lKeys.has(r[key])),
        };
    }
    try {
        const [localToken, runpodToken] = await Promise.all([
            syncLogin(localUrl, password),
            syncLogin(runpodUrl, password),
        ]);
        const [lFiles, rFiles, lModels, rModels, lDb, rDb] = await Promise.all([
            syncFetch(localUrl, localToken, '/api/sync/files'),
            syncFetch(runpodUrl, runpodToken, '/api/sync/files'),
            syncFetch(localUrl, localToken, '/api/sync/models'),
            syncFetch(runpodUrl, runpodToken, '/api/sync/models'),
            syncFetch(localUrl, localToken, '/api/sync/db-summary'),
            syncFetch(runpodUrl, runpodToken, '/api/sync/db-summary'),
        ]);
        return {
            files: diffFiles(lFiles.files, rFiles.files),
            models: diffFiles(lModels.models, rModels.models),
            db: {
                users: diffTable(lDb.users ?? [], rDb.users ?? [], 'username'),
                groups: diffTable(lDb.groups ?? [], rDb.groups ?? [], 'name'),
                clients: diffTable(lDb.clients ?? [], rDb.clients ?? [], 'name'),
                projects: diffTable(lDb.projects ?? [], rDb.projects ?? [], 'name'),
                tools: diffTable(lDb.tools ?? [], rDb.tools ?? [], 'name'),
            },
        };
    }
    catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
    }
});
electron_1.ipcMain.handle('transfer-files', async (event, { paths, password, }) => {
    const localUrl = store.get('localUrl', '');
    const runpodUrl = store.get('runpodUrl', '');
    if (!localUrl || !runpodUrl) {
        return { error: 'Both Local and RunPod URLs must be configured in Settings.' };
    }
    try {
        const [localToken, runpodToken] = await Promise.all([
            syncLogin(localUrl, password),
            syncLogin(runpodUrl, password),
        ]);
        const errors = [];
        for (let i = 0; i < paths.length; i++) {
            const filePath = paths[i];
            try {
                // Download from RunPod
                const dlRes = await fetch(`${runpodUrl}/api/sync/download?path=${encodeURIComponent(filePath)}`, { headers: { 'X-User-Token': runpodToken }, signal: AbortSignal.timeout(300000) });
                if (!dlRes.ok)
                    throw new Error(`Download failed (${dlRes.status})`);
                const buffer = await dlRes.arrayBuffer();
                // Upload to local (NAS)
                const form = new FormData();
                form.append('file', new Blob([buffer]), filePath.split('/').pop() ?? 'file');
                const ulRes = await fetch(`${localUrl}/api/sync/upload?path=${encodeURIComponent(filePath)}`, {
                    method: 'POST',
                    headers: { 'X-User-Token': localToken },
                    body: form,
                    signal: AbortSignal.timeout(300000),
                });
                if (!ulRes.ok)
                    throw new Error(`Upload failed (${ulRes.status})`);
            }
            catch (err) {
                errors.push({ path: filePath, error: err instanceof Error ? err.message : String(err) });
            }
            event.sender.send('transfer-progress', {
                done: i + 1,
                total: paths.length,
                path: filePath,
                error: errors.find(e => e.path === filePath)?.error ?? null,
            });
        }
        return { done: paths.length, errors };
    }
    catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
    }
});
electron_1.ipcMain.handle('merge-db', async (_event, { password }) => {
    const localUrl = store.get('localUrl', '');
    const runpodUrl = store.get('runpodUrl', '');
    if (!localUrl || !runpodUrl) {
        return { error: 'Both Local and RunPod URLs must be configured in Settings before merging.' };
    }
    try {
        const [localToken, runpodToken] = await Promise.all([
            syncLogin(localUrl, password),
            syncLogin(runpodUrl, password),
        ]);
        // Export from both sides simultaneously
        const [nasDb, runpodDb] = await Promise.all([
            syncFetch(localUrl, localToken, '/api/sync/db-export'),
            syncFetch(runpodUrl, runpodToken, '/api/sync/db-export'),
        ]);
        // Push NAS → RunPod  and  RunPod → NAS simultaneously
        const [runpodRes, nasRes] = await Promise.all([
            fetch(`${runpodUrl}/api/sync/db-import`, {
                method: 'POST',
                headers: { 'X-User-Token': runpodToken, 'Content-Type': 'application/json' },
                body: JSON.stringify(nasDb),
                signal: AbortSignal.timeout(30000),
            }),
            fetch(`${localUrl}/api/sync/db-import`, {
                method: 'POST',
                headers: { 'X-User-Token': localToken, 'Content-Type': 'application/json' },
                body: JSON.stringify(runpodDb),
                signal: AbortSignal.timeout(30000),
            }),
        ]);
        if (!runpodRes.ok)
            throw new Error(`RunPod import failed (${runpodRes.status})`);
        if (!nasRes.ok)
            throw new Error(`NAS import failed (${nasRes.status})`);
        const [runpodResult, nasResult] = await Promise.all([
            runpodRes.json(),
            nasRes.json(),
        ]);
        return { ok: true, toRunpod: runpodResult.inserted, toNas: nasResult.inserted };
    }
    catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
    }
});
// Legacy single-URL handler kept so old preload builds don't break.
electron_1.ipcMain.handle('save-backend-url', (_event, url) => {
    const which = store.get('activeBackend', 'local');
    if (which === 'runpod')
        store.set('runpodUrl', url.replace(/\/+$/, ''));
    else
        store.set('localUrl', url.replace(/\/+$/, ''));
    if (mainWindow)
        mainWindow.loadFile(frontendPath());
    return { success: true };
});
// ── Lifecycle ─────────────────────────────────────────────────────────────────
electron_1.app.whenReady().then(() => {
    installApiRedirect();
    buildMenu();
    mainWindow = createWindow();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            mainWindow = createWindow();
        }
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
