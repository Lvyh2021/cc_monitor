const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('ccMonitor', {
  getSessions: () => ipcRenderer.invoke('get-sessions'),
})
