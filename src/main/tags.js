const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const FILE = path.join(app.getPath('userData'), 'tags.json');

function load(){
  if (!fs.existsSync(FILE)) return { points: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { points: raw.points || [] };
  } catch (e) { return { points: [] }; }
}

function save(data){
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
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
  cur.points.splice(index, 1);
  save(cur);
  return { ok: true, total: cur.points.length };
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

module.exports = { load, save, importText, addOne, removeOne, importRows };