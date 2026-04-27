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
