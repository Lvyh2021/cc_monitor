const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('ccMonitor', {
  getSessions: () => ipcRenderer.invoke('get-sessions'),
  resizeWindow: (width, height) => ipcRenderer.invoke('resize-window', { width, height }),
  getDeepseekStatus: () => ipcRenderer.invoke('get-deepseek-status'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (data) => ipcRenderer.invoke('save-config', data),
})
