const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig:  ()    => ipcRenderer.invoke('cfg:get'),
  saveConfig: (cfg) => ipcRenderer.invoke('cfg:save', cfg),
  getDataDir: ()    => ipcRenderer.invoke('cfg:dir'),

  login:      ()    => ipcRenderer.invoke('auth:login'),

  loadTags:   ()    => ipcRenderer.invoke('tags:load'),
  importTags: (t)   => ipcRenderer.invoke('tags:import', t),
  saveRules:  (p)   => ipcRenderer.invoke('rules:save', p),
  addTag:     (o)   => ipcRenderer.invoke('tags:add', o),
  removeTag:  (i)   => ipcRenderer.invoke('tags:remove', i),
  importExcel:()    => ipcRenderer.invoke('tags:importExcel'),
  fetchMeta:  ()    => ipcRenderer.invoke('meta:fetch'),
  testRule:   (o)   => ipcRenderer.invoke('rule:test', o),

  saveMail:   (m)   => ipcRenderer.invoke('mail:save', m),
  testMail:   ()    => ipcRenderer.invoke('mail:test'),

  saveDevices:(d)   => ipcRenderer.invoke('devices:save', d),

  setAutoStart:(on) => ipcRenderer.invoke('autostart:set', on),
  getAutoStart:()   => ipcRenderer.invoke('autostart:get'),
  pause:      (m)   => ipcRenderer.invoke('monitor:pause', m),
  resume:     ()    => ipcRenderer.invoke('monitor:resume'),
  isPaused:   ()    => ipcRenderer.invoke('monitor:isPaused'),

  readLog:    ()    => ipcRenderer.invoke('log:read'),
  clearLog:   ()    => ipcRenderer.invoke('log:clear'),

  snapshot:   ()    => ipcRenderer.invoke('live:snapshot'),

  canvasLoad: ()    => ipcRenderer.invoke('canvas:load'),
  canvasSave: (r)   => ipcRenderer.invoke('canvas:save', r),

  // ---- 三期 ----
  exportConfig: ()  => ipcRenderer.invoke('config:export'),
  importConfig: ()  => ipcRenderer.invoke('config:import'),
  checkUpdate:  ()  => ipcRenderer.invoke('update:check'),

  onConnState:     cb => ipcRenderer.on('conn:state',      (_e, d) => cb(d)),
  onUpdateStatus:  cb => ipcRenderer.on('update:status',   (_e, d) => cb(d)),
  onConfigReloaded:cb => ipcRenderer.on('config:reloaded', (_e, d) => cb(d))
});