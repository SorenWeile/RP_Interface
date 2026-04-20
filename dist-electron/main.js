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
// ── Window factory ────────────────────────────────────────────────────────────
function createWindow() {
    const win = new electron_1.BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1024,
        minHeight: 700,
        title: 'RP Interface',
        backgroundColor: '#0f0f0f',
        webPreferences: {
            preload: path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    const backendUrl = store.get('backendUrl', '');
    if (backendUrl) {
        win.loadURL(backendUrl);
    }
    else {
        loadSettings(win);
    }
    return win;
}
function loadSettings(win) {
    // settings.html lives next to main.js in dist-electron/
    const settingsPath = path_1.default.join(__dirname, 'settings.html');
    win.loadFile(settingsPath);
}
// ── Application menu ──────────────────────────────────────────────────────────
function buildMenu() {
    const template = [
        {
            label: 'RP Interface',
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
electron_1.ipcMain.handle('get-backend-url', () => store.get('backendUrl', ''));
electron_1.ipcMain.handle('save-backend-url', (_event, url) => {
    store.set('backendUrl', url.replace(/\/+$/, '')); // strip trailing slashes
    if (mainWindow) {
        mainWindow.loadURL(store.get('backendUrl'));
    }
    return { success: true };
});
// ── Lifecycle ─────────────────────────────────────────────────────────────────
electron_1.app.whenReady().then(() => {
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
