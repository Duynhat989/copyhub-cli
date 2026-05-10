const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('copyhub', {
  getMeta: () => ipcRenderer.invoke('overlay:meta'),
  getHistory: () => ipcRenderer.invoke('history:get'),
  copyPick: (text) => ipcRenderer.invoke('history:copy', text),
  onOpen: (fn) => {
    ipcRenderer.on('overlay:open', (_e) => {
      fn();
    });
  },
});
