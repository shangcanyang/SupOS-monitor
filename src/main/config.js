const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const DIR = app.getPath('userData');
const CFG_FILE = path.join(DIR, 'config.json');

function enc(t){
  if (!t) return '';
  if (!safeStorage.isEncryptionAvailable()) return '';
  return safeStorage.encryptString(String(t)).toString('base64');
}
function dec(b){
  if (!b) return '';
  try { return safeStorage.decryptString(Buffer.from(b, 'base64')); } catch (e) { return ''; }
}

const DEF = {
  server: 'http://119.36.147.45:8041',
  username: '',
  password: '',
  autoStart: false,
  mail: {
    enabled: false,
    from: '',
    pass: '',
    to: '',
    imapEnabled: false,   // 邮件指令（IMAP 监听）
    alertMuted: false,    // 被邮件指令静音
    mutedAt: 0,
    mutedBy: ''
  },
  devices: [],
  canvasRules: [],
  devicePause: {}
};

// ---- 进程内缓存 ----
// 规则引擎每秒 tick 会对每个位号调用一次 getDeviceOf()，每次都 load() 一遍配置；
// 渲染端也会频繁拉配置。原实现每次同步读盘 + safeStorage 解密 + JSON.parse，
// 是主进程 CPU 占用的最大来源。这里加 2 秒 TTL 缓存，save() 后立即失效保证写后读一致。
let _cache = null;
let _cacheAt = 0;
const CACHE_MS = 2000;

function load(force){
  const nowMs = Date.now();
  if (!force && _cache && (nowMs - _cacheAt) < CACHE_MS){
    return JSON.parse(JSON.stringify(_cache));
  }
  const obj = readCfg();
  _cache = obj;
  _cacheAt = nowMs;
  return JSON.parse(JSON.stringify(obj));
}

function readCfg(){
  if (!fs.existsSync(CFG_FILE)) return JSON.parse(JSON.stringify(DEF));
  try {
    const raw = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
    const m = raw.mail || {};
    return {
      server: raw.server || DEF.server,
      username: raw.username || '',
      password: dec(raw.password),
      autoStart: !!raw.autoStart,
      mail: {
        enabled: !!m.enabled,
        from: m.from || '',
        pass: dec(m.pass),
        to: m.to || '',
        imapEnabled: !!m.imapEnabled,
        alertMuted: !!m.alertMuted,
        mutedAt: Number(m.mutedAt) || 0,
        mutedBy: m.mutedBy || ''
      },
      devices: Array.isArray(raw.devices) ? raw.devices : [],
      canvasRules: Array.isArray(raw.canvasRules) ? raw.canvasRules : [],
      devicePause: (raw.devicePause && typeof raw.devicePause === 'object') ? raw.devicePause : {}
    };
  } catch (e) {
    return JSON.parse(JSON.stringify(DEF));
  }
}

function save(cfg){
  const m = cfg.mail || {};
  const out = {
    server: String(cfg.server || '').trim(),
    username: String(cfg.username || '').trim(),
    password: enc(cfg.password || ''),
    autoStart: !!cfg.autoStart,
    mail: {
      enabled: !!m.enabled,
      from: m.from || '',
      pass: enc(m.pass),
      to: m.to || '',
      imapEnabled: !!m.imapEnabled,
      alertMuted: !!m.alertMuted,
      mutedAt: Number(m.mutedAt) || 0,
      mutedBy: m.mutedBy || ''
    },
    devices: Array.isArray(cfg.devices) ? cfg.devices : [],
    canvasRules: Array.isArray(cfg.canvasRules) ? cfg.canvasRules : [],
    devicePause: (cfg.devicePause && typeof cfg.devicePause === 'object') ? cfg.devicePause : {},
    _ver: (() => { try { return app.getVersion(); } catch (e) { return '0.0.0'; } })(),
    _ts: new Date().toISOString()
  };
  fs.writeFileSync(CFG_FILE, JSON.stringify(out, null, 2), 'utf8');
  _cache = null;
  _cacheAt = 0;
  return true;
}

function getDir(){ return DIR; }

module.exports = { load, save, getDir };