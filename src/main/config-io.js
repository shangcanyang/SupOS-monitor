const { dialog, app } = require('electron');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const tags = require('./tags');
const logger = require('./logger');

// 导出配置（不含密码/授权码）
async function exportConfig(){
  const cfg = config.load();
  const tagData = tags.load();

  const out = {
    _app: 'SupOS-monitor',
    _ver: (() => { try { return app.getVersion(); } catch (e) { return '0.0.0'; } })(),
    _exported: new Date().toISOString(),
    server: cfg.server,
    // 注意：username 保留，password 不导出
    username: cfg.username,
    mail: {
      enabled: cfg.mail.enabled,
      from: cfg.mail.from,
      to: cfg.mail.to
      // pass 不导出
    },
    devices: cfg.devices,
    canvasRules: cfg.canvasRules,
    points: tagData.points
  };

  const r = await dialog.showSaveDialog({
    title: '导出配置（不含密码）',
    defaultPath: path.join(app.getPath('documents'), 'supos-monitor-config.json'),
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (r.canceled || !r.filePath) return { ok: false, error: '已取消' };

  try {
    fs.writeFileSync(r.filePath, JSON.stringify(out, null, 2), 'utf8');
    logger.log('配置已导出 → ' + r.filePath);
    return { ok: true, path: r.filePath };
  } catch (e) {
    logger.log('配置导出失败：' + e.message, 'ERROR');
    return { ok: false, error: e.message };
  }
}

// 导入配置（保留已有密码）
async function importConfig(){
  const r = await dialog.showOpenDialog({
    title: '导入配置',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (r.canceled || !r.filePaths.length) return { ok: false, error: '已取消' };

  let incoming;
  try {
    incoming = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
  } catch (e) {
    return { ok: false, error: '文件解析失败：' + e.message };
  }
  if (incoming._app !== 'SupOS-monitor') {
    return { ok: false, error: '不是 SupOS-monitor 的配置文件' };
  }

  const cur = config.load();

  // 合并：密码保留当前值；其余覆盖
  cur.server = incoming.server || cur.server;
  cur.username = incoming.username || cur.username;
  // cur.password 保留不动
  if (incoming.mail){
    cur.mail.enabled = !!incoming.mail.enabled;
    cur.mail.from = incoming.mail.from || '';
    cur.mail.to = incoming.mail.to || '';
    // cur.mail.pass 保留不动
  }
  cur.devices = Array.isArray(incoming.devices) ? incoming.devices : [];
  cur.canvasRules = Array.isArray(incoming.canvasRules) ? incoming.canvasRules : [];
  config.save(cur);

  // 位号清单
  if (Array.isArray(incoming.points)){
    tags.save({ points: incoming.points });
  }

  logger.log('配置已导入：' + r.filePaths[0] +
             '（位号 ' + (incoming.points ? incoming.points.length : 0) +
             '，装置 ' + cur.devices.length +
             '，画布 ' + cur.canvasRules.length + '）');
  return {
    ok: true,
    points: incoming.points ? incoming.points.length : 0,
    devices: cur.devices.length,
    canvas: cur.canvasRules.length,
    needRelogin: true
  };
}

module.exports = { exportConfig, importConfig };