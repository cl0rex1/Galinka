const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('galinkaDesktop', {
  status: () => ipcRenderer.invoke('updates:status'),
  check: () => ipcRenderer.invoke('updates:check'),
  download: () => ipcRenderer.invoke('updates:download'),
  install: () => ipcRenderer.invoke('updates:install'),
  releases: () => ipcRenderer.invoke('updates:releases'),
  setAutoDownload: (enabled) => ipcRenderer.invoke('updates:auto-download', enabled),
  onStatus: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('updates:status', listener);
    return () => ipcRenderer.removeListener('updates:status', listener);
  },
  notifications: {
    status: () => ipcRenderer.invoke('notifications:status'),
    setEnabled: (enabled) => ipcRenderer.invoke('notifications:enabled', enabled),
    show: (options) =>
      ipcRenderer.invoke('notifications:show', {
        chatId: options?.chatId,
        title: options?.title,
        body: options?.body,
      }),
    clear: () => ipcRenderer.invoke('notifications:clear'),
    onOpen: (callback) => {
      let active = true;
      const listener = (_event, chatId) => callback(chatId);
      ipcRenderer.on('notifications:open', listener);
      void ipcRenderer
        .invoke('notifications:pending')
        .then((chatId) => {
          if (active && chatId) callback(chatId);
        })
        .catch(() => {});
      return () => {
        active = false;
        ipcRenderer.removeListener('notifications:open', listener);
      };
    },
  },
});
