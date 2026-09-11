const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

let tray = null;

function create({ onShow, onPause30, onPause60, onResume, onQuit }){
  const icoPath = path.join(__dirname, '../../build/icon.ico');
  let icon;
  if (fs.existsSync(icoPath)) {
    icon = nativeImage.createFromPath(icoPath);
  } else {
    icon = nativeImage.createEmpty();
  }

  try {
    tray = new Tray(icon);
  } catch (e) {
    logger.log('托盘创建失败：' + e.message, 'WARN');
    return null;
  }

  tray.setToolTip('SupOS-monitor');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: onShow },
    { type: 'separator' },
    { label: '暂停 30 分钟', click: onPause30 },
    { label: '暂停 1 小时', click: onPause60 },
    { label: '恢复监控', click: onResume },
    { type: 'separator' },
    { label: '退出', click: onQuit }
  ]));
  tray.on('double-click', onShow);
  return tray;
}

function destroy(){
  if (tray) { try { tray.destroy(); } catch (e) {} tray = null; }
}

module.exports = { create, destroy };