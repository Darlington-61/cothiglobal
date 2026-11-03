const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cbtAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  requestExit: (pin) => ipcRenderer.invoke('request-exit', pin),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  discoverServer: () => ipcRenderer.invoke('discover-server'),
  scanNetwork: () => ipcRenderer.invoke('scan-network'),
  onServerDiscovered: (callback) => ipcRenderer.on('server-discovered', (event, data) => callback(data)),
  isElectron: true
});
