const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('copyhub', {
  getMeta: () => ipcRenderer.invoke('overlay:meta'),
  /** @param {{ page?: number, pageSize?: number, refresh?: boolean }} [opts] */
  getHistory: (opts) => ipcRenderer.invoke('history:get', opts ?? {}),
  /** Local history only — instant; used while Sheet sync runs. */
  getHistoryLocal: (opts) => ipcRenderer.invoke('history:getLocal', opts ?? {}),
  copyPick: (text) => ipcRenderer.invoke('history:copy', text),
  onOpen: (fn) => {
    ipcRenderer.on('overlay:open', (_e) => {
      fn();
    });
  },
});
