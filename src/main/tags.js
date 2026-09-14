const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const FILE = path.join(app.getPath('userData'), 'tags.json');

function load(){
  if (!fs.existsSync(FILE)) return { points: [], liveOrder: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return {
      points: raw.points || [],
      liveOrder: raw.liveOrder || []
    };
  } catch (e) { return { points: [], liveOrder: [] }; }
}

// 合并保存：传入 {points} 或 {liveOrder} 或两者，缺失的用现有值
function save(data){
  const cur = load();
  const out = {
    points:    Array.isArray(data && data.points)    ? data.points    : cur.points,
    liveOrder: Array.isArray(data && data.liveOrder) ? data.liveOrder : cur.liveOrder
  };
  fs.writeFileSync(FILE, JSON.stringify(out, null, 2), 'utf8');
  return true;
}

function importText(text){
  const cur = load();
  const exist = {};
  cur.points.forEach(p => { exist[p.tag.toLowerCase()] = true; });

  const lines = String(text || '').split(/\r?\n/);
  let added = 0, skipped = 0;
  for (const line of lines){
    const s = line.trim();
    if (!s) continue;
    const parts = s.split(/[,，\t]/).map(x => x.trim());
    const tag = parts[0];
    if (!tag) continue;
    if (exist[tag.toLowerCase()]) { skipped++; continue; }
    exist[tag.toLowerCase()] = true;
    cur.points.push({
      tag,
      desc: parts[1] || '',
      unit: parts[2] || '',
      hh: null, h: null, l: null, ll: null,
      duration: 0, cooldown: 10, enabled: true
    });
    added++;
  }
  save(cur);
  return { added, skipped, total: cur.points.length };
}

function addOne({ tag, desc, unit }){
  const t = String(tag || '').trim();
  if (!t) return { ok: false, error: '位号不能为空' };
  const cur = load();
  if (cur.points.some(p => p.tag.toLowerCase() === t.toLowerCase()))
    return { ok: false, error: '位号已存在' };
  cur.points.push({
    tag: t,
    desc: String(desc || '').trim(),
    unit: String(unit || '').trim(),
    hh: null, h: null, l: null, ll: null,
    duration: 0, cooldown: 10, enabled: true
  });
  save(cur);
  return { ok: true, total: cur.points.length };
}

function removeOne(index){
  const cur = load();
  if (index < 0 || index >= cur.points.length) return { ok: false, error: '索引越界' };
  const removed = cur.points[index];
  cur.points.splice(index, 1);
  // 同时从 liveOrder 移除
  cur.liveOrder = (cur.liveOrder || []).filter(t => t !== removed.tag);
  save(cur);
  return { ok: true, total: cur.points.length };
}

function removeMany(tagList){
  const cur = load();
  const set = {};
  (Array.isArray(tagList) ? tagList : []).forEach(t => { set[String(t)] = true; });
  const before = cur.points.length;
  cur.points = cur.points.filter(p => !set[p.tag]);
  cur.liveOrder = (cur.liveOrder || []).filter(t => !set[t]);
  save(cur);
  return { ok: true, removed: before - cur.points.length, total: cur.points.length };
}

function importRows(rows){
  const cur = load();
  const exist = {};
  cur.points.forEach(p => { exist[p.tag.toLowerCase()] = true; });

  let added = 0, skipped = 0;
  for (const row of rows){
    if (!row) continue;
    const tag = String(row[0] == null ? '' : row[0]).trim();
    if (!tag) continue;
    if (/^(位号|tag|tagname)$/i.test(tag)) continue;
    if (exist[tag.toLowerCase()]) { skipped++; continue; }
    exist[tag.toLowerCase()] = true;
    cur.points.push({
      tag,
      desc: String(row[1] == null ? '' : row[1]).trim(),
      unit: String(row[2] == null ? '' : row[2]).trim(),
      hh: null, h: null, l: null, ll: null,
      duration: 0, cooldown: 10, enabled: true
    });
    added++;
  }
  save(cur);
  return { added, skipped, total: cur.points.length };
}

function saveLiveOrder(order){
  const cur = load();
  cur.liveOrder = Array.isArray(order) ? order : [];
  save(cur);
  return { ok: true };
}

module.exports = { load, save, importText, addOne, removeOne, removeMany, importRows, saveLiveOrder };