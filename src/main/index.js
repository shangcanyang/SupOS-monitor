const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const config = require('./config');

let mainWin = null;

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1080,
    height: 760,
    title: 'SupOS-monitor',
    webPreferences: {
      preload: path.join(__dirname, '../preload/main.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWin.loadFile(path.join(__dirname, '../renderer/main/index.html'));
}

// ---- IPC：配置读写 ----
ipcMain.handle('cfg:get',  ()    => config.load());
ipcMain.handle('cfg:save', (_e, cfg) => config.save(cfg));
ipcMain.handle('cfg:dir',  ()    => config.getDir());

app.whenReady().then(() => {
  createWindow();
  console.log('配置目录：' + config.getDir());
});

app.on('window-all-closed', () => app.quit());