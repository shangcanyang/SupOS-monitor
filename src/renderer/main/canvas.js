// ============================================================
// 画布状态
// ============================================================
const CS = {
  rules: [],
  currentId: null,
  linking: null,
  tags: [],
  tagMap: {},
  varNames: []
};

function newCanvasRule(){
  return {
    id: 'cr_' + Date.now(),
    name: '规则' + (CS.rules.length + 1),
    enabled: true,
    duration: 0,
    cooldown: 10,
    nodes: [],
    links: []
  };
}
function currentRule(){ return CS.rules.find(r => r.id === CS.currentId); }
function nodeById(id){ return currentRule()?.nodes.find(n => n.id === id); }

const NODE_META = {
  // 数据源
  tag:       { label: '位号取值', icon: '📈' },
  bool:      { label: '布尔位号', icon: '🔘' },
  tagStatus: { label: '位号质量', icon: '✔' },
  constN:    { label: '常量',     icon: '#' },
  // 判断
  compare:   { label: '比较',     icon: '⇄' },
  range:     { label: '区间',     icon: '↔' },
  deviation: { label: '偏差',     icon: '≶' },
  rate:      { label: '变化率',   icon: '↗' },
  textCmp:   { label: '文本判断', icon: '🔤' },
  // 逻辑
  logic:     { label: '逻辑',     icon: '⋀' },
  not:       { label: '非',       icon: '!' },
  xor:       { label: '异或',     icon: '⊕' },
  // 流程
  if:        { label: '条件分支', icon: '◈' },
  merge:     { label: '合并分支', icon: '⧉' },
  // 时间
  duration:  { label: '持续时间', icon: '⏱' },
  delay:     { label: '延时',     icon: '⏳' },
  hold:      { label: '保持',     icon: '⏸' },
  pulse:     { label: '脉冲',     icon: '⚡' },
  timeRange: { label: '时间段',   icon: '🕐' },
  // 状态
  latch:     { label: '锁存',     icon: '🔒' },
  toggle:    { label: '翻转',     icon: '🔁' },
  edge:      { label: '边沿',     icon: '📐' },
  counter:   { label: '计数',     icon: '🔢' },
  // 运算
  arith:     { label: '算术运算', icon: '±' },
  mathFn:    { label: '数学函数', icon: 'ƒ' },
  scale:     { label: '线性映射', icon: '⤢' },
  stat:      { label: '窗口统计', icon: 'Σ' },
  // 变量
  varGet:    { label: '读变量',   icon: 'R' },
  varSet:    { label: '写变量',   icon: 'W' },
  // 触发
  trigger:   { label: '触发报警', icon: '🔔' }
};

// ============================================================
// 加载
// ============================================================
async function canvasLoad(){
  try {
    const tagData = await window.api.loadTags();
    CS.tags = (tagData.points || []).map(p => p.tag);
    CS.tagMap = {};
    (tagData.points || []).forEach(p => {
      CS.tagMap[p.tag] = { desc: p.desc || '', unit: p.unit || '' };
    });
  } catch (e) { CS.tags = []; CS.tagMap = {}; }

  try {
    const vr = await window.api.loadVars();
    CS.varNames = (vr.vars || []).map(v => v.name);
  } catch (e) { CS.varNames = []; }

  const r = await window.api.canvasLoad();
  CS.rules = r.rules || [];
  if (!CS.rules.length) CS.rules.push(newCanvasRule());
  CS.currentId = CS.rules[0].id;
  renderRuleSelect();
  renderCanvas();
}

async function canvasSave(){
  syncPropsToRule();
  const r = await window.api.canvasSave(CS.rules);
  if (r.ok) await msgBox('画布规则已保存。', '保存成功');
}

// ============================================================
// 位号模糊搜索
// ============================================================
function fuzzyMatchTags(query, limit){
  limit = limit || 30;
  const q = String(query || '').trim().toLowerCase();
  if (!q) return CS.tags.slice(0, limit);
  const out = [];
  for (let i = 0; i < CS.tags.length && out.length < limit; i++){
    const t = CS.tags[i];
    if (t.toLowerCase().indexOf(q) >= 0) out.push(t);
  }
  if (out.length < limit){
    for (let i = 0; i < CS.tags.length && out.length < limit; i++){
      const t = CS.tags[i];
      if (out.indexOf(t) >= 0) continue;
      const info = CS.tagMap[t] || {};
      if (info.desc && info.desc.toLowerCase().indexOf(q) >= 0) out.push(t);
    }
  }
  return out;
}

function tagDropdownHtml(query){
  const list = fuzzyMatchTags(query, 30);
  if (!CS.tags.length){
    return '<div class="tag-dropdown-empty">尚未导入位号，请到「规则配置」先导入</div>';
  }
  if (!list.length){
    return '<div class="tag-dropdown-empty">未匹配到位号</div>';
  }
  return list.map(t => {
    const info = CS.tagMap[t] || {};
    return '<div class="tag-dropdown-item" data-tag="' + esc(t) + '">' +
      '<div class="td-tag">' + esc(t) + '</div>' +
      (info.desc || info.unit
        ? '<div class="td-meta">' + esc(info.desc || '') +
          (info.unit ? ' · ' + esc(info.unit) : '') + '</div>'
        : '') +
    '</div>';
  }).join('');
}

function bindTagPicker(input, node){
  let dropdown = null;
  const closeDropdown = () => {
    if (dropdown && dropdown.parentNode) dropdown.parentNode.removeChild(dropdown);
    dropdown = null;
  };
  const pickTag = (tag) => {
    input.value = tag;
    node.tag = tag;
    const info = CS.tagMap[tag] || {};
    if (info.desc && !node.desc) node.desc = info.desc;
    if (info.unit && !node.unit) node.unit = info.unit;
    closeDropdown();
    const host = input.closest('.cnode');
    if (host){
      const kind = host.querySelector('.cnode-hd .kind');
      if (kind) kind.textContent = tag.length > 12 ? tag.slice(-12) : tag;
      const descEl = host.querySelector('.n-desc');
      if (descEl && info.desc) descEl.textContent = info.desc;
    }
  };
  const bindItems = () => {
    if (!dropdown) return;
    dropdown.querySelectorAll('.tag-dropdown-item').forEach(item => {
      item.addEventListener('mousedown', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        pickTag(item.getAttribute('data-tag'));
      });
    });
  };
  const openDropdown = () => {
    closeDropdown();
    dropdown = document.createElement('div');
    dropdown.className = 'tag-dropdown';
    dropdown.innerHTML = tagDropdownHtml(input.value);
    const host = input.closest('.cnode');
    if (!host) return;
    host.appendChild(dropdown);
    const r = input.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    dropdown.style.left = (r.left - hr.left) + 'px';
    dropdown.style.top  = (r.bottom - hr.top + 3) + 'px';
    dropdown.style.width = r.width + 'px';
    bindItems();
  };
  input.addEventListener('focus', openDropdown);
  input.addEventListener('input', () => {
    if (!dropdown) openDropdown();
    else { dropdown.innerHTML = tagDropdownHtml(input.value); bindItems(); }
  });
  input.addEventListener('blur', () => { setTimeout(closeDropdown, 150); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDropdown(); });
}

// ============================================================
// 规则下拉 / 属性框
// ============================================================
function renderRuleSelect(){
  const sel = document.getElementById('canvasRuleSelect');
  sel.innerHTML = CS.rules.map(r =>
    '<option value="' + r.id + '">' + esc(r.name) + (r.enabled ? '' : '（停用）') + '</option>'
  ).join('');
  sel.value = CS.currentId;
}

function renderProps(rule){
  const p = document.getElementById('canvasProps');
  if (!rule){ p.innerHTML = ''; return; }
  const hold = rule.hold || 'auto';
  p.innerHTML =
    '<label>规则名</label><input type="text" id="crName" value="' + esc(rule.name) + '">' +
    '<label>持续(s)</label><input type="number" id="crDur" value="' + (rule.duration || 0) + '" min="0">' +
    '<label>报警保持</label><select id="crHold">' +
      '<option value="auto"' + (hold === 'auto' ? ' selected' : '') + '>自动复位（条件恢复即消除）</option>' +
      '<option value="timed"' + (hold === 'timed' ? ' selected' : '') + '>延时复位（恢复后保持 N 秒）</option>' +
      '<option value="latch"' + (hold === 'latch' ? ' selected' : '') + '>保持到人工确认</option>' +
    '</select>' +
    '<label>保持(s)</label><input type="number" id="crHoldSec" value="' + (rule.holdSeconds || 0) + '" min="0">' +
    '<label>冷却(min)</label><input type="number" id="crCd" value="' + (rule.cooldown || 10) + '" min="1">' +
    '<label><input type="checkbox" id="crEn"' + (rule.enabled ? ' checked' : '') + '> 启用</label>' +
    '<div class="n-tip">冷却=条件持续成立时的重复提醒间隔。保持到人工确认需在报警弹窗点「确认复位」。</div>';
  document.getElementById('crName').addEventListener('change', e => {
    rule.name = e.target.value.trim() || rule.name;
    renderRuleSelect();
  });
  document.getElementById('crDur').addEventListener('change', e => {
    rule.duration = Number(e.target.value) || 0;
  });
  document.getElementById('crHold').addEventListener('change', e => {
    rule.hold = e.target.value;
  });
  document.getElementById('crHoldSec').addEventListener('change', e => {
    rule.holdSeconds = Number(e.target.value) || 0;
  });
  document.getElementById('crCd').addEventListener('change', e => {
    rule.cooldown = Number(e.target.value) || 10;
  });
  document.getElementById('crEn').addEventListener('change', e => {
    rule.enabled = e.target.checked;
    renderRuleSelect();
  });
}

function syncPropsToRule(){
  const rule = currentRule();
  if (!rule) return;
  const n = document.getElementById('crName');
  if (n) rule.name = n.value.trim() || rule.name;
  const d = document.getElementById('crDur');
  if (d) rule.duration = Number(d.value) || 0;
  const h = document.getElementById('crHold');
  if (h) rule.hold = h.value;
  const hs = document.getElementById('crHoldSec');
  if (hs) rule.holdSeconds = Number(hs.value) || 0;
  const c = document.getElementById('crCd');
  if (c) rule.cooldown = Number(c.value) || 10;
  const e = document.getElementById('crEn');
  if (e) rule.enabled = e.checked;
}

// ============================================================
// 渲染画布
// ============================================================
function renderCanvas(){
  const rule = currentRule();
  if (!rule) return;
  renderRuleSelect();
  renderProps(rule);

  const nodesBox = document.getElementById('canvasNodes');
  nodesBox.innerHTML = rule.nodes.map(n => nodeHtml(n)).join('');

  rule.nodes.forEach(n => {
    const el = nodesBox.querySelector('.cnode[data-id="' + n.id + '"]');
    if (!el) return;
    bindNodeDrag(n, el);
    if (n.type === 'tag' || n.type === 'bool' || n.type === 'tagStatus'){
      const input = el.querySelector('input[data-field="tag"]');
      if (input) bindTagPicker(input, n);
    }
  });

  nodesBox.querySelectorAll('.cnode-del').forEach(d => {
    d.addEventListener('click', e => {
      e.stopPropagation();
      const id = d.getAttribute('data-del');
      rule.nodes = rule.nodes.filter(n => n.id !== id);
      rule.links = rule.links.filter(l => l.from !== id && l.to !== id);
      renderCanvas();
    });
  });

  nodesBox.querySelectorAll('.c-port-out').forEach(p => {
    p.addEventListener('mousedown', e => {
      e.stopPropagation();
      e.preventDefault();
      const fromId = p.getAttribute('data-node');
      const fromPort = p.getAttribute('data-port') || 'out';
      startLinkDrag(fromId, fromPort, p);
    });
  });

  nodesBox.querySelectorAll('.c-port-in').forEach(p => {
    p.addEventListener('mouseup', e => {
      e.stopPropagation();
      e.preventDefault();
      if (!CS.linking) return;
      const toId = p.getAttribute('data-node');
      const toPort = p.getAttribute('data-port') || 'in';
      finishLink(CS.linking.fromId, CS.linking.fromPort, toId, toPort);
    });
  });

  nodesBox.querySelectorAll('.cnode input, .cnode select').forEach(el => {
    if (el.getAttribute('data-field') === 'tag') return;
    el.addEventListener('change', () => {
      const id = el.getAttribute('data-nid');
      const field = el.getAttribute('data-field');
      const n = nodeById(id);
      if (!n) return;
      const t = el.getAttribute('data-ntype');
      if (el.type === 'checkbox'){
        n[field] = el.checked;
      } else if (t === 'num' || el.type === 'number'){
        n[field] = el.value === '' ? '' : Number(el.value);
      } else {
        n[field] = el.value;
      }
      if (n.type === 'varSet' && field === 'mode') renderCanvas();
      if (n.type === 'constN' && field === 'valueType') renderCanvas();
      if (n.type === 'mathFn' && field === 'fn') renderCanvas();
    });
  });

  setTimeout(updateLinks, 0);
}

// ============================================================
// 拖拽连线
// ============================================================
function startLinkDrag(fromId, fromPort, portEl){
  const container = document.getElementById('canvasNodes');
  const cr = container.getBoundingClientRect();
  const pr = portEl.getBoundingClientRect();
  const from = {
    x: pr.left - cr.left + pr.width / 2,
    y: pr.top - cr.top + pr.height / 2
  };

  CS.linking = { fromId, fromPort, fromPos: from, cur: from };
  portEl.classList.add('active');
  document.getElementById('canvasArea').classList.add('linking');

  const svg = document.getElementById('canvasLinks');
  let rubber = document.getElementById('rubberLine');
  if (!rubber){
    rubber = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    rubber.setAttribute('id', 'rubberLine');
    rubber.setAttribute('class', 'rubber-line');
    svg.appendChild(rubber);
  }

  const drawRubber = () => {
    const p1 = CS.linking.fromPos;
    const p2 = CS.linking.cur;
    const dx = Math.max(60, Math.abs(p2.x - p1.x) / 2);
    const d = 'M ' + p1.x + ' ' + p1.y +
              ' C ' + (p1.x + dx) + ' ' + p1.y + ', ' +
                       (p2.x - dx) + ' ' + p2.y + ', ' +
                       p2.x + ' ' + p2.y;
    rubber.setAttribute('d', d);
  };
  drawRubber();

  const onMove = ev => {
    const r = container.getBoundingClientRect();
    CS.linking.cur = { x: ev.clientX - r.left, y: ev.clientY - r.top };
    drawRubber();
    document.querySelectorAll('.c-port-in.hover-target').forEach(el => el.classList.remove('hover-target'));
    const target = document.elementFromPoint(ev.clientX, ev.clientY);
    if (target && target.classList.contains('c-port-in')){
      target.classList.add('hover-target');
    }
  };

  const onUp = ev => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    portEl.classList.remove('active');
    document.getElementById('canvasArea').classList.remove('linking');
    document.querySelectorAll('.c-port-in.hover-target').forEach(el => el.classList.remove('hover-target'));
    if (rubber && rubber.parentNode) rubber.parentNode.removeChild(rubber);

    const target = document.elementFromPoint(ev.clientX, ev.clientY);
    if (target && target.classList.contains('c-port-in')){
      const toId = target.getAttribute('data-node');
      const toPort = target.getAttribute('data-port') || 'in';
      finishLink(fromId, fromPort, toId, toPort);
    } else {
      CS.linking = null;
    }
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function finishLink(fromId, fromPort, toId, toPort){
  const rule = currentRule();
  if (!rule) return;
  CS.linking = null;
  if (fromId === toId) return;
  rule.links = rule.links.filter(l =>
    !(l.from === fromId && l.to === toId &&
      (l.fromPort || 'out') === fromPort && (l.toPort || 'in') === toPort)
  );
  rule.links.push({ from: fromId, fromPort, to: toId, toPort });
  renderCanvas();
}

// ============================================================
// 端口 / 节点 HTML
// ============================================================
function portHtml(nId, kind, port){
  // kind: 'out' | 'in'
  if (kind === 'out'){
    let topPct = '50%';
    let extra = '';
    if (port === 'out_true')  { topPct = '35%'; extra = ' port-true'; }
    if (port === 'out_false') { topPct = '65%'; extra = ' port-false'; }
    return '<div class="c-port c-port-out' + extra +
           '" data-node="' + nId + '" data-port="' + port +
           '" style="top:' + topPct + '"></div>';
  }
  let topPct = '50%';
  if (port === 'in1')  topPct = '30%';
  if (port === 'in2')  topPct = '70%';
  if (port === 'in')   topPct = '30%';
  if (port === 'cond') topPct = '70%';
  return '<div class="c-port c-port-in" data-node="' + nId +
         '" data-port="' + port + '" style="top:' + topPct + '"></div>';
}

function nodeHtml(n){
  const meta = NODE_META[n.type] || { label: n.type, icon: '?' };
  let body = '';
  let ports = '';

  const outSingle = portHtml(n.id, 'out', 'out');
  const inSingle = portHtml(n.id, 'in', 'in');
  const in1 = portHtml(n.id, 'in', 'in1');
  const in2 = portHtml(n.id, 'in', 'in2');

  if (n.type === 'tag' || n.type === 'bool' || n.type === 'tagStatus'){
    const ph = n.type === 'bool' ? '输入关键字搜索布尔位号…' : '输入关键字搜索位号…';
    const info = n.tag ? (CS.tagMap[n.tag] || {}) : {};
    body =
      '<div class="tag-picker-wrap">' +
        '<input type="text" class="tag-input" data-nid="' + n.id +
          '" data-field="tag" value="' + esc(n.tag || '') +
          '" placeholder="' + ph + '" autocomplete="off">' +
      '</div>' +
      (info.desc ? '<div class="n-desc">' + esc(info.desc) + '</div>' : '') +
      (n.type === 'tagStatus' ? '<div class="n-tip">质量正常输出 true</div>' : '');
    ports = outSingle;
  }
  else if (n.type === 'compare'){
    body =
      '<div class="row"><label>运算</label>' +
      '<select data-nid="' + n.id + '" data-field="op">' +
        ['>=','>','<=','<','==','!='].map(o =>
          '<option value="' + o + '"' + (n.op === o ? ' selected' : '') + '>' + o + '</option>'
        ).join('') +
      '</select></div>' +
      '<div class="row"><label>阈值</label>' +
      '<input type="number" step="any" data-nid="' + n.id + '" data-field="value" data-ntype="num" value="' +
        (n.value == null ? '' : n.value) + '"></div>';
    ports = inSingle + outSingle;
  }
  else if (n.type === 'range'){
    body =
      '<div class="row"><label>下限</label>' +
      '<input type="number" step="any" data-nid="' + n.id + '" data-field="min" data-ntype="num" value="' +
        (n.min == null ? '' : n.min) + '"></div>' +
      '<div class="row"><label>上限</label>' +
      '<input type="number" step="any" data-nid="' + n.id + '" data-field="max" data-ntype="num" value="' +
        (n.max == null ? '' : n.max) + '"></div>';
    ports = inSingle + outSingle;
  }
  else if (n.type === 'deviation'){
    body =
      '<div class="row"><label>基准</label>' +
      '<input type="number" step="any" data-nid="' + n.id + '" data-field="base" data-ntype="num" value="' +
        (n.base == null ? '' : n.base) + '"></div>' +
      '<div class="row"><label>阈值</label>' +
      '<input type="number" step="any" data-nid="' + n.id + '" data-field="threshold" data-ntype="num" value="' +
        (n.threshold == null ? '' : n.threshold) + '"></div>' +
      '<div class="n-tip">|值 - 基准| &gt; 阈值</div>';
    ports = inSingle + outSingle;
  }
  else if (n.type === 'rate'){
    body =
      '<div class="row"><label>窗口(s)</label>' +
      '<input type="number" data-nid="' + n.id + '" data-field="window" data-ntype="num" value="' +
        (n.window || 60) + '" min="1"></div>' +
      '<div class="row"><label>变化阈值</label>' +
      '<input type="number" step="any" data-nid="' + n.id + '" data-field="threshold" data-ntype="num" value="' +
        (n.threshold == null ? '' : n.threshold) + '"></div>' +
      '<div class="n-tip">窗口内变化量 &gt; 阈值</div>';
    ports = inSingle + outSingle;
  }
  else if (n.type === 'logic'){
    body =
      '<div class="row"><label>运算</label>' +
      '<select data-nid="' + n.id + '" data-field="op">' +
        '<option value="AND"' + (n.op === 'AND' ? ' selected' : '') + '>AND 且</option>' +
        '<option value="OR"'  + (n.op === 'OR'  ? ' selected' : '') + '>OR 或</option>' +
      '</select></div>';
    ports = in1 + in2 + outSingle;
  }
  else if (n.type === 'not'){
    body = '<div class="n-tip">输入取反</div>';
    ports = inSingle + outSingle;
  }
  else if (n.type === 'xor'){
    body = '<div class="n-tip">两输入不同输出 true</div>';
    ports = in1 + in2 + outSingle;
  }
  else if (n.type === 'duration'){
    body =
      '<div class="row"><label>持续(s)</label>' +
      '<input type="number" data-nid="' + n.id + '" data-field="seconds" data-ntype="num" value="' +
        (n.seconds || 5) + '" min="0"></div>' +
      '<div class="n-tip">连续为 true 超过 N 秒输出</div>';
    ports = inSingle + outSingle;
  }
  else if (n.type === 'delay'){
    body =
      '<div class="row"><label>延时(s)</label>' +
      '<input type="number" data-nid="' + n.id + '" data-field="seconds" data-ntype="num" value="' +
        (n.seconds || 5) + '" min="0"></div>' +
      '<div class="n-tip">输入 true 后延时 N 秒输出</div>';
    ports = inSingle + outSingle;
  }
  else if (n.type === 'timeRange'){
    body =
      '<div class="row"><label>起</label>' +
      '<input type="text" data-nid="' + n.id + '" data-field="start" value="' +
        esc(n.start || '08:00') + '" placeholder="HH:MM"></div>' +
      '<div class="row"><label>止</label>' +
      '<input type="text" data-nid="' + n.id + '" data-field="end" value="' +
        esc(n.end || '18:00') + '" placeholder="HH:MM"></div>' +
      '<div class="n-tip">当前时间在 [起,止) 内输出 true</div>';
    ports = outSingle;
  }
  else if (n.type === 'varGet'){
    if (!CS.varNames.length){
      body = '<div class="n-tip" style="color:#f59e0b">未创建变量，请到「环境变量」页添加</div>';
    } else {
      body = '<div class="row"><label>变量名</label>' +
        '<select data-nid="' + n.id + '" data-field="name">' +
          ['<option value="">— 请选择 —</option>'].concat(
            CS.varNames.map(nm =>
              '<option value="' + esc(nm) + '"' +
              (n.name === nm ? ' selected' : '') + '>' + esc(nm) + '</option>'
            )
          ).join('') +
        '</select></div>';
    }
    ports = outSingle;
  }
  else if (n.type === 'varSet'){
    const mode = n.mode || 'input';
    if (!CS.varNames.length){
      body = '<div class="n-tip" style="color:#f59e0b">未创建变量，请到「环境变量」页添加</div>';
    } else {
      body =
        '<div class="row"><label>变量名</label>' +
          '<select data-nid="' + n.id + '" data-field="name">' +
            ['<option value="">— 请选择 —</option>'].concat(
              CS.varNames.map(nm =>
                '<option value="' + esc(nm) + '"' +
                (n.name === nm ? ' selected' : '') + '>' + esc(nm) + '</option>'
              )
            ).join('') +
          '</select>' +
        '</div>' +
        '<div class="row"><label>模式</label>' +
          '<select data-nid="' + n.id + '" data-field="mode">' +
            '<option value="input"' + (mode === 'input' ? ' selected' : '') + '>由输入决定</option>' +
            '<option value="fixed"' + (mode === 'fixed' ? ' selected' : '') + '>固定值</option>' +
          '</select>' +
        '</div>' +
        (mode === 'fixed'
          ? '<div class="row"><label>固定值</label>' +
              '<input type="text" data-nid="' + n.id + '" data-field="value" value="' +
                esc(n.value == null ? '' : n.value) + '" placeholder="1 或 报警"></div>' +
            '<div class="row"><label>类型</label>' +
              '<select data-nid="' + n.id + '" data-field="valueType">' +
                '<option value="number"' + (n.valueType !== 'string' ? ' selected' : '') + '>数值</option>' +
                '<option value="string"' + (n.valueType === 'string' ? ' selected' : '') + '>文本</option>' +
              '</select>' +
            '</div>'
          : '<div class="n-tip">把输入写入变量，并继续往后传</div>'
        );
    }
    ports = (mode === 'fixed' ? inSingle : inSingle) + outSingle;
  }
  else if (n.type === 'if'){
    body =
      '<div class="n-tip">信号+条件 → 真/假 两出口</div>' +
      '<div class="if-labels">' +
        '<span class="if-yes">真 → 上</span>' +
        '<span class="if-no">假 → 下</span>' +
      '</div>';
    ports =
      portHtml(n.id, 'in', 'in') +
      portHtml(n.id, 'in', 'cond') +
      portHtml(n.id, 'out', 'out_true') +
      portHtml(n.id, 'out', 'out_false');
  }
  else if (n.type === 'merge'){
    body = '<div class="n-tip">任一输入为 true 则输出 true</div>';
    ports = in1 + in2 + outSingle;
  }
  else if (n.type === 'constN'){
    const vt = n.valueType || 'number';
    body =
      '<div class="row"><label>类型</label>' +
        '<select data-nid="' + n.id + '" data-field="valueType">' +
          [['number', '数值'], ['bool', '布尔'], ['string', '文本']].map(([v, t]) =>
            '<option value="' + v + '"' + (vt === v ? ' selected' : '') + '>' + t + '</option>'
          ).join('') +
        '</select>' +
      '</div>' +
      (vt === 'bool'
        ? '<div class="row"><label>值</label>' +
            '<select data-nid="' + n.id + '" data-field="value">' +
              '<option value="true"' + (String(n.value) === 'true' ? ' selected' : '') + '>true</option>' +
              '<option value="false"' + (String(n.value) !== 'true' ? ' selected' : '') + '>false</option>' +
            '</select></div>'
        : '<div class="row"><label>值</label>' +
            '<input type="text" data-nid="' + n.id + '" data-field="value" value="' +
            esc(n.value === undefined || n.value === null ? '' : n.value) + '"></div>') +
      '<div class="n-tip">常量可作为比较阈值、运算操作数或映射输入</div>';
    ports = outSingle;
  }
  else if (n.type === 'textCmp'){
    const op = n.op || 'eq';
    body =
      '<div class="row"><label>方式</label>' +
        '<select data-nid="' + n.id + '" data-field="op">' +
          [['eq', '等于'], ['ne', '不等于'], ['contains', '包含'], ['notContains', '不包含'],
           ['startsWith', '开头是'], ['endsWith', '结尾是'], ['empty', '为空'],
           ['notEmpty', '不为空'], ['regex', '正则匹配']].map(([v, t]) =>
            '<option value="' + v + '"' + (op === v ? ' selected' : '') + '>' + t + '</option>'
          ).join('') +
        '</select>' +
      '</div>' +
      '<div class="row"><label>文本</label>' +
        '<input type="text" data-nid="' + n.id + '" data-field="value" value="' +
        esc(n.value === undefined || n.value === null ? '' : n.value) + '"></div>' +
      '<label><input type="checkbox" data-nid="' + n.id + '" data-field="ignoreCase"' +
        (n.ignoreCase ? ' checked' : '') + '> 忽略大小写</label>';
    ports = inSingle + outSingle;
  }
  else if (n.type === 'hold'){
    body =
      '<div class="row"><label>保持(s)</label>' +
        '<input type="number" data-nid="' + n.id + '" data-field="seconds" value="' + (n.seconds || 5) + '" min="1"></div>' +
      '<div class="n-tip">输入变真立即输出真；输入转假后再保持 N 秒</div>';
    ports = inSingle + outSingle;
  }
  else if (n.type === 'pulse'){
    body =
      '<div class="row"><label>时长(s)</label>' +
        '<input type="number" data-nid="' + n.id + '" data-field="seconds" value="' + (n.seconds || 3) + '" min="1"></div>' +
      '<div class="n-tip">每次输入上升沿输出一个固定时长脉冲</div>';
    ports = inSingle + outSingle;
  }
  else if (n.type === 'latch'){
    const op = n.op || 'sr';
    body =
      '<div class="row"><label>优先级</label>' +
        '<select data-nid="' + n.id + '" data-field="op">' +
          '<option value="sr"' + (op === 'sr' ? ' selected' : '') + '>置位优先</option>' +
          '<option value="rs"' + (op === 'rs' ? ' selected' : '') + '>复位优先</option>' +
        '</select>' +
      '</div>' +
      '<div class="n-tip">上=置位 S，下=复位 R；输出保持到下次动作</div>';
    ports = in1 + in2 + outSingle;
  }
  else if (n.type === 'toggle'){
    body = '<div class="n-tip">上=翻转（每次上升沿改变输出），下=复位</div>';
    ports = in1 + in2 + outSingle;
  }
  else if (n.type === 'edge'){
    const dir = n.dir || 'rise';
    body =
      '<div class="row"><label>方向</label>' +
        '<select data-nid="' + n.id + '" data-field="dir">' +
          '<option value="rise"' + (dir === 'rise' ? ' selected' : '') + '>上升沿</option>' +
          '<option value="fall"' + (dir === 'fall' ? ' selected' : '') + '>下降沿</option>' +
          '<option value="both"' + (dir === 'both' ? ' selected' : '') + '>任意变化</option>' +
        '</select>' +
      '</div>' +
      '<div class="n-tip">检测到变化时输出 1 个扫描周期</div>';
    ports = inSingle + outSingle;
  }
  else if (n.type === 'counter'){
    const mode = n.mode || 'bool';
    body =
      '<div class="row"><label>目标</label>' +
        '<input type="number" data-nid="' + n.id + '" data-field="target" value="' + (n.target || 3) + '" min="1"></div>' +
      '<div class="row"><label>输出</label>' +
        '<select data-nid="' + n.id + '" data-field="mode">' +
          '<option value="bool"' + (mode === 'bool' ? ' selected' : '') + '>达到目标输出 true</option>' +
          '<option value="pulse"' + (mode === 'pulse' ? ' selected' : '') + '>每满 N 次输出脉冲</option>' +
          '<option value="value"' + (mode === 'value' ? ' selected' : '') + '>输出当前次数</option>' +
        '</select>' +
      '</div>' +
      '<div class="n-tip">上=计数（上升沿 +1），下=清零</div>';
    ports = in1 + in2 + outSingle;
  }
  else if (n.type === 'arith'){
    const op = n.op || '+';
    body =
      '<div class="row"><label>运算</label>' +
        '<select data-nid="' + n.id + '" data-field="op">' +
          [['+', '加'], ['-', '减'], ['*', '乘'], ['/', '除'], ['%', '取余'],
           ['max', '取大'], ['min', '取小'], ['pow', '幂']].map(([v, t]) =>
            '<option value="' + v + '"' + (op === v ? ' selected' : '') + '>' + t + '</option>'
          ).join('') +
        '</select>' +
      '</div>' +
      '<div class="row"><label>常数</label>' +
        '<input type="text" data-nid="' + n.id + '" data-field="value" value="' +
        esc(n.value === undefined || n.value === null ? '' : n.value) + '"></div>' +
      '<div class="n-tip">下端口未接线时使用常数参与运算</div>';
    ports = in1 + in2 + outSingle;
  }
  else if (n.type === 'mathFn'){
    const fn = n.fn || 'abs';
    body =
      '<div class="row"><label>函数</label>' +
        '<select data-nid="' + n.id + '" data-field="fn">' +
          [['abs', '绝对值'], ['round', '四舍五入'], ['floor', '向下取整'], ['ceil', '向上取整'],
           ['sqrt', '平方根'], ['neg', '取负'], ['log10', 'log10'], ['ln', 'ln']].map(([v, t]) =>
            '<option value="' + v + '"' + (fn === v ? ' selected' : '') + '>' + t + '</option>'
          ).join('') +
        '</select>' +
      '</div>' +
      (fn === 'round'
        ? '<div class="row"><label>小数位</label>' +
            '<input type="number" data-nid="' + n.id + '" data-field="digits" value="' + (n.digits || 0) + '" min="0" max="6"></div>'
        : '');
    ports = inSingle + outSingle;
  }
  else if (n.type === 'scale'){
    body =
      '<div class="row"><label>输入范围</label>' +
        '<input type="text" data-nid="' + n.id + '" data-field="inMin" value="' + esc(n.inMin === undefined ? '' : n.inMin) + '" placeholder="最小">' +
        '<input type="text" data-nid="' + n.id + '" data-field="inMax" value="' + esc(n.inMax === undefined ? '' : n.inMax) + '" placeholder="最大">' +
      '</div>' +
      '<div class="row"><label>输出范围</label>' +
        '<input type="text" data-nid="' + n.id + '" data-field="outMin" value="' + esc(n.outMin === undefined ? '' : n.outMin) + '" placeholder="最小">' +
        '<input type="text" data-nid="' + n.id + '" data-field="outMax" value="' + esc(n.outMax === undefined ? '' : n.outMax) + '" placeholder="最大">' +
      '</div>' +
      '<label><input type="checkbox" data-nid="' + n.id + '" data-field="clamp"' +
        (n.clamp ? ' checked' : '') + '> 超出范围时截断</label>';
    ports = inSingle + outSingle;
  }
  else if (n.type === 'stat'){
    const fn = n.fn || 'avg';
    body =
      '<div class="row"><label>窗口(s)</label>' +
        '<input type="number" data-nid="' + n.id + '" data-field="window" value="' + (n.window || 60) + '" min="1"></div>' +
      '<div class="row"><label>统计</label>' +
        '<select data-nid="' + n.id + '" data-field="fn">' +
          [['avg', '平均值'], ['max', '最大值'], ['min', '最小值'], ['sum', '合计'],
           ['range', '极差'], ['std', '标准差']].map(([v, t]) =>
            '<option value="' + v + '"' + (fn === v ? ' selected' : '') + '>' + t + '</option>'
          ).join('') +
        '</select>' +
      '</div>' +
      '<div class="n-tip">按窗口滚动统计输入值，可再接比较节点判定</div>';
    ports = inSingle + outSingle;
  }
  else if (n.type === 'trigger'){
    body =
      '<div class="row"><label>级别</label>' +
      '<select data-nid="' + n.id + '" data-field="level">' +
        ['HH','H','L','LL'].map(x =>
          '<option value="' + x + '"' + (n.level === x ? ' selected' : '') + '>' + x + '</option>'
        ).join('') +
      '</select></div>';
    ports = inSingle;
  }

  let kindTxt = n.id.slice(-4);
  if ((n.type === 'tag' || n.type === 'bool' || n.type === 'tagStatus') && n.tag){
    kindTxt = n.tag.length > 12 ? n.tag.slice(-12) : n.tag;
  } else if ((n.type === 'varGet' || n.type === 'varSet') && n.name){
    kindTxt = n.name;
  }

  return '<div class="cnode type-' + n.type + '" data-id="' + n.id +
    '" style="left:' + n.x + 'px;top:' + n.y + 'px">' +
    '<div class="cnode-hd">' +
      '<span class="cnode-ico">' + meta.icon + '</span>' +
      '<span class="cnode-lbl">' + meta.label + '</span>' +
      '<span class="kind" title="' + esc(kindTxt) + '">' + esc(kindTxt) + '</span>' +
      '<span class="cnode-del" data-del="' + n.id + '" title="删除">×</span>' +
    '</div>' +
    '<div class="cnode-body">' + body + '</div>' +
    ports +
  '</div>';
}

// ============================================================
// 拖动节点
// ============================================================
function bindNodeDrag(n, el){
  if (!el) return;
  el.addEventListener('mousedown', e => {
    if (e.target.classList.contains('c-port')) return;
    if (e.target.classList.contains('cnode-del')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    const sx = e.clientX, sy = e.clientY;
    const nx0 = n.x, ny0 = n.y;
    el.classList.add('dragging-node');

    const move = ev => {
      n.x = Math.max(0, nx0 + ev.clientX - sx);
      n.y = Math.max(0, ny0 + ev.clientY - sy);
      el.style.left = n.x + 'px';
      el.style.top  = n.y + 'px';
      updateLinks();
    };
    const up = () => {
      el.classList.remove('dragging-node');
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

// ============================================================
// 连线：DOM 实测 + 双层 path
// ============================================================
function updateLinks(){
  const rule = currentRule();
  if (!rule) return;
  const svg = document.getElementById('canvasLinks');
  const container = document.getElementById('canvasNodes');
  if (!svg || !container) return;
  const rubber = document.getElementById('rubberLine');
  const cr = container.getBoundingClientRect();

  const lines = rule.links.map((l, i) => {
    const fp = l.fromPort || 'out';
    const tp = l.toPort || 'in';
    const fromEl = container.querySelector(
      '.cnode[data-id="' + l.from + '"] .c-port-out[data-port="' + fp + '"]'
    );
    if (!fromEl) return '';
    const toEl = container.querySelector(
      '.cnode[data-id="' + l.to + '"] .c-port-in[data-port="' + tp + '"]'
    );
    if (!toEl) return '';

    const r1 = fromEl.getBoundingClientRect();
    const r2 = toEl.getBoundingClientRect();
    const p1 = { x: r1.left - cr.left + r1.width / 2, y: r1.top - cr.top + r1.height / 2 };
    const p2 = { x: r2.left - cr.left + r2.width / 2, y: r2.top - cr.top + r2.height / 2 };
    const dx = Math.max(60, Math.abs(p2.x - p1.x) / 2);
    const d = 'M ' + p1.x + ' ' + p1.y +
              ' C ' + (p1.x + dx) + ' ' + p1.y + ', ' +
                       (p2.x - dx) + ' ' + p2.y + ', ' +
                       p2.x + ' ' + p2.y;
    return '<path class="link-hit" d="' + d + '" data-link="' + i + '"></path>' +
           '<path class="link-line" d="' + d + '"></path>';
  }).join('');

  svg.innerHTML = lines + (rubber ? rubber.outerHTML : '');

  svg.querySelectorAll('path.link-hit').forEach(p => {
    p.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const i = Number(p.getAttribute('data-link'));
      const rule = currentRule();
      if (!rule) return;
      rule.links.splice(i, 1);
      updateLinks();
    });
  });
}

// ============================================================
// 添加节点
// ============================================================
function makeNodeObj(type, x, y){
  const id = 'n' + Date.now() + Math.random().toString(36).slice(2, 5);
  const base = { id, type, x: Math.max(0, x), y: Math.max(0, y) };
  if (type === 'tag' || type === 'bool' || type === 'tagStatus') base.tag = '';
  else if (type === 'compare'){ base.op = '>='; base.value = ''; }
  else if (type === 'range'){ base.min = ''; base.max = ''; }
  else if (type === 'deviation'){ base.base = ''; base.threshold = ''; }
  else if (type === 'rate'){ base.window = 60; base.threshold = ''; }
  else if (type === 'logic') base.op = 'AND';
  else if (type === 'duration') base.seconds = 5;
  else if (type === 'delay') base.seconds = 5;
  else if (type === 'timeRange'){ base.start = '08:00'; base.end = '18:00'; }
  else if (type === 'varGet') base.name = '';
  else if (type === 'varSet'){ base.name = ''; base.mode = 'input'; base.value = ''; base.valueType = 'number'; }
  else if (type === 'constN'){ base.valueType = 'number'; base.value = ''; }
  else if (type === 'textCmp'){ base.op = 'eq'; base.value = ''; base.ignoreCase = false; }
  else if (type === 'hold') base.seconds = 5;
  else if (type === 'pulse') base.seconds = 3;
  else if (type === 'latch') base.op = 'sr';
  else if (type === 'edge') base.dir = 'rise';
  else if (type === 'counter'){ base.target = 3; base.mode = 'bool'; }
  else if (type === 'arith'){ base.op = '+'; base.value = 0; }
  else if (type === 'mathFn'){ base.fn = 'abs'; base.digits = 0; }
  else if (type === 'scale'){ base.inMin = 0; base.inMax = 100; base.outMin = 0; base.outMax = 100; base.clamp = false; }
  else if (type === 'stat'){ base.window = 60; base.fn = 'avg'; }
  else if (type === 'trigger') base.level = 'HH';
  return base;
}

function addNodeAt(type, x, y){
  const rule = currentRule();
  if (!rule) return;
  rule.nodes.push(makeNodeObj(type, x, y));
  renderCanvas();
}

// ============================================================
// 侧边栏拖拽
// ============================================================
function bindSideItems(){
  const side = document.getElementById('canvasSide');
  const area = document.getElementById('canvasArea');
  if (!side || !area) return;
  side.querySelectorAll('.side-item').forEach(item => {
    item.addEventListener('mousedown', e => {
      e.preventDefault();
      const type = item.getAttribute('data-type');
      if (!type) return;
      startDragCreate(type, e);
    });
  });
}

function startDragCreate(type, downEvent){
  const area = document.getElementById('canvasArea');
  const meta = NODE_META[type] || { label: type, icon: '?' };
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.innerHTML = '<span class="ico">' + (meta.icon || '') + '</span>' + meta.label;
  ghost.style.left = downEvent.clientX + 'px';
  ghost.style.top  = downEvent.clientY + 'px';
  document.body.appendChild(ghost);

  const startX = downEvent.clientX;
  const startY = downEvent.clientY;
  let moved = false;

  const move = ev => {
    if (!moved && (Math.abs(ev.clientX - startX) > 4 || Math.abs(ev.clientY - startY) > 4)){
      moved = true;
    }
    ghost.style.left = ev.clientX + 'px';
    ghost.style.top  = ev.clientY + 'px';
    const r = area.getBoundingClientRect();
    const inside = ev.clientX >= r.left && ev.clientX <= r.right &&
                   ev.clientY >= r.top  && ev.clientY <= r.bottom;
    ghost.classList.toggle('over', inside);
    area.classList.toggle('drop-target', inside);
  };

  const up = ev => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    ghost.remove();
    area.classList.remove('drop-target');
    const r = area.getBoundingClientRect();
    const inside = ev.clientX >= r.left && ev.clientX <= r.right &&
                   ev.clientY >= r.top  && ev.clientY <= r.bottom;
    if (!moved){ addNodeAt(type, r.width / 2 - 100, r.height / 2 - 40); return; }
    if (inside){
      addNodeAt(type, ev.clientX - r.left - 100, ev.clientY - r.top - 30);
    }
  };

  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

// ============================================================
// 初始化
// ============================================================
function canvasInitBindings(){
  document.getElementById('canvasRuleSelect').addEventListener('change', e => {
    CS.currentId = e.target.value;
    CS.linking = null;
    renderCanvas();
  });
  document.getElementById('btnCanvasNew').addEventListener('click', () => {
    const r = newCanvasRule();
    CS.rules.push(r);
    CS.currentId = r.id;
    renderRuleSelect();
    renderCanvas();
  });
  document.getElementById('btnCanvasDelete').addEventListener('click', async () => {
    if (CS.rules.length <= 1){ await msgBox('至少保留一个规则。'); return; }
    const r = currentRule();
    const ok = await confirmBox('删除规则「' + r.name + '」？', '删除确认');
    if (!ok) return;
    CS.rules = CS.rules.filter(x => x.id !== r.id);
    CS.currentId = CS.rules[0].id;
    renderRuleSelect();
    renderCanvas();
  });
  document.getElementById('btnCanvasSave').addEventListener('click', canvasSave);
  document.getElementById('canvasArea').addEventListener('mousedown', e => {
    if (e.target.id === 'canvasArea' || e.target.id === 'canvasNodes'){
      CS.linking = null;
      document.getElementById('canvasArea').classList.remove('linking');
    }
  });
  bindSideItems();
  window.addEventListener('resize', () => setTimeout(updateLinks, 0));
}

window.__canvasReloadVars = async function(){
  try {
    const vr = await window.api.loadVars();
    CS.varNames = (vr.vars || []).map(v => v.name);
  } catch (e) { CS.varNames = []; }
};