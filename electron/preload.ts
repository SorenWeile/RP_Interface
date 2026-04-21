import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  getBackendUrl: (): Promise<string> =>
    ipcRenderer.invoke('get-backend-url'),

  getBackendConfig: (): Promise<{
    localUrl: string; runpodUrl: string; activeBackend: string
  }> =>
    ipcRenderer.invoke('get-backend-config'),

  saveBackendConfig: (config: {
    localUrl: string; runpodUrl: string; activeBackend: 'local' | 'runpod'
  }): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('save-backend-config', config),

  // Legacy — kept for any code that still calls saveBackendUrl directly.
  saveBackendUrl: (url: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('save-backend-url', url),

  // Read synchronously so client.ts can use it as a module-level constant.
  backendUrl: ipcRenderer.sendSync('get-backend-url-sync') as string,
})
