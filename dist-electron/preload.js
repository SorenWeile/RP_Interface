"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    getBackendUrl: () => electron_1.ipcRenderer.invoke('get-backend-url'),
    getBackendConfig: () => electron_1.ipcRenderer.invoke('get-backend-config'),
    saveBackendConfig: (config) => electron_1.ipcRenderer.invoke('save-backend-config', config),
    // Legacy — kept for any code that still calls saveBackendUrl directly.
    saveBackendUrl: (url) => electron_1.ipcRenderer.invoke('save-backend-url', url),
    // Read synchronously so client.ts can use it as a module-level constant.
    backendUrl: electron_1.ipcRenderer.sendSync('get-backend-url-sync'),
});
