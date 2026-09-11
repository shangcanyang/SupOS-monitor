const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(app.getPath('userData'), 'runtime.log');
const KEEP_MS = 8 * 3600 * 1000;

function pad2(n){ return n < 10 ? '0' + n : '' + n; }
function fmtDT(d){
  return d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate()) + ' ' +
         pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

function log(msg, level = 'INFO'){
  const line = fmtDT(new Date()) + ' [' + level + '] ' + msg + '\r\n';
  try { fs.appendFileSync(LOG_FILE, line, 'utf8'); } catch (e) {}
  console.log('[' + level + ']', msg);
}

function trim(){
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    if (fs.statSync(LOG_FILE).size < 512 * 1024) return;
    const cut = Date.now() - KEEP_MS;
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split(/\r?\n/);
    const kept = lines.filter(l => {
      const m = l.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
      if (!m) return false;
      const t = new Date(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6]).getTime();
      return t >= cut;
    });
    fs.writeFileSync(LOG_FILE, kept.join('\r\n') + '\r\n', 'utf8');
  } catch (e) {}
}

function read(){
  try { return fs.readFileSync(LOG_FILE, 'utf8'); } catch (e) { return ''; }
}

function clear(){
  try { fs.writeFileSync(LOG_FILE, '', 'utf8'); } catch (e) {}
}

module.exports = { log, trim, read, clear, LOG_FILE, fmtDT };