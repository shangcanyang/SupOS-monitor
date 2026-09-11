const { app, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

let autoUpdater = null;
let manual = false;   // 是否是用户手动触发

function init({ onStatus }){
  // 开发环境跳过（electron . 直接跑，没有 app-update.yml）
  if (!app.isPackaged) {
    logger.log('开发模式：跳过自动更新初始化');
    return;
  }
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (e) {
    logger.log('electron-updater 加载失败：' + e.message, 'WARN');
    return;
  }

  autoUpdater.autoDownload = false;     // 先问用户
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    if (manual) onStatus('正在检查更新…');
    logger.log('检查更新中…');
  });
  autoUpdater.on('update-available', info => {
    logger.log('发现新版本：' + info.version);
    if (manual) onStatus('发现新版本 ' + info.version + '，正在下载…');
    autoUpdater.downloadUpdate();
  });
  autoUpdater.on('update-not-available', () => {
    logger.log('已是最新版本');
    if (manual) onStatus('已是最新版本');
  });
  autoUpdater.on('error', err => {
    logger.log('更新错误：' + err.message, 'ERROR');
    if (manual) onStatus('更新失败：' + err.message);
  });
  autoUpdater.on('download-progress', p => {
    if (manual) onStatus('下载中 ' + p.percent.toFixed(1) + '%');
  });
  autoUpdater.on('update-downloaded', info => {
    logger.log('新版本已下载：' + info.version);
    onStatus('新版本已下载，重启后生效');
    dialog.showMessageBox({
      type: 'info',
      title: '更新就绪',
      message: '新版本 ' + info.version + ' 已下载完成。\n是否立即重启安装？',
      buttons: ['立即重启', '稍后']
    }).then(r => {
      if (r.response === 0){
        setImmediate(() => autoUpdater.quitAndInstall());
      }
    });
  });
}

async function checkManual(onStatus){
  if (!autoUpdater){
    if (!app.isPackaged) {
      await dialog.showMessageBox({
        type: 'info',
        title: '开发模式',
        message: '当前处于开发模式，自动更新只在打包后可用。',
        buttons: ['好']
      });
      return;
    }
    await dialog.showMessageBox({
      type: 'warning',
      title: '不可用',
      message: '自动更新组件未初始化，请查看日志。',
      buttons: ['好']
    });
    return;
  }
  manual = true;
  try {
    onStatus('正在检查更新…');
    await autoUpdater.checkForUpdates();
  } catch (e) {
    logger.log('手动检查更新失败：' + e.message, 'ERROR');
    onStatus('更新失败：' + e.message);
  } finally {
    setTimeout(() => { manual = false; }, 5000);
  }
}

// 启动后延迟 30 秒后台检查一次
function autoCheckLater(){
  if (!autoUpdater) return;
  setTimeout(() => {
    try { autoUpdater.checkForUpdates(); }
    catch (e) { logger.log('后台检查更新失败：' + e.message, 'WARN'); }
  }, 30 * 1000);
}

module.exports = { init, checkManual, autoCheckLater };