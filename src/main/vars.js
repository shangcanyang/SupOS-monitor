const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const FILE = path.join(app.getPath('userData'), 'vars.json');

// ---- 读盘缓存 ----
// 规则引擎每秒 tick 都会取一次变量定义；原实现每次同步读盘 + JSON.parse，
// 属主进程常态 CPU/IO 开销。这里按文件 mtime 做进程内缓存，写盘后立即更新。
let _cache = null;
let _mtime = 0;

function clone(d){
  return { vars: (d.vars || []).map(v => Object.assign({}, v)) };
}

function readFile(){
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { vars: raw.vars || [] };
  } catch (e) { return { vars: [] }; }
}

function load(){
  let st = null;
  try { st = fs.statSync(FILE); }
  catch (e) { _cache = null; _mtime = 0; return { vars: [] }; }
  if (_cache && st.mtimeMs === _mtime) return clone(_cache);
  const out = readFile();
  _cache = out;
  _mtime = st.mtimeMs;
  return clone(out);
}

function save(data){
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
  _cache = { vars: (data && data.vars) || [] };
  try { _mtime = fs.statSync(FILE).mtimeMs; } catch (e) { _mtime = 0; }
  return true;
}

function saveAll(vars){
  const cur = { vars: Array.isArray(vars) ? vars : [] };
  // 简单校验：名字合法、不重名
  const seen = {};
  for (const v of cur.vars){
    const n = String(v.name || '').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)){
      return { ok: false, error: '变量名不合法：' + n };
    }
    if (seen[n]) return { ok: false, error: '变量名重复：' + n };
    seen[n] = true;
    v.name = n;
    if (v.type !== 'string') v.type = 'number';
    if (!v.id) v.id = 'v_' + Date.now() + Math.random().toString(36).slice(2, 5);
  }
  save(cur);
  return { ok: true, total: cur.vars.length };
}

function addOne({ name, type, init, desc }){
  const n = String(name || '').trim();
  if (!n) return { ok: false, error: '变量名不能为空' };
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)){
    return { ok: false, error: '变量名只能含字母/数字/下划线，且不能以数字开头' };
  }
  const cur = load();
  if (cur.vars.some(v => v.name === n)) return { ok: false, error: '变量名已存在' };
  cur.vars.push({
    id: 'v_' + Date.now() + Math.random().toString(36).slice(2, 5),
    name: n,
    type: type === 'string' ? 'string' : 'number',
    init: init == null ? (type === 'string' ? '' : 0) : init,
    desc: String(desc || '').trim()
  });
  save(cur);
  return { ok: true, total: cur.vars.length };
}

function removeOne(id){
  const cur = load();
  const idx = cur.vars.findIndex(v => v.id === id);
  if (idx === -1) return { ok: false, error: '变量不存在' };
  cur.vars.splice(idx, 1);
  save(cur);
  return { ok: true, total: cur.vars.length };
}

module.exports = { load, save, saveAll, addOne, removeOne };