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

function load(){
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
    _ver: '1.0.0',
    _ts: new Date().toISOString()
  };
  fs.writeFileSync(CFG_FILE, JSON.stringify(out, null, 2), 'utf8');
  return true;
}

function getDir(){ return DIR; }

module.exports = { load, save, getDir };