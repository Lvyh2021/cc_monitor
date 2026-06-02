const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('ccMonitor', {
  getSessions: () => ipcRenderer.invoke('get-sessions'),
  resizeWindow: (width, height) => ipcRenderer.invoke('resize-window', { width, height }),
})
