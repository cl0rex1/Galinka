const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('galinkaDesktop', {
  status: () => ipcRenderer.invoke('updates:status'),
  check: () => ipcRenderer.invoke('updates:check'),
  download: () => ipcRenderer.invoke('updates:download'),
  install: () => ipcRenderer.invoke('updates:install'),
  releases: () => ipcRenderer.invoke('updates:releases'),
  onStatus: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('updates:status', listener);
    return () => ipcRenderer.removeListener('updates:status', listener);
  },
});
