const { BrowserWindow } = require('electron');
const path = require('path');
const logger = require('./logger');

let win = null;
let pendingItems = null;
let pendingTimer = null;

function show(items){
  pendingItems = items;
  if (pendingTimer) return;
  pendingTimer = setTimeout(flush, 1500);
}

function flush(){
  pendingTimer = null;
  if (!pendingItems || !pendingItems.length){
    pendingItems = null;
    return;
  }
  const items = pendingItems;
  pendingItems = null;

  if (!win || win.isDestroyed()){
    createAndShow(items);
  } else {
    if (!win.isVisible()) win.show();
    win.focus();
    if (win.webContents && !win.webContents.isLoading()){
      win.webContents.send('alert:render', items);
    } else {
      win.webContents.once('did-finish-load', () => {
        if (win && !win.isDestroyed()) win.webContents.send('alert:render', items);
      });
    }
  }
}

function createAndShow(items){
  win = new BrowserWindow({
    width: 640,
    height: 520,
    frame: false,
    resizable: true,
    skipTaskbar: false,
    alwaysOnTop: true,
    show: false,
    title: 'SupOS-monitor 报警',
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false
    }
  });
  win.setAlwaysOnTop(true, 'screen-saver');

  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape'){
      e.preventDefault();
      close();
    }
  });

  win.webContents.on('did-fail-load', (e, code, desc, url) => {
    logger.log('报警窗口加载失败 [' + code + '] ' + desc + ' URL=' + url, 'ERROR');
    setTimeout(() => {
      if (win && !win.isDestroyed()) win.destroy();
      win = null;
    }, 1500);
  });

  win.webContents.on('render-process-gone', (e, details) => {
    logger.log('报警窗口渲染进程崩溃：' + JSON.stringify(details), 'ERROR');
  });

  win.webContents.on('console-message', (e, level, message, line, sourceId) => {
    if (level >= 2){
      logger.log('报警窗口 ' + (level === 3 ? '[ERROR]' : '[WARN]') + ' ' +
                 message + ' (' + sourceId + ':' + line + ')', 'WARN');
    }
  });

  win.on('closed', () => { win = null; });

  win.loadFile(path.join(__dirname, '../renderer/alert/index.html'));

  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });

  // 页面加载完后推一次（双保险，页面自己也会 invoke 拉一次）
  win.webContents.once('did-finish-load', () => {
    if (win && !win.isDestroyed()){
      win.webContents.send('alert:render', items);
    }
  });
}

function update(items){
  if (win && !win.isDestroyed() && !win.webContents.isLoading()){
    win.webContents.send('alert:render', items);
  }
}

function close(){
  if (win && !win.isDestroyed()) win.close();
}

module.exports = { show, update, close };