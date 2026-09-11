const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const XLSX = require('xlsx');

const config = require('./config');
const auth = require('./auth');
const tags = require('./tags');
const vars = require('./vars');
const logger = require('./logger');
const WSClient = require('./ws-client');
const RulesEngine = require('./rules-engine');
const mailer = require('./mailer');
const mailWatcher = require('./mail-watcher');
const alertWindow = require('./alert-window');
const tray = require('./tray');
const configIO = require('./config-io');
const updater = require('./updater');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

let mainWin = null;
let wsClient = null;
let engine = null;
let mailBufferTimer = null;
let refreshTimer = null;
let trimTimer = null;
let quitting = false;

function createMainWindow(){
  mainWin = new BrowserWindow({
    width: 1180, height: 800,
    title: 'SupOS-monitor',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/main.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWin.loadFile(path.join(__dirname, '../renderer/main/index.html'));
  mainWin.once('ready-to-show', () => {
    mainWin.show();
    mainWin.focus();
    mainWin.moveTop();
  });
  mainWin.on('close', e => {
    if (!quitting) { e.preventDefault(); mainWin.hide(); }
  });
}

function sendToMain(channel, data){
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send(channel, data);
  }
}

async function startAll(){
  if (wsClient) { wsClient.close(); wsClient = null; }
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  auth.clear();

  const cfg = config.load();
  if (!cfg.username || !cfg.password) {
    sendToMain('conn:state', { state: 'off', text: '未配置账号' });
    return;
  }

  sendToMain('conn:state', { state: 'wait', text: '登录中…' });
  const r = await auth.login(cfg);
  if (!r.ok) {
    sendToMain('conn:state', { state: 'off', text: '登录失败' });
    return;
  }
  sendToMain('conn:state', { state: 'wait', text: '已登录，正在连接…' });

  refreshTimer = setInterval(async () => {
    const ok = await auth.refresh();
    if (!ok) startAll();
  }, 30 * 60 * 1000);

  const tagList = tags.load().points.map(p => p.tag).filter(Boolean);
  wsClient = new WSClient({
    server: cfg.server,
    onData: d => engine.onPoint(d),
    onState: st => {
      if (st === 'online') sendToMain('conn:state', { state: 'on', text: '已连接 · WebSocket 实时订阅中' });
      else if (st === 'connecting') sendToMain('conn:state', { state: 'wait', text: '连接中…' });
      else sendToMain('conn:state', { state: 'off', text: '连接断开，3 秒后重连' });
    }
  });
  wsClient.connect(tagList);
}

function onAlarm(){
  const items = engine.collectActive();
  if (!items.length) return;
  alertWindow.show(items);

  const cfg = config.load();
  if (!cfg.mail.enabled) return;
  if (cfg.mail.alertMuted) return;
  if (mailBufferTimer) clearTimeout(mailBufferTimer);
  mailBufferTimer = setTimeout(async () => {
    const its = engine.collectActive();
    if (!its.length) return;
    const freshCfg = config.load();
    if (!freshCfg.mail.enabled || freshCfg.mail.alertMuted) return;
    const subject = '【SupOS-monitor 报警】' + its.length + ' 项测点超限 - ' + logger.fmtDT(new Date());
    const body = mailer.buildAlarmBody(its);
    await mailer.send(freshCfg.mail, subject, body.text, body.html);
  }, 1500);
}

// ============================================================
// IPC
// ============================================================
ipcMain.handle('cfg:get',  () => config.load());
ipcMain.handle('cfg:save', (_e, cfg) => config.save(cfg));
ipcMain.handle('cfg:dir',  () => config.getDir());

ipcMain.handle('auth:login', async () => {
  const cfg = config.load();
  if (!cfg.username || !cfg.password) return { ok: false, error: '未配置账号' };
  sendToMain('conn:state', { state: 'wait', text: '登录中…' });
  const r = await auth.login(cfg);
  if (r.ok) {
    sendToMain('conn:state', { state: 'on', text: '已登录 · ticket 有效期 ' + r.expire + ' 秒' });
  } else {
    sendToMain('conn:state', { state: 'off', text: '登录失败' });
  }
  return r;
});

ipcMain.handle('tags:load',   ()      => tags.load());
ipcMain.handle('tags:import', (_e,t)  => tags.importText(t));
ipcMain.handle('tags:save',   (_e,d)  => tags.save(d));
ipcMain.handle('tags:add',    (_e,o)  => tags.addOne(o));
ipcMain.handle('tags:remove', (_e,i)  => tags.removeOne(i));
ipcMain.handle('tags:saveLiveOrder', (_e, order) => tags.saveLiveOrder(order));

// ---- 环境变量 ----
ipcMain.handle('vars:load',   ()       => vars.load());
ipcMain.handle('vars:saveAll',(_e,list)=> vars.saveAll(list));
ipcMain.handle('vars:add',    (_e,o)   => vars.addOne(o));
ipcMain.handle('vars:remove', (_e,id)  => vars.removeOne(id));
ipcMain.handle('vars:runtime',()       => ({ ok: true, vars: engine ? engine.canvasVars : {} }));

ipcMain.handle('tags:importExcel', async () => {
  const r = await dialog.showOpenDialog(mainWin, {
    title: '选择 Excel 文件',
    filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
    properties: ['openFile']
  });
  if (r.canceled || !r.filePaths.length) return { ok: false, error: '已取消' };
  try {
    const wb = XLSX.readFile(r.filePaths[0]);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const res = tags.importRows(rows);
    return { ok: true, added: res.added, skipped: res.skipped, total: res.total };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('rules:save', (_e, points) => {
  const cur = tags.load();
  cur.points = points;
  tags.save(cur);
  if (wsClient) {
    const list = points.map(p => p.tag).filter(Boolean);
    if (list.length && wsClient.ws && wsClient.ws.readyState === 1) {
      wsClient.tags = list;
      wsClient.subscribe();
    }
  }
  logger.log('规则已保存，共 ' + points.length + ' 个位号');
  return { ok: true };
});

ipcMain.handle('rule:test', (_e, { tag, value }) => {
  const cur = tags.load();
  const p = cur.points.find(x => x.tag === tag);
  if (!p) return { ok: false, error: '位号不存在：' + tag };
  const v = Number(value);
  if (isNaN(v)) return { ok: false, error: '值不是数字' };
  const t = engine.effectiveThresholds(p);
  const level = engine.levelOf(p, v);
  const rt = engine.rt[p.tag] || {};
  return {
    ok: true,
    level: level || null,
    thresholds: { hh: t.hh, h: t.h, l: t.l, ll: t.ll, temp: t.temp },
    duration: p.duration || 0,
    cooldown: p.cooldown || 10,
    inAlarm: !!rt.inAlarm,
    cooldownUntil: rt.cooldownUntil || 0
  };
});

ipcMain.handle('live:snapshot', () => engine.snapshot());

ipcMain.handle('mail:save', (_e, mail) => {
  const cfg = config.load();
  cfg.mail = Object.assign({}, cfg.mail, mail);
  if (mail.alertMuted === undefined) cfg.mail.alertMuted = cfg.mail.alertMuted || false;
  config.save(cfg);
  if (cfg.mail.imapEnabled && cfg.mail.enabled) mailWatcher.start();
  else mailWatcher.stop();
  return { ok: true };
});

ipcMain.handle('mail:test', async () => {
  const cfg = config.load();
  const items = engine.collectActive();
  const demo = items.length ? items : [{
    tag: 'TEST_TAG', desc: '测试点位', unit: '', value: 123.4,
    level: 'HH', time: Date.now(), device: '测试装置',
    thresholds: { hh: 100, h: 90, l: 10, ll: 0 }
  }];
  const subject = '【SupOS-monitor 测试】邮件通道测试 - ' + logger.fmtDT(new Date());
  const body = mailer.buildAlarmBody(demo);
  return await mailer.send(cfg.mail, subject, body.text, body.html);
});

ipcMain.handle('mail:muteStatus', () => {
  const cfg = config.load();
  return {
    ok: true,
    imapEnabled: !!cfg.mail.imapEnabled,
    running: mailWatcher.isRunning(),
    busy: mailWatcher.isBusy(),
    alertMuted: !!cfg.mail.alertMuted,
    mutedAt: cfg.mail.mutedAt || 0,
    mutedBy: cfg.mail.mutedBy || ''
  };
});
ipcMain.handle('mail:unmute', () => {
  const cfg = config.load();
  cfg.mail.alertMuted = false;
  cfg.mail.mutedAt = 0;
  cfg.mail.mutedBy = '';
  config.save(cfg);
  logger.log('【手动】恢复邮件报警');
  return { ok: true };
});
ipcMain.handle('mail:checkNow', async () => {
  const start = Date.now();
  while (mailWatcher.isBusy() && Date.now() - start < 90000){
    await new Promise(r => setTimeout(r, 300));
  }
  const r = await mailWatcher.checkOnce();
  return r || { ok: true };
});

ipcMain.handle('devices:save', (_e, devices) => {
  const cfg = config.load();
  cfg.devices = devices;
  config.save(cfg);
  return { ok: true };
});

ipcMain.handle('device:pause', (_e, { device, minutes }) => {
  const cfg = config.load();
  if (!cfg.devicePause) cfg.devicePause = {};
  cfg.devicePause[device] = minutes ? Date.now() + minutes * 60000 : 0;
  config.save(cfg);
  return { ok: true };
});
ipcMain.handle('device:resume', (_e, device) => {
  const cfg = config.load();
  if (cfg.devicePause && cfg.devicePause[device] !== undefined){
    delete cfg.devicePause[device];
    config.save(cfg);
  }
  return { ok: true };
});
ipcMain.handle('device:pauseList', () => {
  const cfg = config.load();
  return { ok: true, list: cfg.devicePause || {} };
});

ipcMain.handle('autostart:set', (_e, on) => {
  app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath });
  const cfg = config.load();
  cfg.autoStart = !!on;
  config.save(cfg);
  return { ok: true };
});
ipcMain.handle('autostart:get', () => app.getLoginItemSettings().openAtLogin);

ipcMain.handle('monitor:pause', (_e, minutes) => { engine.pause(minutes); return { paused: true }; });
ipcMain.handle('monitor:resume', () => { engine.resume(); return { paused: false }; });
ipcMain.handle('monitor:isPaused', () => engine.isPaused());

ipcMain.handle('log:read', () => logger.read());
ipcMain.handle('log:clear', () => { logger.clear(); return { ok: true }; });

ipcMain.handle('meta:fetch', async () => {
  const cfg = config.load();
  const tk = auth.getTicket();
  if (!tk) return { ok: false, error: '未登录' };
  const list = tags.load().points.map(p => 'system:LinkObject:serverdata1:system:' + p.tag);
  if (!list.length) return { ok: false, error: '无位号' };
  const base = cfg.server.replace(/\/+$/, '');
  try {
    const r = await fetch(base + '/api/compose/manage/v3/objectselector/objectdata/propertyBatchQuery', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'Authorization': 'Bearer ' + tk,
        'Cookie': 'suposTicket=' + tk + '; suposTicketForFrontend=' + tk
      },
      body: JSON.stringify({ list })
    });
    const data = await r.json();
    const cur = tags.load();
    let filled = 0;
    cur.points.forEach(p => {
      const info = data['system:LinkObject:serverdata1:system:' + p.tag];
      if (!info) return;
      if (!p.desc && (info.name || info.description || info.displayName)) {
        p.desc = info.name || info.description || info.displayName;
        filled++;
      }
      if (!p.unit && (info.unit || info.uom)) {
        p.unit = info.unit || info.uom;
        filled++;
      }
    });
    tags.save(cur);
    return { ok: true, filled };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('canvas:load', () => {
  const cfg = config.load();
  return { ok: true, rules: cfg.canvasRules || [] };
});
ipcMain.handle('canvas:save', (_e, rules) => {
  const cfg = config.load();
  cfg.canvasRules = Array.isArray(rules) ? rules : [];
  config.save(cfg);
  logger.log('画布规则已保存（' + cfg.canvasRules.length + ' 个）');
  return { ok: true };
});

ipcMain.handle('config:export', () => configIO.exportConfig());
ipcMain.handle('config:import', async () => {
  const r = await configIO.importConfig();
  if (r.ok) sendToMain('config:reloaded', {});
  return r;
});

ipcMain.handle('update:check', async () => {
  updater.checkManual((txt) => sendToMain('update:status', { text: txt }));
  return { ok: true };
});

ipcMain.handle('alert:close', () => { alertWindow.close(); return { ok: true }; });
ipcMain.handle('alert:setOverride', (_e, tag, values) => {
  engine.setOverride(tag, values, 2);
  const items = engine.collectActive();
  alertWindow.update(items);
  return { ok: true };
});
ipcMain.handle('alert:detail', () => engine.collectActive());

const startHidden = process.argv.includes('--hidden');

app.on('second-instance', () => {
  if (mainWin) { mainWin.show(); mainWin.focus(); }
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  logger.log('======== SupOS-monitor v1.0.0 启动 ========');
  logger.log('配置目录：' + config.getDir());

  engine = new RulesEngine({
    getPoints:  () => tags.load().points,
    getDevices: () => config.load().devices,
    getCanvasRules: () => config.load().canvasRules,
    getDevicePause: () => config.load().devicePause || {},
    onAlarm
  });
  engine.start();

  createMainWindow();
  if (startHidden && mainWin) mainWin.hide();

  tray.create({
    onShow:    () => { if (mainWin) { mainWin.show(); mainWin.focus(); } },
    onPause30: () => engine.pause(30),
    onPause60: () => engine.pause(60),
    onResume:  () => engine.resume(),
    onQuit:    () => { quitting = true; app.quit(); }
  });

  trimTimer = setInterval(() => logger.trim(), 30 * 60 * 1000);

  const cfg = config.load();
  if (cfg.mail.enabled && cfg.mail.imapEnabled && cfg.mail.from && cfg.mail.pass){
    mailWatcher.start();
  }

  updater.init({ onStatus: txt => sendToMain('update:status', { text: txt }) });
  updater.autoCheckLater();

  startAll();
});

app.on('window-all-closed', () => {});

app.on('before-quit', () => {
  quitting = true;
  if (wsClient) wsClient.close();
  if (engine) engine.stop();
  if (refreshTimer) clearInterval(refreshTimer);
  if (trimTimer) clearInterval(trimTimer);
  try { mailWatcher.stop(); } catch(_) {}
  tray.destroy();
  logger.trim();
});