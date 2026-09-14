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
  removeTags: (arr) => ipcRenderer.invoke('tags:removeMany', arr),
  importExcel:()    => ipcRenderer.invoke('tags:importExcel'),
  fetchMeta:  ()    => ipcRenderer.invoke('meta:fetch'),
  testRule:   (o)   => ipcRenderer.invoke('rule:test', o),
  testCanvas: (o)   => ipcRenderer.invoke('rule:testCanvas', o),
  saveLiveOrder: (order) => ipcRenderer.invoke('tags:saveLiveOrder', order),

  // 环境变量
  loadVars:    ()        => ipcRenderer.invoke('vars:load'),
  saveVars:    (list)    => ipcRenderer.invoke('vars:saveAll', list),
  addVar:      (o)       => ipcRenderer.invoke('vars:add', o),
  removeVar:   (id)      => ipcRenderer.invoke('vars:remove', id),
  varsRuntime: ()        => ipcRenderer.invoke('vars:runtime'),

  saveMail:   (m)   => ipcRenderer.invoke('mail:save', m),
  testMail:   ()    => ipcRenderer.invoke('mail:test'),
  muteStatus: ()    => ipcRenderer.invoke('mail:muteStatus'),
  unmuteMail: ()    => ipcRenderer.invoke('mail:unmute'),
  checkMailNow: ()  => ipcRenderer.invoke('mail:checkNow'),

  saveDevices:(d)   => ipcRenderer.invoke('devices:save', d),

  pauseDevice:   (device, minutes) => ipcRenderer.invoke('device:pause', { device, minutes }),
  resumeDevice:  (device)          => ipcRenderer.invoke('device:resume', device),
  pauseList:     ()                => ipcRenderer.invoke('device:pauseList'),

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

  exportConfig: ()  => ipcRenderer.invoke('config:export'),
  importConfig: ()  => ipcRenderer.invoke('config:import'),
  checkUpdate:  ()  => ipcRenderer.invoke('update:check'),

  onConnState:     cb => ipcRenderer.on('conn:state',      (_e, d) => cb(d)),
  getConnState:    () => ipcRenderer.invoke('conn:get'),
  onUpdateStatus:  cb => ipcRenderer.on('update:status',   (_e, d) => cb(d)),
  onConfigReloaded:cb => ipcRenderer.on('config:reloaded', (_e, d) => cb(d))
});