const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig:   ()    => ipcRenderer.invoke('cfg:get'),
  saveConfig:  (cfg) => ipcRenderer.invoke('cfg:save', cfg),
  getDataDir:  ()    => ipcRenderer.invoke('cfg:dir')
});