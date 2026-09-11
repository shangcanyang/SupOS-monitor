// ============================================================
// 通用工具
// ============================================================
function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtVal(v){
  if (v === null || v === undefined || v === '') return '-';
  const n = Number(v);
  return isNaN(n) ? String(v) : n.toFixed(3);
}
function fmtTime(ts){
  if (!ts) return '-';
  const d = new Date(ts);
  const p = n => n < 10 ? '0' + n : '' + n;
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}
function isEditing(){
  const a = document.activeElement;
  if (!a) return false;
  if (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable) return true;
  return false;
}

// ============================================================
// 通用弹框
// ============================================================
function msgBox(text, title){
  return new Promise(resolve => {
    const ov = document.getElementById('msgModal');
    document.getElementById('msgModalTitle').textContent = title || '提示';
    document.getElementById('msgModalText').textContent = String(text == null ? '' : text);
    ov.style.display = 'flex';
    const btn = document.getElementById('msgModalOk');
    setTimeout(() => btn.focus(), 30);
    const onOk = () => { cleanup(); resolve(); };
    const onKey = (e) => { if (e.key === 'Enter' || e.key === 'Escape') onOk(); };
    const cleanup = () => {
      ov.style.display = 'none';
      btn.removeEventListener('click', onOk);
      document.removeEventListener('keydown', onKey);
    };
    btn.addEventListener('click', onOk);
    document.addEventListener('keydown', onKey);
  });
}

function confirmBox(text, title){
  return new Promise(resolve => {
    const ov = document.getElementById('confirmModal');
    document.getElementById('confirmModalTitle').textContent = title || '确认';
    document.getElementById('confirmModalText').textContent = String(text == null ? '' : text);
    ov.style.display = 'flex';
    const ok = document.getElementById('confirmModalOk');
    const cancel = document.getElementById('confirmModalCancel');
    setTimeout(() => ok.focus(), 30);
    const onOk = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };
    const onKey = (e) => {
      if (e.key === 'Enter') onOk();
      if (e.key === 'Escape') onCancel();
    };
    const cleanup = () => {
      ov.style.display = 'none';
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKey);
    };
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKey);
  });
}

function inputDialog({ title, hint, defaultValue }){
  return new Promise(resolve => {
    const ov = document.getElementById('inputModal');
    document.getElementById('inputModalTitle').textContent = title || '输入';
    document.getElementById('inputModalHint').innerHTML = hint || '';
    const ta = document.getElementById('inputModalText');
    ta.value = defaultValue || '';
    ov.style.display = 'flex';
    setTimeout(() => ta.focus(), 30);

    const cleanup = () => {
      ov.style.display = 'none';
      document.getElementById('inputModalOk').removeEventListener('click', onOk);
      document.getElementById('inputModalCancel').removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKey);
    };
    const onOk = () => { const v = ta.value; cleanup(); resolve(v); };
    const onCancel = () => { cleanup(); resolve(null); };
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onOk();
    };
    document.getElementById('inputModalOk').addEventListener('click', onOk);
    document.getElementById('inputModalCancel').addEventListener('click', onCancel);
    document.addEventListener('keydown', onKey);
  });
}

// ============================================================
// 页签切换
// ============================================================
document.querySelectorAll('#tabs .tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('#tabs .tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const name = tab.getAttribute('data-t');
    document.getElementById('page-' + name).classList.add('active');
    if (name === 'live') renderLive();
    if (name === 'rule') renderRuleTable();
    if (name === 'dev')  renderDevices();
    if (name === 'mail') loadMailToUI();
    if (name === 'set')  refreshLog();
    if (name === 'canvas') canvasLoad();
  });
});

// ============================================================
// 状态栏
// ============================================================
function updateStatusBar(){
  document.getElementById('sbRight').textContent =
    'SupOS-monitor v1.0.0　·　' + new Date().toLocaleTimeString('zh-CN');
}
updateStatusBar();
setInterval(updateStatusBar, 1000);

function setConn(state, text){
  document.getElementById('connDot').className = 'dot ' + state;
  document.getElementById('connTxt').textContent = text;
}

// ============================================================
// 配置 / 登录
// ============================================================
async function loadConfigToUI(){
  const cfg = await window.api.getConfig();
  document.getElementById('setServer').value = cfg.server || '';
  document.getElementById('setUser').value   = cfg.username || '';
  document.getElementById('setPass').value   = cfg.password || '';
  const dir = await window.api.getDataDir();
  document.getElementById('sbLeft').textContent = '配置目录：' + dir;
  const auto = await window.api.getAutoStart();
  document.getElementById('btnAuto').textContent = '开机自启：' + (auto ? '开' : '关');
}

async function saveAccount(){
  const cfg = {
    server:   document.getElementById('setServer').value,
    username: document.getElementById('setUser').value,
    password: document.getElementById('setPass').value
  };
  if (!cfg.server || !cfg.username || !cfg.password){
    await msgBox('平台地址、用户名、密码均不能为空。');
    return;
  }
  const cur = await window.api.getConfig();
  cur.server = cfg.server;
  cur.username = cfg.username;
  cur.password = cfg.password;
  await window.api.saveConfig(cur);

  document.getElementById('userTxt').textContent = '';
  const r = await window.api.login();
  if (r.ok){
    document.getElementById('userTxt').textContent = cfg.username;
  } else {
    await msgBox('登录失败：\n' + r.error, '登录失败');
  }
}

async function relogin(){
  document.getElementById('userTxt').textContent = '';
  const r = await window.api.login();
  if (!r.ok) await msgBox('重新登录失败：\n' + r.error, '登录失败');
}

async function togglePause(){
  const paused = await window.api.isPaused();
  if (paused){
    await window.api.resume();
    document.getElementById('btnPause').textContent = '暂停监控';
    return;
  }
  const v = await inputDialog({
    title: '暂停监控',
    hint: '输入分钟数（30 / 60 等），留空表示手动恢复。',
    defaultValue: '30'
  });
  if (v === null) return;
  const m = v.trim() === '' ? 0 : parseFloat(v);
  if (v.trim() !== '' && (isNaN(m) || m <= 0)){
    await msgBox('请输入有效分钟数。');
    return;
  }
  await window.api.pause(m);
  document.getElementById('btnPause').textContent = '恢复监控';
}

// ============================================================
// 实时点位
// ============================================================
let liveTagList = [];

async function renderLive(){
  const data = await window.api.loadTags();
  const cfg = await window.api.getConfig();
  const snap = await window.api.snapshot();
  const points = data.points || [];
  const tb = document.getElementById('liveBody');
  liveTagList = points.map(p => p.tag);

  if (!points.length){
    tb.innerHTML = '<tr><td colspan="7" class="empty">暂无位号，请到「规则配置」导入</td></tr>';
    document.getElementById('liveCount').textContent = '';
    return;
  }
  tb.innerHTML = points.map((p, i) => {
    return '<tr id="live_' + i + '">' +
      '<td title="' + esc(p.tag) + '">' + esc(p.tag) + '</td>' +
      '<td>' + esc(p.desc || '') + '</td>' +
      '<td class="v" id="lv_' + i + '">-</td>' +
      '<td>' + esc(p.unit || '') + '</td>' +
      '<td id="llv_' + i + '">-</td>' +
      '<td id="ldev_' + i + '">' + esc(getDeviceOf(p.tag, cfg.devices)) + '</td>' +
      '<td id="lt_' + i + '">-</td>' +
    '</tr>';
  }).join('');
  document.getElementById('liveCount').textContent = '共 ' + points.length + ' 个位号';

  updateLiveRows(snap, points);
}

function getDeviceOf(tag, devices){
  if (!tag) return '未分类';
  const up = String(tag).toUpperCase();
  for (const d of (devices || [])){
    if (!d || !d.name) continue;
    for (const kw of (d.keywords || [])){
      const k = String(kw).toUpperCase();
      if (k && up.indexOf(k) !== -1) return d.name;
    }
  }
  return '未分类';
}

function updateLiveRows(snap, points){
  for (let i = 0; i < points.length; i++){
    const p = points[i];
    const s = snap[p.tag];
    if (!s) continue;
    const row = document.getElementById('live_' + i);
    const ev = document.getElementById('lv_' + i);
    const el = document.getElementById('llv_' + i);
    const et = document.getElementById('lt_' + i);
    if (!ev) continue;

    const v = s.value;
    const lvl = levelOf(p, v, s.thresholds);
    ev.textContent = fmtVal(v);
    ev.className = 'v ' + (lvl ? 'lv-' + lvl : (v == null ? '' : 'lv-ok'));
    el.textContent = lvl || (v == null ? '等待' : '正常');
    el.className = lvl ? 'lv-' + lvl : 'lv-ok';
    et.textContent = fmtTime(s.lastUpdate);
    if (row){
      if (s.inAlarm) row.classList.add('alarm-row');
      else row.classList.remove('alarm-row');
    }
  }
}

function levelOf(p, v, t){
  if (typeof v !== 'number' || isNaN(v)) return null;
  if (t.hh != null && v >= t.hh) return 'HH';
  if (t.h  != null && v >= t.h ) return 'H';
  if (t.ll != null && v <= t.ll) return 'LL';
  if (t.l  != null && v <= t.l ) return 'L';
  return null;
}

setInterval(async () => {
  const page = document.getElementById('page-live');
  if (!page.classList.contains('active')) return;
  if (isEditing()) return;
  if (!liveTagList.length) return;
  const snap = await window.api.snapshot();
  const data = await window.api.loadTags();
  updateLiveRows(snap, data.points || []);
}, 1000);

// ============================================================
// 规则配置
// ============================================================
async function renderRuleTable(){
  const data = await window.api.loadTags();
  const cfg = await window.api.getConfig();
  const points = data.points || [];
  const tb = document.getElementById('ruleBody');

  if (!points.length){
    tb.innerHTML = '<tr><td colspan="12" class="empty">暂无位号，点「＋ 添加位号」或「Excel 导入」开始</td></tr>';
    document.getElementById('ruleCount').textContent = '';
    return;
  }
  tb.innerHTML = points.map((p, i) => {
    const dev = getDeviceOf(p.tag, cfg.devices);
    return '<tr data-i="' + i + '">' +
      '<td title="' + esc(p.tag) + '">' + esc(p.tag) + '</td>' +
      '<td><input type="text" class="c-desc" value="' + esc(p.desc || '') + '"></td>' +
      '<td><input type="text" class="c-hh" value="' + (p.hh == null ? '' : p.hh) + '"></td>' +
      '<td><input type="text" class="c-h"  value="' + (p.h  == null ? '' : p.h)  + '"></td>' +
      '<td><input type="text" class="c-l"  value="' + (p.l  == null ? '' : p.l)  + '"></td>' +
      '<td><input type="text" class="c-ll" value="' + (p.ll == null ? '' : p.ll) + '"></td>' +
      '<td><input type="text" class="c-dur" value="' + (p.duration == null ? 0 : p.duration) + '"></td>' +
      '<td><input type="text" class="c-cd"  value="' + (p.cooldown == null ? 10 : p.cooldown) + '"></td>' +
      '<td style="text-align:center"><input type="checkbox" class="c-en"' + (p.enabled === false ? '' : ' checked') + '></td>' +
      '<td><input type="text" class="c-unit" value="' + esc(p.unit || '') + '"></td>' +
      '<td class="dev-cell" title="' + esc(dev) + '" style="font-size:11px;color:#64748b">' + esc(dev) + '</td>' +
      '<td style="text-align:center"><button class="danger" data-del="' + i + '" style="padding:2px 7px;background:#dc2626;border-color:#dc2626;color:#fff">×</button></td>' +
    '</tr>';
  }).join('');

  tb.querySelectorAll('button[data-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i = Number(btn.getAttribute('data-del'));
      const data = await window.api.loadTags();
      const p = data.points[i];
      const ok = await confirmBox('确认删除位号「' + p.tag + '」？', '删除确认');
      if (!ok) return;
      const r = await window.api.removeTag(i);
      if (!r.ok) { await msgBox('删除失败：' + r.error); return; }
      renderRuleTable();
    });
  });

  document.getElementById('ruleCount').textContent = '共 ' + points.length + ' 个位号';
}

async function saveRules(){
  const tb = document.getElementById('ruleBody');
  const rows = tb.querySelectorAll('tr[data-i]');
  const data = await window.api.loadTags();
  const points = data.points;

  rows.forEach(row => {
    const i = Number(row.getAttribute('data-i'));
    const p = points[i];
    if (!p) return;
    const g = cls => {
      const el = row.querySelector('.' + cls);
      return el ? el.value : '';
    };
    const num = v => {
      const s = String(v).trim();
      if (s === '') return null;
      const n = parseFloat(s);
      return isNaN(n) ? null : n;
    };
    p.desc = String(g('c-desc') || '').trim();
    p.unit = String(g('c-unit') || '').trim();
    p.hh = num(g('c-hh'));
    p.h = num(g('c-h'));
    p.l = num(g('c-l'));
    p.ll = num(g('c-ll'));
    p.duration = num(g('c-dur')) || 0;
    p.cooldown = num(g('c-cd')) || 10;
    const en = row.querySelector('.c-en');
    p.enabled = en ? !!en.checked : true;
  });

  await window.api.saveRules(points);
  await msgBox('规则已保存，共 ' + points.length + ' 个位号。', '保存成功');
  renderRuleTable();
}

async function addTag(){
  const d = await inputDialog({
    title: '添加位号',
    hint: '格式：<b>位号[,描述[,单位]]</b><br>例如：HCY_TI_710A44_PV,塔顶温度,℃',
    defaultValue: ''
  });
  if (!d) return;
  const parts = d.split(/[,，\t]/).map(s => s.trim());
  const tag = parts[0];
  if (!tag) { await msgBox('位号不能为空'); return; }
  const r = await window.api.addTag({ tag, desc: parts[1] || '', unit: parts[2] || '' });
  if (!r.ok) { await msgBox('添加失败：' + r.error); return; }
  renderRuleTable();
}

async function importTags(){
  const txt = await inputDialog({
    title: '粘贴导入位号',
    hint: '每行一个，格式：<b>位号[,描述[,单位]]</b><br>例如：<br>HCY_TI_710A44_PV,塔顶温度,℃<br>HCY_PI_710A45_PV',
    defaultValue: ''
  });
  if (!txt) return;
  const r = await window.api.importTags(txt);
  await msgBox('导入完成：新增 ' + r.added + ' 个，跳过重复 ' + r.skipped + ' 个。\n当前共 ' + r.total + ' 个位号。', '导入完成');
  renderRuleTable();
}

async function importExcel(){
  const r = await window.api.importExcel();
  if (!r.ok){
    if (r.error !== '已取消') await msgBox('Excel 导入失败：' + r.error, '导入失败');
    return;
  }
  await msgBox('Excel 导入完成：新增 ' + r.added + ' 个，跳过重复 ' + r.skipped + ' 个。\n当前共 ' + r.total + ' 个位号。', '导入完成');
  renderRuleTable();
}

async function fetchMeta(){
  const r = await window.api.fetchMeta();
  if (r.ok){
    await msgBox('已拉取元数据，更新 ' + r.filled + ' 个字段。', '完成');
    renderRuleTable();
  } else {
    await msgBox('拉取失败：' + r.error, '失败');
  }
}

// ---- 三期：规则测试 ----
async function openTestRule(){
  const data = await window.api.loadTags();
  const points = data.points || [];
  const sel = document.getElementById('testTag');
  if (!points.length){
    await msgBox('暂无位号，请先导入位号。', '无法测试');
    return;
  }
  sel.innerHTML = points.map(p =>
    '<option value="' + esc(p.tag) + '">' + esc(p.tag) +
    (p.desc ? ' · ' + esc(p.desc) : '') + '</option>'
  ).join('');
  document.getElementById('testValue').value = '';
  document.getElementById('testResult').style.display = 'none';
  document.getElementById('testModal').style.display = 'flex';
  setTimeout(() => document.getElementById('testValue').focus(), 30);
}

async function runTestRule(){
  const tag = document.getElementById('testTag').value;
  const value = document.getElementById('testValue').value.trim();
  if (value === ''){ await msgBox('请输入模拟值。'); return; }
  const r = await window.api.testRule({ tag, value });
  const box = document.getElementById('testResult');
  box.style.display = 'block';
  if (!r.ok){
    box.innerHTML = '<div style="color:#dc2626">错误：' + esc(r.error) + '</div>';
    return;
  }
  const t = r.thresholds;
  const levelColors = { HH:'#dc2626', H:'#f97316', L:'#ca8a04', LL:'#2563eb' };
  const levelTxt = r.level
    ? '<b style="color:' + levelColors[r.level] + '">' + r.level + '</b>'
    : '<span style="color:#16a34a">正常</span>';
  const cd = r.cooldownUntil
    ? new Date(r.cooldownUntil).toLocaleTimeString('zh-CN')
    : '未进入冷却';
  box.innerHTML =
    '<div><b>判断结果：</b>' + levelTxt + '</div>' +
    '<div style="color:#64748b;margin-top:4px">' +
      '阈值：HH=' + (t.hh == null ? '空' : t.hh) +
      '　H='  + (t.h  == null ? '空' : t.h)  +
      '　L='  + (t.l  == null ? '空' : t.l)  +
      '　LL=' + (t.ll == null ? '空' : t.ll) +
      (t.temp ? '　<b style="color:#f97316">（临时值生效中）</b>' : '') +
    '</div>' +
    '<div style="color:#64748b;margin-top:4px">' +
      '持续时间：' + r.duration + ' 秒　冷却：' + r.cooldown + ' 分钟' +
    '</div>' +
    '<div style="color:#64748b;margin-top:4px">' +
      '当前报警中：' + (r.inAlarm ? '是' : '否') +
      '　冷却至：' + cd +
    '</div>';
}

// ============================================================
// 装置分类
// ============================================================
let deviceDraft = [];

async function renderDevices(){
  const cfg = await window.api.getConfig();
  deviceDraft = JSON.parse(JSON.stringify(cfg.devices || []));
  renderDeviceList();
  const stat = document.getElementById('devStat');
  if (!deviceDraft.length) stat.textContent = '（暂无规则，所有位号归入未分类）';
  else stat.textContent = '';
}

function renderDeviceList(){
  const box = document.getElementById('devList');
  if (!deviceDraft.length){
    box.innerHTML = '<div style="color:#94a3b8;text-align:center;padding:20px">暂无规则</div>';
    return;
  }
  box.innerHTML = deviceDraft.map((d, i) =>
    '<div class="dev-row" data-i="' + i + '">' +
      '<input type="text" class="rname" value="' + esc(d.name || '') + '" placeholder="装置名">' +
      '<input type="text" class="rkw" value="' + esc((d.keywords || []).join(', ')) + '" placeholder="关键字，逗号分隔">' +
      '<div class="rbtn">' +
        '<button data-up="' + i + '" ' + (i === 0 ? 'disabled' : '') + '>↑</button>' +
        '<button data-down="' + i + '" ' + (i === deviceDraft.length - 1 ? 'disabled' : '') + '>↓</button>' +
        '<button data-del="' + i + '" style="background:#dc2626;border-color:#dc2626;color:#fff">×</button>' +
      '</div>' +
    '</div>'
  ).join('');

  box.querySelectorAll('[data-up]').forEach(b => b.addEventListener('click', () => {
    const i = Number(b.getAttribute('data-up'));
    [deviceDraft[i-1], deviceDraft[i]] = [deviceDraft[i], deviceDraft[i-1]];
    syncDeviceInputs(); renderDeviceList();
  }));
  box.querySelectorAll('[data-down]').forEach(b => b.addEventListener('click', () => {
    const i = Number(b.getAttribute('data-down'));
    [deviceDraft[i+1], deviceDraft[i]] = [deviceDraft[i], deviceDraft[i+1]];
    syncDeviceInputs(); renderDeviceList();
  }));
  box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    const i = Number(b.getAttribute('data-del'));
    const ok = await confirmBox('删除规则「' + deviceDraft[i].name + '」？', '删除确认');
    if (!ok) return;
    deviceDraft.splice(i, 1);
    syncDeviceInputs(); renderDeviceList();
  }));
}

function syncDeviceInputs(){
  const box = document.getElementById('devList');
  box.querySelectorAll('.dev-row').forEach(row => {
    const i = Number(row.getAttribute('data-i'));
    const d = deviceDraft[i];
    if (!d) return;
    d.name = row.querySelector('.rname').value.trim();
    d.keywords = row.querySelector('.rkw').value
      .split(/[,，;；\s]+/).map(s => s.trim()).filter(Boolean);
  });
}

async function saveDevices(){
  syncDeviceInputs();
  deviceDraft = deviceDraft.filter(d => d.name && d.keywords.length);
  await window.api.saveDevices(deviceDraft);
  await msgBox('装置分类已保存，共 ' + deviceDraft.length + ' 个。', '保存成功');
  renderDeviceList();
  renderLive();
  renderRuleTable();
}

// ============================================================
// 邮件
// ============================================================
async function loadMailToUI(){
  const cfg = await window.api.getConfig();
  document.getElementById('mailEnabled').checked = !!(cfg.mail && cfg.mail.enabled);
  document.getElementById('mailFrom').value = (cfg.mail && cfg.mail.from) || '';
  document.getElementById('mailPass').value = (cfg.mail && cfg.mail.pass) || '';
  document.getElementById('mailTo').value   = (cfg.mail && cfg.mail.to)   || '';
}

async function saveMail(){
  const mail = {
    enabled: document.getElementById('mailEnabled').checked,
    from: document.getElementById('mailFrom').value.trim(),
    pass: document.getElementById('mailPass').value,
    to:   document.getElementById('mailTo').value.trim()
  };
  await window.api.saveMail(mail);
  await msgBox('邮件设置已保存。', '保存成功');
}

async function testMail(){
  await saveMail();
  const r = await window.api.testMail();
  if (r.ok) await msgBox('测试邮件已发送。', '成功');
  else await msgBox('发送失败：' + r.error, '失败');
}

// ============================================================
// 三期：配置导入/导出
// ============================================================
async function exportCfg(){
  const r = await window.api.exportConfig();
  const stat = document.getElementById('cfgIoStat');
  if (r.ok){
    stat.textContent = '已导出 → ' + r.path;
    stat.style.color = '#16a34a';
  } else if (r.error !== '已取消'){
    stat.textContent = '失败：' + r.error;
    stat.style.color = '#dc2626';
  } else {
    stat.textContent = '';
  }
}

async function importCfg(){
  const ok = await confirmBox(
    '导入会覆盖当前服务器地址、用户名、邮件设置（不含密码/授权码）、装置分类、画布规则和位号清单。\n' +
    '当前密码和授权码会保留。\n\n继续？',
    '导入确认'
  );
  if (!ok) return;
  const r = await window.api.importConfig();
  const stat = document.getElementById('cfgIoStat');
  if (!r.ok){
    if (r.error !== '已取消'){
      stat.textContent = '失败：' + r.error;
      stat.style.color = '#dc2626';
    }
    return;
  }
  stat.textContent = '导入成功：位号 ' + r.points + '，装置 ' + r.devices + '，画布 ' + r.canvas;
  stat.style.color = '#16a34a';
  await msgBox(
    '配置导入完成。\n\n由于账号/服务器可能已变，建议点「保存并重连」重新登录。',
    '导入完成'
  );
  // 刷新所有 UI
  await loadConfigToUI();
  renderLive();
  renderRuleTable();
  renderDevices();
  loadMailToUI();
}

// ============================================================
// 三期：检查更新
// ============================================================
async function checkUpdate(){
  const stat = document.getElementById('updateStat');
  stat.textContent = '正在检查…';
  stat.style.color = '#64748b';
  await window.api.checkUpdate();
}

// ============================================================
// 日志
// ============================================================
async function refreshLog(){
  const txt = await window.api.readLog();
  const box = document.getElementById('logView');
  if (!box) return;
  const lines = String(txt || '').split(/\r?\n/);
  const cut = Date.now() - 8 * 3600 * 1000;
  const kept = lines.filter(l => {
    const m = l.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    if (!m) return false;
    const t = new Date(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6]).getTime();
    return t >= cut;
  });
  box.innerHTML = kept.map(l => {
    const cls = l.indexOf('[ERROR]') >= 0 ? 'style="color:#f87171"'
              : l.indexOf('[WARN]')  >= 0 ? 'style="color:#fbbf24"' : '';
    return '<div ' + cls + '>' + esc(l) + '</div>';
  }).join('');
  box.scrollTop = box.scrollHeight;
}

async function clearLog(){
  await window.api.clearLog();
  refreshLog();
}

// ============================================================
// 绑定
// ============================================================
function bind(id, fn){
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', fn);
  else console.warn('未找到按钮：#' + id);
}

bind('btnSaveAccount', saveAccount);
bind('btnRelogin', relogin);
bind('btnPause', togglePause);
bind('btnLiveRefresh', renderLive);
bind('btnAddTag', addTag);
bind('btnImportTags', importTags);
bind('btnImportExcel', importExcel);
bind('btnReloadRules', renderRuleTable);
bind('btnTestRule', openTestRule);
bind('btnSaveRules', saveRules);
bind('btnFetchMeta', fetchMeta);
bind('btnDevAdd', () => { deviceDraft.push({ name: '', keywords: [] }); renderDeviceList(); });
bind('btnDevSave', saveDevices);
bind('btnMailSave', saveMail);
bind('btnMailTest', testMail);
bind('btnLogRefresh', refreshLog);
bind('btnLogClear', clearLog);
bind('btnExportCfg', exportCfg);
bind('btnImportCfg', importCfg);
bind('btnCheckUpdate', checkUpdate);
bind('btnAuto', async () => {
  const cur = await window.api.getAutoStart();
  await window.api.setAutoStart(!cur);
  document.getElementById('btnAuto').textContent = '开机自启：' + (!cur ? '开' : '关');
});

// 规则测试弹框绑定
document.getElementById('testCancel').addEventListener('click', () => {
  document.getElementById('testModal').style.display = 'none';
});
document.getElementById('testRun').addEventListener('click', runTestRule);
document.getElementById('testValue').addEventListener('keydown', e => {
  if (e.key === 'Enter') runTestRule();
});

// 主进程推送
window.api.onConnState(d => setConn(d.state, d.text));
window.api.onUpdateStatus(d => {
  const stat = document.getElementById('updateStat');
  if (stat){
    stat.textContent = d.text;
    stat.style.color = d.text.indexOf('失败') >= 0 ? '#dc2626'
                     : d.text.indexOf('最新') >= 0 ? '#16a34a' : '#64748b';
  }
});
window.api.onConfigReloaded(() => {
  loadConfigToUI();
  renderLive();
  renderRuleTable();
  renderDevices();
  loadMailToUI();
});

// ============================================================
// 启动
// ============================================================
loadConfigToUI();
renderLive();
canvasInitBindings();
document.getElementById('appVer').textContent = '1.0.0';