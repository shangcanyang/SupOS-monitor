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
    if (name === 'canvas'){
      // 每次进画布页都重新拉一次变量名
      if (window.__canvasReloadVars) window.__canvasReloadVars().then(canvasLoad);
      else canvasLoad();
    }
    if (name === 'vars') renderVars();
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
// 装置分类工具
// ============================================================
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

// ============================================================
// 实时点位
// ============================================================
let livePointsCache = [];
let liveDeviceMap = {};
let liveCollapse = {};
let liveSnapshot = {};
let liveDevicePause = {};
let dragCtx = null;

async function renderLive(){
  const data = await window.api.loadTags();
  const cfg = await window.api.getConfig();
  const pauseR = await window.api.pauseList();
  const points = data.points || [];
  const liveOrder = data.liveOrder || [];

  livePointsCache = points;
  liveDeviceMap = {};
  for (const p of points){
    liveDeviceMap[p.tag] = getDeviceOf(p.tag, cfg.devices);
  }
  liveDevicePause = pauseR.list || {};

  const groups = groupByDevice(points, cfg.devices, liveOrder);
  const box = document.getElementById('liveGroups');

  if (!points.length){
    box.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:40px;' +
                    'border:1px dashed #e2e8f0;border-radius:6px;background:#fafbfc">' +
                    '暂无位号，请到「规则配置」导入</div>';
    document.getElementById('liveCount').textContent = '';
    return;
  }

  box.innerHTML = groups.map(g => groupHtml(g)).join('');
  document.getElementById('liveCount').textContent =
    '共 ' + points.length + ' 个位号，' + groups.length + ' 个装置';

  bindCardEvents();
  await refreshLiveValues();
  updatePauseTimers();
}

function groupByDevice(points, devices, liveOrder){
  const orderMap = {};
  (liveOrder || []).forEach((t, i) => { orderMap[t] = i; });
  const map = {};
  const present = [];
  for (const p of points){
    const dev = getDeviceOf(p.tag, devices);
    if (!map[dev]){ map[dev] = []; present.push(dev); }
    map[dev].push(p);
  }
  const ordered = [];
  for (const d of (devices || [])){
    if (d && d.name && map[d.name]) ordered.push(d.name);
  }
  if (map['未分类']) ordered.push('未分类');
  for (const name of present){
    if (ordered.indexOf(name) === -1) ordered.push(name);
  }
  return ordered.map(name => {
    const items = map[name].slice();
    items.sort((a, b) => {
      const ai = orderMap[a.tag] !== undefined ? orderMap[a.tag] : 999999;
      const bi = orderMap[b.tag] !== undefined ? orderMap[b.tag] : 999999;
      return ai - bi;
    });
    return { name, items };
  });
}

function isDevicePaused(dev, now){
  const until = liveDevicePause[dev];
  if (until === undefined) return false;
  if (until === 0) return true;
  return now < until;
}

function pauseStatusText(dev, now){
  const until = liveDevicePause[dev];
  if (until === undefined) return '';
  if (until === 0) return '已暂停（手动恢复）';
  const sec = Math.max(0, Math.floor((until - now) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return '暂停 ' + m + ':' + String(s).padStart(2, '0');
}

function groupHtml(g){
  const collapsed = !!liveCollapse[g.name];
  const now = Date.now();
  const paused = isDevicePaused(g.name, now);
  let alarmCnt = 0;
  if (!paused){
    for (const p of g.items){
      const s = liveSnapshot[p.tag];
      if (s && s.inAlarm) alarmCnt++;
    }
  }
  const pauseBtn = paused
    ? '<button class="dev-pause-btn paused" data-pause-toggle="' + esc(g.name) + '">▶ 恢复</button>'
    : '<button class="dev-pause-btn" data-pause-toggle="' + esc(g.name) + '">⏸ 暂停</button>';

  return '<div class="live-dev-group' + (paused ? ' paused' : '') +
         '" data-dev="' + esc(g.name) + '">' +
    '<div class="live-dev-hd" data-toggle="' + esc(g.name) + '">' +
      '<span class="arrow">' + (collapsed ? '▶' : '▼') + '</span>' +
      '<span>' + esc(g.name) + '</span>' +
      '<span class="cnt">' + g.items.length + ' 个点位</span>' +
      (alarmCnt ? '<span class="alarm">⚠ 报警 ' + alarmCnt + '</span>' : '') +
      (paused ? '<span class="pause-status" data-pause-status="' + esc(g.name) + '">' +
                pauseStatusText(g.name, now) + '</span>' : '') +
      '<span class="spacer"></span>' +
      pauseBtn +
    '</div>' +
    '<div class="live-dev-body" data-body="' + esc(g.name) + '" style="' +
         (collapsed ? 'display:none' : '') + '">' +
      g.items.map(p => cardHtml(p, paused)).join('') +
    '</div>' +
  '</div>';
}

function cardHtml(p, muted){
  const dev = liveDeviceMap[p.tag] || '';
  return '<div class="pcard' + (muted ? ' muted' : '') + '" draggable="true" ' +
    'data-tag="' + esc(p.tag) + '" data-dev="' + esc(dev) + '">' +
    '<div class="pc-tag" title="' + esc(p.tag) + '">' + esc(p.tag) + '</div>' +
    '<div class="pc-desc" title="' + esc(p.desc || '') + '">' +
      (p.desc ? esc(p.desc) : '&nbsp;') + '</div>' +
    '<div><span class="pc-val" data-val="' + esc(p.tag) + '">-</span>' +
      '<span class="pc-unit">' + esc(p.unit || '') + '</span></div>' +
    '<div class="pc-foot">' +
      '<span class="pc-lv ok" data-lv="' + esc(p.tag) + '">-</span>' +
      '<span data-time="' + esc(p.tag) + '">-</span>' +
    '</div>' +
  '</div>';
}

function bindCardEvents(){
  const box = document.getElementById('liveGroups');

  box.querySelectorAll('.live-dev-hd').forEach(hd => {
    hd.addEventListener('click', (e) => {
      if (e.target.closest('.dev-pause-btn')) return;
      const name = hd.getAttribute('data-toggle');
      liveCollapse[name] = !liveCollapse[name];
      const group = hd.parentNode;
      const body = group.querySelector('.live-dev-body');
      const arrow = hd.querySelector('.arrow');
      if (liveCollapse[name]){
        body.style.display = 'none';
        arrow.textContent = '▶';
      } else {
        body.style.display = '';
        arrow.textContent = '▼';
      }
    });
  });

  box.querySelectorAll('[data-pause-toggle]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const dev = btn.getAttribute('data-pause-toggle');
      const now = Date.now();
      if (isDevicePaused(dev, now)){
        await window.api.resumeDevice(dev);
        await renderLive();
        return;
      }
      const v = await inputDialog({
        title: '暂停装置报警 · ' + dev,
        hint: '输入暂停分钟数（例如 30 / 60），<b>留空表示手动恢复</b>。<br>' +
              '暂停期间：该装置内所有测点<b>不再弹窗、不发邮件</b>，数值照常显示。',
        defaultValue: '30'
      });
      if (v === null) return;
      const m = v.trim() === '' ? 0 : parseFloat(v);
      if (v.trim() !== '' && (isNaN(m) || m <= 0)){
        await msgBox('请输入有效分钟数。');
        return;
      }
      await window.api.pauseDevice(dev, m);
      await renderLive();
    });
  });

  box.querySelectorAll('.pcard').forEach(card => {
    card.addEventListener('dragstart', e => {
      const tag = card.getAttribute('data-tag');
      const dev = card.getAttribute('data-dev');
      dragCtx = { tag, dev };
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', tag); } catch(_) {}
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      box.querySelectorAll('.pcard').forEach(c => {
        c.classList.remove('drop-before','drop-after');
      });
      box.querySelectorAll('.live-dev-body').forEach(b => {
        b.classList.remove('drag-over');
      });
      dragCtx = null;
    });
    card.addEventListener('dragover', e => {
      if (!dragCtx) return;
      if (card.getAttribute('data-dev') !== dragCtx.dev) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const r = card.getBoundingClientRect();
      const before = (e.clientX - r.left) < r.width / 2;
      box.querySelectorAll('.pcard').forEach(c => c.classList.remove('drop-before','drop-after'));
      card.classList.add(before ? 'drop-before' : 'drop-after');
    });
    card.addEventListener('dragleave', () => {
      card.classList.remove('drop-before','drop-after');
    });
    card.addEventListener('drop', async e => {
      e.preventDefault();
      if (!dragCtx) return;
      if (card.getAttribute('data-dev') !== dragCtx.dev) return;
      const targetTag = card.getAttribute('data-tag');
      if (targetTag === dragCtx.tag) return;
      const r = card.getBoundingClientRect();
      const before = (e.clientX - r.left) < r.width / 2;
      const srcTag = dragCtx.tag;
      dragCtx = null;
      await reorderCard(srcTag, targetTag, before);
    });
  });

  box.querySelectorAll('.live-dev-body').forEach(body => {
    body.addEventListener('dragover', e => {
      if (!dragCtx) return;
      if (body.getAttribute('data-body') !== dragCtx.dev) return;
      e.preventDefault();
      body.classList.add('drag-over');
    });
    body.addEventListener('dragleave', e => {
      if (e.target === body) body.classList.remove('drag-over');
    });
    body.addEventListener('drop', async e => {
      if (!dragCtx) return;
      if (body.getAttribute('data-body') !== dragCtx.dev) return;
      if (e.target.closest('.pcard')) return;
      e.preventDefault();
      body.classList.remove('drag-over');
      const srcTag = dragCtx.tag;
      dragCtx = null;
      await reorderCard(srcTag, null, false);
    });
  });
}

async function reorderCard(srcTag, targetTag, before){
  const data = await window.api.loadTags();
  const points = data.points || [];
  let order = (data.liveOrder || []).slice();
  const set = {};
  order.forEach(t => { set[t] = true; });
  for (const p of points){
    if (!set[p.tag]) order.push(p.tag);
  }
  order = order.filter(t => t !== srcTag);
  if (targetTag){
    const idx = order.indexOf(targetTag);
    if (idx === -1) order.push(srcTag);
    else order.splice(before ? idx : idx + 1, 0, srcTag);
  } else {
    const dev = liveDeviceMap[srcTag];
    const siblings = points
      .filter(p => liveDeviceMap[p.tag] === dev && p.tag !== srcTag)
      .map(p => p.tag);
    if (siblings.length){
      let lastIdx = -1;
      for (const s of siblings){
        const i = order.indexOf(s);
        if (i > lastIdx) lastIdx = i;
      }
      order.splice(lastIdx + 1, 0, srcTag);
    } else {
      order.push(srcTag);
    }
  }
  await window.api.saveLiveOrder(order);
  await renderLive();
}

// ============================================================
// 实时数值刷新
// ============================================================
function levelOf(p, v, t){
  if (typeof v !== 'number' || isNaN(v)) return null;
  if (t.hh != null && v >= t.hh) return 'HH';
  if (t.h  != null && v >= t.h ) return 'H';
  if (t.ll != null && v <= t.ll) return 'LL';
  if (t.l  != null && v <= t.l ) return 'L';
  return null;
}

async function refreshLiveValues(){
  const snap = await window.api.snapshot();
  liveSnapshot = snap || {};
  for (const p of livePointsCache) updateCard(p);
  updateGroupAlarms();
}

function updateCard(p){
  const s = liveSnapshot[p.tag];
  const card = document.querySelector('.pcard[data-tag="' + cssEsc(p.tag) + '"]');
  if (!card) return;
  if (!s){ card.className = 'pcard'; return; }

  const valEl = card.querySelector('[data-val]');
  const lvEl  = card.querySelector('[data-lv]');
  const tEl   = card.querySelector('[data-time]');

  const v = s.value;
  const dev = liveDeviceMap[p.tag];
  const paused = isDevicePaused(dev, Date.now());
  const lvl = paused ? null : levelOf(p, v, s.thresholds);

  if (valEl) valEl.textContent = fmtVal(v);

  let cls = 'pcard';
  if (paused) cls += ' muted';
  if (lvl) cls += ' lv-' + lvl;
  else if (v != null && !paused) cls += ' lv-ok';
  if (s.inAlarm && !paused) cls += ' alarming';
  card.className = cls;

  if (lvEl){
    if (paused){
      lvEl.className = 'pc-lv paused';
      lvEl.textContent = '已暂停';
    } else if (lvl){
      lvEl.className = 'pc-lv ' + lvl;
      lvEl.textContent = lvl;
    } else {
      lvEl.className = 'pc-lv ok';
      lvEl.textContent = (v == null) ? '等待' : '正常';
    }
  }
  if (tEl) tEl.textContent = fmtTime(s.lastUpdate);
}

function updateGroupAlarms(){
  document.querySelectorAll('.live-dev-group').forEach(g => {
    const dev = g.getAttribute('data-dev');
    const now = Date.now();
    const paused = isDevicePaused(dev, now);
    g.classList.toggle('paused', paused);
    let alarmCnt = 0;
    if (!paused){
      for (const p of livePointsCache){
        if (liveDeviceMap[p.tag] !== dev) continue;
        const s = liveSnapshot[p.tag];
        if (s && s.inAlarm) alarmCnt++;
      }
    }
    const hd = g.querySelector('.live-dev-hd');
    let alarmEl = hd.querySelector('.alarm');
    if (alarmCnt){
      if (!alarmEl){
        alarmEl = document.createElement('span');
        alarmEl.className = 'alarm';
        const sp = hd.querySelector('.spacer');
        hd.insertBefore(alarmEl, sp);
      }
      alarmEl.textContent = '⚠ 报警 ' + alarmCnt;
    } else if (alarmEl){
      alarmEl.remove();
    }
  });
}

function updatePauseTimers(){
  const now = Date.now();
  document.querySelectorAll('[data-pause-status]').forEach(el => {
    const dev = el.getAttribute('data-pause-status');
    if (isDevicePaused(dev, now)){
      el.textContent = pauseStatusText(dev, now);
    }
  });
}

function cssEsc(s){
  return String(s).replace(/(["\\])/g, '\\$1');
}

setInterval(async () => {
  const page = document.getElementById('page-live');
  if (!page.classList.contains('active')) return;
  if (isEditing()) return;
  if (!livePointsCache.length) return;
  const now = Date.now();
  let changed = false;
  for (const dev in liveDevicePause){
    const until = liveDevicePause[dev];
    if (until > 0 && now >= until){ changed = true; break; }
  }
  if (changed){ await renderLive(); return; }
  const snap = await window.api.snapshot();
  liveSnapshot = snap || {};
  for (const p of livePointsCache) updateCard(p);
  updateGroupAlarms();
  updatePauseTimers();
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

async function openTestRule(){
  const data = await window.api.loadTags();
  const points = data.points || [];
  const sel = document.getElementById('testTag');
  if (!points.length){ await msgBox('暂无位号，请先导入位号。', '无法测试'); return; }
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
  if (!r.ok){ box.innerHTML = '<div style="color:#dc2626">错误：' + esc(r.error) + '</div>'; return; }
  const t = r.thresholds;
  const levelColors = { HH:'#dc2626', H:'#f97316', L:'#ca8a04', LL:'#2563eb' };
  const levelTxt = r.level
    ? '<b style="color:' + levelColors[r.level] + '">' + r.level + '</b>'
    : '<span style="color:#16a34a">正常</span>';
  const cd = r.cooldownUntil ? new Date(r.cooldownUntil).toLocaleTimeString('zh-CN') : '未进入冷却';
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
      '当前报警中：' + (r.inAlarm ? '是' : '否') + '　冷却至：' + cd +
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
// 环境变量页
// ============================================================
let varDraft = [];
let varRuntime = {};

async function renderVars(){
  const r = await window.api.loadVars();
  varDraft = JSON.parse(JSON.stringify(r.vars || []));
  await refreshVarRuntime();
  renderVarList();
}

async function refreshVarRuntime(){
  try {
    const r = await window.api.varsRuntime();
    varRuntime = (r && r.vars) || {};
  } catch (e) {
    varRuntime = {};
  }
}

function renderVarList(){
  const tb = document.getElementById('varBody');
  if (!varDraft.length){
    tb.innerHTML = '<tr><td colspan="6" class="empty">' +
      '暂无环境变量，点「＋ 添加变量」开始</td></tr>';
    document.getElementById('varStat').textContent = '';
    return;
  }
  tb.innerHTML = varDraft.map((v, i) => {
    const rt = varRuntime[v.name];
    const rtTxt = (rt === undefined || rt === null || rt === '')
      ? '<span class="var-rt empty">—</span>'
      : '<span class="var-rt">' + esc(String(rt)) + '</span>';
    return '<tr data-i="' + i + '">' +
      '<td><input type="text" class="c-vname" value="' + esc(v.name || '') + '" placeholder="var1"></td>' +
      '<td>' +
        '<select class="c-vtype">' +
          '<option value="number"' + (v.type !== 'string' ? ' selected' : '') + '>数值</option>' +
          '<option value="string"' + (v.type === 'string' ? ' selected' : '') + '>文本</option>' +
        '</select>' +
      '</td>' +
      '<td><input type="text" class="c-vinit" value="' + esc(v.init == null ? '' : v.init) + '" placeholder="0"></td>' +
      '<td><input type="text" class="c-vdesc" value="' + esc(v.desc || '') + '" placeholder="描述（可空）"></td>' +
      '<td>' + rtTxt + '</td>' +
      '<td class="var-actions"><button class="var-del" data-vdel="' + i + '">×</button></td>' +
    '</tr>';
  }).join('');

  tb.querySelectorAll('[data-vdel]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i = Number(btn.getAttribute('data-vdel'));
      const v = varDraft[i];
      if (!v) return;
      const ok = await confirmBox('确认删除变量「' + v.name + '」？', '删除确认');
      if (!ok) return;
      varDraft.splice(i, 1);
      renderVarList();
    });
  });

  document.getElementById('varStat').textContent =
    '共 ' + varDraft.length + ' 个变量';
}

async function addVarRow(){
  const name = await inputDialog({
    title: '添加变量',
    hint: '格式：<b>变量名,类型(n/s),初始值,描述</b><br>' +
          '例如：<br>alarm_flag,n,0,报警标记<br>' +
          'area_name,s,,区域名',
    defaultValue: ''
  });
  if (!name) return;
  const parts = name.split(/[,，\t]/).map(s => s.trim());
  const vn = parts[0];
  if (!vn){ await msgBox('变量名不能为空'); return; }
  const type = (parts[1] || 'n').toLowerCase().startsWith('s') ? 'string' : 'number';
  const init = parts[2] == null || parts[2] === ''
    ? (type === 'string' ? '' : 0)
    : parts[2];
  const desc = parts[3] || '';

  const r = await window.api.addVar({ name: vn, type, init, desc });
  if (!r.ok){ await msgBox('添加失败：' + r.error, '失败'); return; }
  // 添加成功后重新拉取并刷新；也同步画布页变量名
  await renderVars();
  if (window.__canvasReloadVars) window.__canvasReloadVars();
  renderVarList();
}

async function saveVars(){
  // 收集表格
  const tb = document.getElementById('varBody');
  const rows = tb.querySelectorAll('tr[data-i]');
  const out = [];
  const seen = {};
  let err = '';
  rows.forEach(row => {
    const i = Number(row.getAttribute('data-i'));
    const cur = varDraft[i] || {};
    const g = cls => {
      const el = row.querySelector('.' + cls);
      return el ? el.value : '';
    };
    const name = String(g('c-vname') || '').trim();
    if (!name) return;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)){
      err = '变量名不合法：' + name; return;
    }
    if (seen[name]){ err = '变量名重复：' + name; return; }
    seen[name] = true;
    const type = g('c-vtype') === 'string' ? 'string' : 'number';
    let init = g('c-vinit');
    if (type === 'number'){
      if (init === '') init = 0;
      else {
        const n = Number(init);
        if (isNaN(n)){ err = name + ' 的初始值不是数字'; return; }
        init = n;
      }
    }
    out.push({
      id: cur.id,
      name,
      type,
      init,
      desc: String(g('c-vdesc') || '').trim()
    });
  });
  if (err){ await msgBox(err, '保存失败'); return; }

  const r = await window.api.saveVars(out);
  if (!r.ok){ await msgBox('保存失败：' + r.error, '失败'); return; }
  await msgBox('环境变量已保存，共 ' + r.total + ' 个。', '保存成功');
  await renderVars();
  if (window.__canvasReloadVars) window.__canvasReloadVars();
}

// 定时刷新运行时值显示
setInterval(async () => {
  const page = document.getElementById('page-vars');
  if (!page || !page.classList.contains('active')) return;
  await refreshVarRuntime();
  const tb = document.getElementById('varBody');
  if (!tb) return;
  tb.querySelectorAll('tr[data-i]').forEach(row => {
    const i = Number(row.getAttribute('data-i'));
    const v = varDraft[i];
    if (!v) return;
    const rt = varRuntime[v.name];
    const td = row.children[4];
    if (!td) return;
    if (rt === undefined || rt === null || rt === ''){
      td.innerHTML = '<span class="var-rt empty">—</span>';
    } else {
      td.innerHTML = '<span class="var-rt">' + esc(String(rt)) + '</span>';
    }
  });
}, 2000);

// ============================================================
// 邮件
// ============================================================
async function loadMailToUI(){
  const cfg = await window.api.getConfig();
  document.getElementById('mailEnabled').checked = !!(cfg.mail && cfg.mail.enabled);
  document.getElementById('mailFrom').value = (cfg.mail && cfg.mail.from) || '';
  document.getElementById('mailPass').value = (cfg.mail && cfg.mail.pass) || '';
  document.getElementById('mailTo').value   = (cfg.mail && cfg.mail.to)   || '';
  document.getElementById('mailImapEnabled').checked = !!(cfg.mail && cfg.mail.imapEnabled);
  await refreshMuteStatus();
}

async function refreshMuteStatus(){
  const r = await window.api.muteStatus();
  const el = document.getElementById('mailMuteStatus');
  if (!el) return;
  if (r.alertMuted){
    const t = r.mutedAt ? new Date(r.mutedAt).toLocaleString('zh-CN') : '-';
    el.innerHTML = '<span style="display:inline-block;background:#fee2e2;color:#dc2626;' +
                   'padding:2px 9px;border-radius:8px;font-size:12px;font-weight:600;">' +
                   '⚠ 已静音</span>' +
                   '<span style="color:#64748b;font-size:11px;margin-left:8px;">' +
                   t + ' 由 ' + esc(r.mutedBy || '-') + ' 触发</span>';
  } else {
    let listen;
    if (r.busy) listen = '<span style="color:#f59e0b">正在检查…</span>';
    else if (!r.imapEnabled) listen = '<span style="color:#94a3b8">邮件指令未启用</span>';
    else if (r.running) listen = '<span style="color:#16a34a">邮件指令监听中</span>';
    else listen = '<span style="color:#f59e0b">邮件指令未运行</span>';
    el.innerHTML = '<span style="display:inline-block;background:#dcfce7;color:#16a34a;' +
                   'padding:2px 9px;border-radius:8px;font-size:12px;font-weight:600;">' +
                   '✓ 活跃</span>' +
                   '<span style="color:#64748b;font-size:11px;margin-left:8px;">' + listen + '</span>';
  }
}

async function saveMail(){
  const mail = {
    enabled: document.getElementById('mailEnabled').checked,
    from: document.getElementById('mailFrom').value.trim(),
    pass: document.getElementById('mailPass').value,
    to:   document.getElementById('mailTo').value.trim(),
    imapEnabled: document.getElementById('mailImapEnabled').checked
  };
  await window.api.saveMail(mail);
  await refreshMuteStatus();
  await msgBox('邮件设置已保存。', '保存成功');
}

async function testMail(){
  await saveMail();
  const r = await window.api.testMail();
  if (r.ok) await msgBox('测试邮件已发送。', '成功');
  else await msgBox('发送失败：' + r.error, '失败');
}

async function unmuteMail(){
  await window.api.unmuteMail();
  await refreshMuteStatus();
  await msgBox('邮件报警已恢复。', '恢复成功');
}

async function checkMailNow(){
  const stat = document.getElementById('mailCmdStat');
  stat.textContent = '正在检查…';
  stat.style.color = '#64748b';
  try {
    const r = await window.api.checkMailNow();
    await refreshMuteStatus();
    if (r && r.ok === false){
      stat.textContent = '检查失败：' + (r.message || '未知错误') + ' ' +
                         new Date().toLocaleTimeString('zh-CN');
      stat.style.color = '#dc2626';
    } else {
      const parts = [];
      if (r && typeof r.processed === 'number') parts.push('处理 ' + r.processed + ' 封');
      if (r && typeof r.skipped === 'number' && r.skipped) parts.push('跳过 ' + r.skipped + ' 封');
      if (r && r.muted) parts.push('已静音');
      if (r && r.elapsed) parts.push('耗时 ' + r.elapsed + 's');
      stat.textContent = '检查完成 ' + new Date().toLocaleTimeString('zh-CN') +
                         (parts.length ? '（' + parts.join('，') + '）' : '');
      stat.style.color = '#16a34a';
    }
  } catch (e){
    stat.textContent = '检查异常：' + e.message;
    stat.style.color = '#dc2626';
  }
}

// ============================================================
// 配置导入/导出
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
  } else stat.textContent = '';
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
  await msgBox('配置导入完成。\n\n由于账号/服务器可能已变，建议点「保存并重连」重新登录。', '导入完成');
  await loadConfigToUI();
  renderLive();
  renderRuleTable();
  renderDevices();
  loadMailToUI();
  renderVars();
  if (window.__canvasReloadVars) window.__canvasReloadVars();
}

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
bind('btnLiveExpandAll', () => { liveCollapse = {}; renderLive(); });
bind('btnLiveCollapseAll', () => {
  liveCollapse = {};
  for (const p of livePointsCache){
    liveCollapse[liveDeviceMap[p.tag]] = true;
  }
  renderLive();
});
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
bind('btnMailUnmute', unmuteMail);
bind('btnMailCheckNow', checkMailNow);
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

// 环境变量页按钮
bind('btnVarAdd', addVarRow);
bind('btnVarReload', renderVars);
bind('btnVarSave', saveVars);

document.getElementById('testCancel').addEventListener('click', () => {
  document.getElementById('testModal').style.display = 'none';
});
document.getElementById('testRun').addEventListener('click', runTestRule);
document.getElementById('testValue').addEventListener('keydown', e => {
  if (e.key === 'Enter') runTestRule();
});

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
  renderVars();
});

setInterval(() => {
  const page = document.getElementById('page-mail');
  if (page && page.classList.contains('active')){
    refreshMuteStatus();
  }
}, 10000);

// ============================================================
// 启动
// ============================================================
loadConfigToUI();
renderLive();
canvasInitBindings();
document.getElementById('appVer').textContent = '1.0.0';