const { BrowserWindow } = require('electron');
const path = require('path');

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
    win = new BrowserWindow({
      width: 640, height: 480,
      frame: false,
      resizable: true,
      skipTaskbar: false,
      alwaysOnTop: true,
      title: 'SupOS-monitor 报警',
      webPreferences: {
        preload: path.join(__dirname, '../preload/alert.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.loadFile(path.join(__dirname, '../renderer/alert/index.html'));
    win.on('closed', () => { win = null; });
    win.webContents.on('did-finish-load', () => {
      win.webContents.send('alert:render', items);
    });
  } else {
    win.show();
    win.focus();
    win.webContents.send('alert:render', items);
  }
}

function update(items){
  if (win && !win.isDestroyed()){
    win.webContents.send('alert:render', items);
  }
}

function close(){
  if (win && !win.isDestroyed()) win.close();
}

module.exports = { show, update, close };