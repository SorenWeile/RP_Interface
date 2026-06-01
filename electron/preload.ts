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

  compareBackends: (opts: { password: string }): Promise<unknown> =>
    ipcRenderer.invoke('compare-backends', opts),

  transferFiles: (opts: { paths: string[]; password: string }): Promise<unknown> =>
    ipcRenderer.invoke('transfer-files', opts),

  mergeDb: (opts: { password: string }): Promise<unknown> =>
    ipcRenderer.invoke('merge-db', opts),

  openFileDialog: (): Promise<Array<{ name: string; localPath: string; size: number }>> =>
    ipcRenderer.invoke('open-file-dialog'),

  getModelDirs: (opts: { password: string }): Promise<unknown> =>
    ipcRenderer.invoke('get-model-dirs', opts),

  uploadModels: (opts: {
    files:   Array<{ name: string; localPath: string; size: number }>;
    destDir: string;
    targets: ('local' | 'runpod')[];
    password: string;
  }): Promise<unknown> =>
    ipcRenderer.invoke('upload-models', opts),

  onUploadProgress: (cb: (data: {
    fi: number; name: string; target: string;
    loaded: number; total: number; done: boolean; error: string | null;
  }) => void): void => {
    ipcRenderer.on('upload-progress', (_e, data) => cb(data))
  },

  offUploadProgress: (): void => {
    ipcRenderer.removeAllListeners('upload-progress')
  },

  onTransferProgress: (cb: (data: { done: number; total: number; path: string; error: string | null }) => void): void => {
    ipcRenderer.on('transfer-progress', (_e, data) => cb(data))
  },

  offTransferProgress: (): void => {
    ipcRenderer.removeAllListeners('transfer-progress')
  },

  openExternal: (url: string): void =>
    ipcRenderer.send('open-external', url),

  openDocs: (): void =>
    ipcRenderer.send('open-docs'),

  // Read synchronously so client.ts can use it as a module-level constant.
  backendUrl: ipcRenderer.sendSync('get-backend-url-sync') as string,
})
