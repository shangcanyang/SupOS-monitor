const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const DIR = app.getPath('userData');            // %APPDATA%\SupOS-monitor
const CFG_FILE = path.join(DIR, 'config.json');

function encrypt(text) {
  if (!text) return '';
  if (!safeStorage.isEncryptionAvailable()) return '';   // DPAPI 不可用时置空
  return safeStorage.encryptString(text).toString('base64');
}

function decrypt(b64) {
  if (!b64) return '';
  try {
    return safeStorage.decryptString(Buffer.from(b64, 'base64'));
  } catch (e) {
    return '';   // 换用户/换机器后解不开，返回空
  }
}

// 返回给渲染进程的配置（密码字段解密后返回，方便回填）
function load() {
  const def = { server: 'http://119.36.147.45:8041', username: '', password: '' };
  if (!fs.existsSync(CFG_FILE)) return def;
  try {
    const raw = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
    return {
      server:   raw.server   || def.server,
      username: raw.username || '',
      password: decrypt(raw.password)
    };
  } catch (e) {
    return def;
  }
}

// 保存：密码加密后落盘
function save(cfg) {
  const out = {
    server:   String(cfg.server || '').trim(),
    username: String(cfg.username || '').trim(),
    password: encrypt(cfg.password || ''),
    _ver: '1.0.0',
    _ts: new Date().toISOString()
  };
  fs.writeFileSync(CFG_FILE, JSON.stringify(out, null, 2), 'utf8');
  return true;
}

function getDir() { return DIR; }

module.exports = { load, save, getDir };