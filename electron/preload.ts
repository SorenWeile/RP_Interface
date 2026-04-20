import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  getBackendUrl: (): Promise<string> =>
    ipcRenderer.invoke('get-backend-url'),

  saveBackendUrl: (url: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('save-backend-url', url),
})
