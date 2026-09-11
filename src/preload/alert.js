const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('alertApi', {
  onRender:    cb => ipcRenderer.on('alert:render', (_e, d) => cb(d)),
  close:       () => ipcRenderer.invoke('alert:close'),
  setOverride: (tag, values) => ipcRenderer.invoke('alert:setOverride', tag, values),
  detail:      () => ipcRenderer.invoke('alert:detail')
});