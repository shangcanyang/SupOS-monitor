// ============================================================
// 画布状态
// ============================================================
const CS = { rules: [], currentId: null, linking: null, selected: null };

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

// ============================================================
// 加载 / 保存
// ============================================================
async function canvasLoad(){
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
// 规则下拉
// ============================================================
function renderRuleSelect(){
  const sel = document.getElementById('canvasRuleSelect');
  sel.innerHTML = CS.rules.map(r =>
    '<option value="' + r.id + '">' + esc(r.name) + (r.enabled ? '' : '（停用）') + '</option>'
  ).join('');
  sel.value = CS.currentId;
}

// ============================================================
// 属性框
// ============================================================
function renderProps(rule){
  const p = document.getElementById('canvasProps');
  if (!rule){ p.innerHTML = ''; return; }
  p.innerHTML =
    '<label>规则名</label><input type="text" id="crName" value="' + esc(rule.name) + '">' +
    '<label>持续(s)</label><input type="number" id="crDur" value="' + (rule.duration || 0) + '" min="0">' +
    '<label>冷却(min)</label><input type="number" id="crCd" value="' + (rule.cooldown || 10) + '" min="1">' +
    '<label><input type="checkbox" id="crEn"' + (rule.enabled ? ' checked' : '') + '> 启用</label>';

  document.getElementById('crName').addEventListener('change', e => {
    rule.name = e.target.value.trim() || rule.name;
    renderRuleSelect();
  });
  document.getElementById('crDur').addEventListener('change', e => {
    rule.duration = Number(e.target.value) || 0;
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
    bindNodeDrag(n, nodesBox.querySelector('[data-id="' + n.id + '"]'));
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
      CS.linking = { fromId: p.getAttribute('data-node') };
      document.getElementById('canvasArea').style.cursor = 'crosshair';
    });
  });
  nodesBox.querySelectorAll('.c-port-in').forEach(p => {
    p.addEventListener('mousedown', e => {
      e.stopPropagation();
      if (!CS.linking) return;
      const toId = p.getAttribute('data-node');
      if (toId === CS.linking.fromId){ CS.linking = null; return; }
      rule.links = rule.links.filter(l => !(l.from === CS.linking.fromId && l.to === toId));
      rule.links.push({ from: CS.linking.fromId, to: toId });
      CS.linking = null;
      document.getElementById('canvasArea').style.cursor = '';
      renderCanvas();
    });
  });

  nodesBox.querySelectorAll('.cnode input, .cnode select').forEach(el => {
    el.addEventListener('change', () => {
      const id = el.getAttribute('data-nid');
      const field = el.getAttribute('data-field');
      const n = nodeById(id);
      if (!n) return;
      if (field === 'value' || field === 'min' || field === 'max'){
        n[field] = Number(el.value);
      } else {
        n[field] = el.value;
      }
    });
  });

  updateLinks();
}

function nodeHtml(n){
  const label = {
    tag: '位号',
    compare: '比较',
    range: '区间',
    logic: '逻辑',
    not: '非',
    trigger: '触发',
    bool: '布尔'
  }[n.type] || n.type;

  let body = '';
  let ports = '';

  if (n.type === 'tag'){
    body =
      '<div class="row"><label>位号</label>' +
      '<input type="text" data-nid="' + n.id + '" data-field="tag" value="' + esc(n.tag || '') + '" placeholder="HCY_TI_xxx"></div>';
    ports = '<div class="c-port c-port-out c-port-out-single" data-node="' + n.id + '"></div>';
  }
  else if (n.type === 'bool'){
    body =
      '<div class="row"><label>布尔位号</label>' +
      '<input type="text" data-nid="' + n.id + '" data-field="tag" value="' + esc(n.tag || '') + '" placeholder="BOOL_xxx"></div>';
    ports = '<div class="c-port c-port-out c-port-out-single" data-node="' + n.id + '"></div>';
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
      '<input type="text" data-nid="' + n.id + '" data-field="value" value="' + (n.value == null ? '' : n.value) + '"></div>';
    ports =
      '<div class="c-port c-port-in c-port-in-single" data-node="' + n.id + '"></div>' +
      '<div class="c-port c-port-out c-port-out-single" data-node="' + n.id + '"></div>';
  }
  else if (n.type === 'range'){
    body =
      '<div class="row"><label>下限</label>' +
      '<input type="text" data-nid="' + n.id + '" data-field="min" value="' + (n.min == null ? '' : n.min) + '"></div>' +
      '<div class="row"><label>上限</label>' +
      '<input type="text" data-nid="' + n.id + '" data-field="max" value="' + (n.max == null ? '' : n.max) + '"></div>';
    ports =
      '<div class="c-port c-port-in c-port-in-single" data-node="' + n.id + '"></div>' +
      '<div class="c-port c-port-out c-port-out-single" data-node="' + n.id + '"></div>';
  }
  else if (n.type === 'logic'){
    body =
      '<div class="row"><label>运算</label>' +
      '<select data-nid="' + n.id + '" data-field="op">' +
        '<option value="AND"' + (n.op === 'AND' ? ' selected' : '') + '>AND 且</option>' +
        '<option value="OR"'  + (n.op === 'OR'  ? ' selected' : '') + '>OR 或</option>' +
      '</select></div>';
    ports =
      '<div class="c-port c-port-in c-port-in1" data-node="' + n.id + '"></div>' +
      '<div class="c-port c-port-in c-port-in2" data-node="' + n.id + '"></div>' +
      '<div class="c-port c-port-out c-port-out-single" data-node="' + n.id + '"></div>';
  }
  else if (n.type === 'not'){
    body = '<div style="color:#94a3b8;font-size:11px">输入取反</div>';
    ports =
      '<div class="c-port c-port-in c-port-in-single" data-node="' + n.id + '"></div>' +
      '<div class="c-port c-port-out c-port-out-single" data-node="' + n.id + '"></div>';
  }
  else if (n.type === 'trigger'){
    body =
      '<div class="row"><label>级别</label>' +
      '<select data-nid="' + n.id + '" data-field="level">' +
        ['HH','H','L','LL'].map(x =>
          '<option value="' + x + '"' + (n.level === x ? ' selected' : '') + '>' + x + '</option>'
        ).join('') +
      '</select></div>';
    ports = '<div class="c-port c-port-in c-port-in-single" data-node="' + n.id + '"></div>';
  }

  return '<div class="cnode type-' + n.type + '" data-id="' + n.id + '" style="left:' + n.x + 'px;top:' + n.y + 'px">' +
    '<div class="cnode-hd">' + label + '<span class="kind">' + n.id.slice(-4) + '</span>' +
      '<span class="cnode-del" data-del="' + n.id + '" title="删除">×</span></div>' +
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

    const move = ev => {
      n.x = Math.max(0, nx0 + ev.clientX - sx);
      n.y = Math.max(0, ny0 + ev.clientY - sy);
      el.style.left = n.x + 'px';
      el.style.top  = n.y + 'px';
      updateLinks();
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

// ============================================================
// 端口位置 & 连线
// ============================================================
function nodeHeight(n){
  if (n.type === 'logic') return 100;
  if (n.type === 'compare' || n.type === 'range') return 115;
  if (n.type === 'trigger') return 85;
  return 80;
}

function portPos(n, kind){
  const h = nodeHeight(n);
  if (kind === 'in')  return { x: n.x,       y: n.y + h / 2 };
  if (kind === 'in1') return { x: n.x,       y: n.y + 38 };
  if (kind === 'in2') return { x: n.x,       y: n.y + 68 };
  if (kind === 'out') return { x: n.x + 180, y: n.y + h / 2 };
  return { x: n.x, y: n.y };
}

function updateLinks(){
  const rule = currentRule();
  if (!rule) return;
  const svg = document.getElementById('canvasLinks');
  svg.innerHTML = rule.links.map((l, i) => {
    const a = nodeById(l.from);
    const b = nodeById(l.to);
    if (!a || !b) return '';
    const p1 = portPos(a, 'out');
    const p2 = portPos(b, 'in');
    const dx = Math.max(60, Math.abs(p2.x - p1.x) / 2);
    const d = 'M ' + p1.x + ' ' + p1.y +
              ' C ' + (p1.x + dx) + ' ' + p1.y + ', ' +
                       (p2.x - dx) + ' ' + p2.y + ', ' +
                       p2.x + ' ' + p2.y;
    return '<path d="' + d + '" data-link="' + i + '"></path>';
  }).join('');

  svg.querySelectorAll('path').forEach(p => {
    p.addEventListener('click', () => {
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
function addNode(type){
  const rule = currentRule();
  if (!rule) return;
  const id = 'n' + Date.now() + Math.random().toString(36).slice(2, 5);
  const base = {
    id, type,
    x: 60 + Math.random() * 200,
    y: 60 + Math.random() * 200
  };
  if (type === 'tag') base.tag = '';
  if (type === 'bool'){ base.type = 'bool'; base.tag = ''; }
  if (type === 'compare'){ base.op = '>='; base.value = ''; }
  if (type === 'range'){ base.min = ''; base.max = ''; }
  if (type === 'logic') base.op = 'AND';
  if (type === 'trigger') base.level = 'HH';
  rule.nodes.push(base);
  renderCanvas();
}

// ============================================================
// 初始化 & 绑定
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
  document.getElementById('btnCanvasAddTag').addEventListener('click', () => addNode('tag'));
  document.getElementById('btnCanvasAddCompare').addEventListener('click', () => addNode('compare'));
  document.getElementById('btnCanvasAddRange').addEventListener('click', () => addNode('range'));
  document.getElementById('btnCanvasAddLogic').addEventListener('click', () => addNode('logic'));
  document.getElementById('btnCanvasAddNot').addEventListener('click', () => addNode('not'));
  document.getElementById('btnCanvasAddTrigger').addEventListener('click', () => addNode('trigger'));
  document.getElementById('btnCanvasSave').addEventListener('click', canvasSave);

  document.getElementById('canvasArea').addEventListener('mousedown', e => {
    if (e.target.id === 'canvasArea' || e.target.id === 'canvasNodes'){
      CS.linking = null;
      document.getElementById('canvasArea').style.cursor = '';
    }
  });
}