/* ============================================================
 * 高级规则 · 画布页（米家自动化极客版 复刻）
 * ------------------------------------------------------------
 * 1) 画面 1:1 复刻：顶部规则标签栏 / 左侧 6 组 25 个内容块库 /
 *    中央浅灰蓝画布空态 / 画布悬浮工具条 / 底部帮助菜单
 * 2) 节点体系：米家 25 个内容块（data-type 与语义一致），
 *    支持拖拽入画布、卡片连线、选中改属性、删除、缩放平移、保存还原
 * 3) 数据源：现有位号(tags) 与 变量(vars)；执行动作仍走现有报警弹窗/邮件链路
 * 4) 仅支持新版画布规则（model:'signal'），旧画布规则（tag/compare/edge/trigger 等）不再兼容
 * ============================================================ */
(function () {
'use strict';

const NS = 'http://www.w3.org/2000/svg';
const CARD_DEFAULT_INS = [['in', '']];
const CARD_DEFAULT_OUTS = [['out', '']];

// 画布运行时状态
const CS = {
  rules: [],
  curId: null,
  sel: null,
  tags: [],
  tagMap: {},
  varNames: [],
  view: { x: 0, y: 0, z: 1 },
  link: null,
  portIndex: {},
  pendingCreate: null
};

/* ============================================================
 * 一、内容块目录（左侧库 = 6 组 25 块，命名与参考一致）
 * ============================================================ */
const CAT_COLOR = {
  device: '#0d84ff',
  time: '#ff9500',
  flow: '#7c5cff',
  logic: '#00b3a4',
  other: '#8c8c8c',
  variable: '#34c759'
};

const CAT_NAME = {
  device: '设备', time: '时间', flow: '流程',
  logic: '逻辑', other: '其他', variable: '变量'
};

const OPS = [
  ['', '— 不判断 —'], ['==', '等于'], ['!=', '不等于'], ['>', '大于'],
  ['<', '小于'], ['>=', '大于等于'], ['<=', '小于等于']
];
const LEVELS = [['HH', 'HH 高高限'], ['H', 'H 高限'], ['L', 'L 低限'], ['LL', 'LL 低低限']];

// 字段语法：k=键 l=标签 t=类型(txt/num/area/sel/bool/tag/var) o=选项 d=默认 ph=占位 tip=说明
const DEFS = {
  /* ---------------- 设备 ---------------- */
  deviceInput: {
    label: '事件发生或状态更新', cat: 'device',
    ins: [], outs: [['out', '事件']],
    fs: [
      { k: 'tag', l: '位号', t: 'tag', tip: '选择要监听的位号' },
      { k: 'mode', l: '触发方式', t: 'sel', o: [['update', '状态更新即触发'], ['match', '满足条件时触发']], d: 'update' },
      { k: 'op', l: '条件', t: 'sel', o: OPS, d: '=' },
      { k: 'value', l: '比较值', t: 'txt' },
      { k: 'msg', l: '推送文案', t: 'area', ph: '【设备报警】\n规则：{rule}\n触发值：{value}\n时间：{time}' },
      { k: 'level', l: '报警级别', t: 'sel', o: LEVELS, d: 'HH' },
      { k: 'mail', l: '邮件推送', t: 'bool', d: false }
    ],
    sum: (n) => n.tag ? ('当 ' + n.tag + (n.mode === 'match' && n.op ? ' ' + opText(n.op) + ' ' + (n.value || '') : ' 变化时')) : '未选择位号'
  },
  deviceGet: {
    label: '查询当前状态', cat: 'device',
    ins: [], outs: [['out', '值']],
    fs: [
      { k: 'tag', l: '位号', t: 'tag' },
      { k: 'op', l: '判断条件', t: 'sel', o: OPS, d: '' },
      { k: 'value', l: '比较值', t: 'txt' }
    ],
    sum: (n) => n.tag ? (n.op ? (n.tag + ' ' + opText(n.op) + ' ' + (n.value || '')) : ('读取 ' + n.tag)) : '未选择位号'
  },
  deviceOutput: {
    label: '执行操作', cat: 'device',
    ins: [['in', '触发']], outs: [['out', '完成']],
    fs: [
      { k: 'label', l: '操作说明', t: 'txt', ph: '如：现场声光报警' },
      { k: 'mode', l: '执行方式', t: 'sel', o: [['notify', '报警弹窗 + 推送'], ['log', '仅记录日志']], d: 'notify' },
      { k: 'msg', l: '推送文案', t: 'area', ph: '【设备报警】\n规则：{rule}\n触发值：{value}\n时间：{time}' },
      { k: 'level', l: '报警级别', t: 'sel', o: LEVELS, d: 'HH' },
      { k: 'mail', l: '邮件推送', t: 'bool', d: false },
      { k: 'tip', l: '', t: 'note', tip: '本系统不下发实际设备控制指令：触发后按现有报警弹窗与邮件链路通知。' }
    ],
    sum: (n) => n.label ? n.label : (n.mode === 'log' ? '记录日志' : '报警弹窗 + 推送')
  },
  /* ---------------- 时间 ---------------- */
  alarmClock: {
    label: '定时', cat: 'time',
    ins: [], outs: [['out', '到点']],
    fs: [
      { k: 'time', l: '时间（HH:MM）', t: 'txt', ph: '08:30', tip: '多个时间用英文逗号分隔，如 08:30,12:00,18:00' },
      { k: 'days', l: '星期', t: 'txt', ph: '1,2,3,4,5', tip: '1=周一 … 7=周日；留空表示每天' }
    ],
    sum: (n) => (n.time ? ('每天 ' + n.time + ' 触发') : '未设置时间')
  },
  timeRange: {
    label: '时间段', cat: 'time',
    ins: [], outs: [['out', '在时间段内']],
    fs: [
      { k: 'start', l: '开始', t: 'txt', ph: '08:00' },
      { k: 'end', l: '结束', t: 'txt', ph: '18:00' },
      { k: 'days', l: '生效星期', t: 'txt', ph: '1,2,3,4,5' },
      { k: 'invert', l: '取反（时间段外）', t: 'bool', d: false }
    ],
    sum: (n) => n.start && n.end ? ((n.invert ? '不在 ' : '在 ') + n.start + ' ~ ' + n.end) : '未设置时间段'
  },
  delay: {
    label: '延时', cat: 'time',
    ins: [['in', '触发']], outs: [['out', '延时后']],
    fs: [
      { k: 'seconds', l: '延时（秒）', t: 'num', d: 10 },
      { k: 'delayMode', l: '延时方式', t: 'sel', d: 'fire',
        o: [['fire', '触发后延时 N 秒执行一次'], ['hold', '持续满足 N 秒后执行'], ['off', '触发后保持 N 秒']],
        tip: '旧版节点保持原有语义（持续满足 N 秒）' }
    ],
    sum: (n) => '延时 ' + (n.seconds || 0) + ' 秒'
  },
  statusLast: {
    label: '状态维持了一段时间', cat: 'time',
    ins: [['in', '条件']], outs: [['out', '已维持']],
    fs: [
      { k: 'tag', l: '位号（可选）', t: 'tag', tip: '留空则判断上游条件，否则判断该位号' },
      { k: 'op', l: '条件', t: 'sel', o: OPS, d: '' },
      { k: 'value', l: '比较值', t: 'txt' },
      { k: 'seconds', l: '维持（秒）', t: 'num', d: 60 }
    ],
    sum: (n) => (n.tag ? n.tag + ' ' : '条件 ') + '维持 ' + (n.seconds || 0) + ' 秒'
  },
  eventSequence: {
    label: '事件先后发生', cat: 'time',
    ins: [['in1', '事件1'], ['in2', '事件2']], outs: [['out', '先后成立']],
    fs: [
      { k: 'window', l: '间隔窗口（秒）', t: 'num', d: 60, tip: '事件1 发生后 N 秒内事件2 发生才算成立' }
    ],
    sum: (n) => '事件1 后 ' + (n.window || 0) + ' 秒内事件2 发生'
  },
  /* ---------------- 流程 ---------------- */
  condition: {
    label: '当-如果-就', cat: 'flow',
    ins: [['in', '当'], ['cond', '如果']], outs: [['out', '就']],
    fs: [
      { k: 'tip', l: '', t: 'note', tip: '「当」收到事件、「如果」条件成立时，向下游输出一拍。' }
    ],
    sum: () => '当事件发生且条件成立'
  },
  loop: {
    label: '循环', cat: 'flow',
    ins: [['in', '启动']], outs: [['out', '每轮']],
    fs: [
      { k: 'seconds', l: '循环间隔（秒）', t: 'num', d: 60 },
      { k: 'times', l: '循环次数', t: 'num', d: 0, tip: '0 表示不限次数；输入由成立变为不成立时重新计数' }
    ],
    sum: (n) => ('每 ' + (n.seconds || 0) + ' 秒一次' + (n.times ? '，最多 ' + n.times + ' 次' : ''))
  },
  onlyNTimes: {
    label: '最多触发指定次数', cat: 'flow',
    ins: [['in', '输入'], ['in2', '复位']], outs: [['out', '允许']],
    fs: [
      { k: 'times', l: '最大次数', t: 'num', d: 1 },
      { k: 'tip', l: '', t: 'note', tip: '超过次数后不再向下游输出，直到「复位」端口被触发。' }
    ],
    sum: (n) => '最多 ' + (n.times || 1) + ' 次'
  },
  counter: {
    label: '达到指定次数时', cat: 'flow',
    ins: [['in', '计数'], ['in2', '复位']], outs: [['out', '达标']],
    fs: [
      { k: 'target', l: '目标次数', t: 'num', d: 3 },
      { k: 'window', l: '统计窗口（秒）', t: 'num', d: 0, tip: '0 表示不限窗口；超出窗口则重新计数' }
    ],
    sum: (n) => '累计达到 ' + (n.target || 1) + ' 次' + (n.window ? '（' + n.window + ' 秒内）' : '')
  },
  modeSwitch: {
    label: '模式切换', cat: 'flow',
    ins: [['in', '切换']], outs: [['out', '命中模式']],
    fs: [
      { k: 'modes', l: '模式列表', t: 'txt', d: '回家,离家,睡眠', tip: '英文逗号分隔，每来一次「切换」切换到下一个模式' },
      { k: 'mode', l: '当前模式序号', t: 'num', d: 0, tip: '0 起算，用于外部改模式 / 记忆当前所处模式' }
    ],
    sum: (n) => '模式：' + (n.modes || '') + '（当前第 ' + ((Number(n.mode) || 0) + 1) + ' 个）'
  },
  /* ---------------- 逻辑 ---------------- */
  signalOr: {
    label: '当任一事件发生', cat: 'logic',
    ins: [['in1', '事件1'], ['in2', '事件2'], ['in3', '事件3']], outs: [['out', '任一发生']],
    fs: [{ k: 'tip', l: '', t: 'note', tip: '任一路出现上升沿（事件发生）即向下游输出一拍。' }],
    sum: () => '任一事件发生即触发'
  },
  logicOr: {
    label: '满足任一条件', cat: 'logic',
    ins: [['in1', '条件1'], ['in2', '条件2'], ['in3', '条件3']], outs: [['out', '任一满足']],
    fs: [], sum: () => '任一条件满足'
  },
  logicAnd: {
    label: '满足全部条件', cat: 'logic',
    ins: [['in1', '条件1'], ['in2', '条件2'], ['in3', '条件3']], outs: [['out', '全部满足']],
    fs: [], sum: () => '全部条件满足'
  },
  logicNot: {
    label: '状态取反', cat: 'logic',
    ins: [['in', '输入']], outs: [['out', '取反']],
    fs: [], sum: () => '输入取反'
  },
  /* ---------------- 其他 ---------------- */
  register: {
    label: '自定义状态', cat: 'other',
    ins: [['in', '置位'], ['in2', '复位']], outs: [['out', '状态']],
    fs: [{ k: 'label', l: '状态名', t: 'txt', ph: '如：夜间布防' }],
    sum: (n) => n.label ? ('状态：' + n.label) : '自定义状态（置位后保持）'
  },
  onLoad: {
    label: '本自动化启用时', cat: 'other',
    ins: [], outs: [['out', '启动']],
    fs: [{ k: 'tip', l: '', t: 'note', tip: '规则启用后保持成立：可直接驱动「循环」；需要只执行一次时接「当-如果-就」取上升沿。' }],
    sum: () => '本自动化启用期间保持成立'
  },
  /* ---------------- 变量 ---------------- */
  deviceInputSetVar: {
    label: '设备触发赋值', cat: 'variable',
    ins: [], outs: [['out', '已赋值']],
    fs: [
      { k: 'tag', l: '位号', t: 'tag' },
      { k: 'op', l: '条件', t: 'sel', o: OPS, d: '' },
      { k: 'value', l: '比较值', t: 'txt' },
      { k: 'varName', l: '目标变量', t: 'var' },
      { k: 'assignFrom', l: '赋值来源', t: 'sel', o: [['device', '位号当前值'], ['const', '固定值']], d: 'device' },
      { k: 'constValue', l: '固定值', t: 'txt' }
    ],
    sum: (n) => (n.tag ? n.tag : '设备') + ' → ' + (n.varName || '变量')
  },
  deviceGetSetVar: {
    label: '查询设备并赋值', cat: 'variable',
    ins: [['in', '触发']], outs: [['out', '已赋值']],
    fs: [
      { k: 'tag', l: '位号', t: 'tag' },
      { k: 'varName', l: '目标变量', t: 'var' }
    ],
    sum: (n) => '读取 ' + (n.tag || '位号') + ' → ' + (n.varName || '变量')
  },
  varChange: {
    label: '变量值更新', cat: 'variable',
    ins: [], outs: [['out', '已更新']],
    fs: [
      { k: 'name', l: '变量', t: 'var' },
      { k: 'op', l: '条件', t: 'sel', o: OPS, d: '' },
      { k: 'value', l: '比较值', t: 'txt' }
    ],
    sum: (n) => (n.name || '变量') + ' 更新' + (n.op ? '（' + opText(n.op) + ' ' + (n.value || '') + '）' : '')
  },
  varGet: {
    label: '查询变量值', cat: 'variable',
    ins: [], outs: [['out', '值']],
    fs: [
      { k: 'name', l: '变量', t: 'var' },
      { k: 'op', l: '判断条件', t: 'sel', o: OPS, d: '' },
      { k: 'value', l: '比较值', t: 'txt' }
    ],
    sum: (n) => (n.name || '变量') + (n.op ? ' ' + opText(n.op) + ' ' + (n.value || '') : '')
  },
  varSetNumber: {
    label: '数值运算', cat: 'variable',
    ins: [['in', '触发']], outs: [['out', '已写入']],
    fs: [
      { k: 'name', l: '目标变量', t: 'var' },
      { k: 'fromVar', l: '左值变量（可选）', t: 'var', tip: '留空则使用下面的左值常量' },
      { k: 'a', l: '左值常量', t: 'txt', d: '0' },
      { k: 'op', l: '运算符', t: 'sel', d: '+',
        o: [['+', '＋'], ['-', '－'], ['*', '×'], ['/', '÷'], ['set', '直接赋值']] },
      { k: 'bVar', l: '右值变量（可选）', t: 'var' },
      { k: 'b', l: '右值常量', t: 'txt', d: '1' }
    ],
    sum: (n) => (n.name || '变量') + ' = ' + (n.fromVar || n.a || '0') + ' ' + (n.op || '+') + ' ' + (n.bVar || n.b || '1')
  },
  varSetString: {
    label: '文本拼接', cat: 'variable',
    ins: [['in', '触发']], outs: [['out', '已写入']],
    fs: [
      { k: 'name', l: '目标变量', t: 'var' },
      { k: 'template', l: '拼接模板', t: 'area', d: '温度 {tag:TI-1001} 于 {time}',
        tip: '支持 {变量名}、{tag:位号}、{value}（上游值）、{time}' }
    ],
    sum: (n) => (n.name || '变量') + ' = ' + (n.template || '模板')
  }
};

const NEW_TYPES = {};
Object.keys(DEFS).forEach((k) => { NEW_TYPES[k] = DEFS[k].label; });
const SIDE_GROUPS = [
  ['device', ['deviceInput', 'deviceGet', 'deviceOutput']],
  ['time', ['alarmClock', 'timeRange', 'delay', 'statusLast', 'eventSequence']],
  ['flow', ['condition', 'loop', 'onlyNTimes', 'counter', 'modeSwitch']],
  ['logic', ['signalOr', 'logicOr', 'logicAnd', 'logicNot']],
  ['other', ['register', 'onLoad']],
  ['variable', ['deviceInputSetVar', 'deviceGetSetVar', 'varChange', 'varGet', 'varSetNumber', 'varSetString']]
];

/* ============================================================
 * 二、通用工具
 * ============================================================ */
function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function uid(p) { return (p || 'n') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function opText(op) {
  const m = { '==': '=', '!=': '≠', '>': '>', '<': '<', '>=': '≥', '<=': '≤' };
  return m[op] || op;
}
function toast(msg) {
  // 轻量提示：复用状态栏，避免额外 DOM 依赖
  const sb = $('statusbar');
  if (!sb) return;
  let box = $('cvToast');
  if (!box) {
    box = document.createElement('div');
    box.id = 'cvToast';
    box.style.cssText = 'position:fixed;left:50%;top:70px;transform:translateX(-50%);' +
      'background:rgba(0,0,0,.78);color:#fff;font-size:12px;padding:7px 14px;border-radius:6px;z-index:99999';
    document.body.appendChild(box);
  }
  box.textContent = msg;
  box.style.display = 'block';
  clearTimeout(box._t);
  box._t = setTimeout(function () { box.style.display = 'none'; }, 2200);
}

function normalizeTags(r) {
  const arr = Array.isArray(r) ? r : ((r && (r.list || r.tags || r.points)) || []);
  return arr.map(function (t) {
    if (typeof t === 'string') return { tag: t, desc: '', unit: '' };
    return {
      tag: (t && (t.tag || t.name || t.id)) || '',
      desc: (t && (t.desc || t.description || '')) || '',
      unit: (t && t.unit) || ''
    };
  }).filter(function (t) { return t.tag; });
}
function normalizeVars(r) {
  const arr = Array.isArray(r) ? r : ((r && (r.list || r.vars || r.items)) || []);
  return arr.map(function (v) {
    if (typeof v === 'string') return v;
    return (v && (v.name || v.varName || v.id)) || '';
  }).filter(Boolean);
}

/* ============================================================
 * 三、规则读写（沿用 canvas:load / canvas:save，旧规则原样保留）
 * ============================================================ */
function curRule() {
  for (let i = 0; i < CS.rules.length; i++) if (CS.rules[i].id === CS.curId) return CS.rules[i];
  return null;
}

function newRule() {
  const idx = CS.rules.length + 1;
  return {
    id: uid('rule'),
    name: String(idx),
    enabled: true,
    model: 'signal',
    duration: 0,
    hold: 'timed',
    holdSeconds: 15,
    nodes: [],
    links: []
  };
}

async function canvasLoad() {
  try {
    const r = await window.api.canvasLoad();
    CS.rules = (r && r.rules) || [];
  } catch (e) {
    CS.rules = [];
  }
  if (!CS.rules.length) CS.rules = [newRule()];
  if (!CS.rules.some(function (x) { return x.id === CS.curId; })) {
    CS.curId = CS.rules[CS.rules.length - 1].id;
  }
  CS.sel = null;
  CS.view = { x: 0, y: 0, z: 1 };
  renderAll();
}

async function canvasSave() {
  const r = curRule();
  if (!r) return;
  r.name = ($('canvasRuleName') && $('canvasRuleName').value) || r.name;
  try {
    const res = await window.api.canvasSave(CS.rules);
    if (res && res.ok === false) toast('保存失败：' + (res.error || '未知错误'));
    else toast('已保存：' + (r.name || r.id));
  } catch (e) {
    toast('保存失败：' + e.message);
  }
  renderTabs();
}

window.canvasLoad = canvasLoad;
window.canvasSave = canvasSave;

/* ============================================================
 * 四、顶部规则标签栏
 * ============================================================ */
function renderTabs() {
  const box = $('ruleTabs');
  if (!box) return;
  box.innerHTML = CS.rules.map(function (r) {
    const on = r.id === CS.curId ? ' selected' : '';
    return '<div class="app-header-menu-tab' + on + '" data-rid="' + esc(r.id) + '">' +
      '<label title="' + esc(r.name || r.id) + '">' + esc(r.name || r.id) + '</label>' +
      '<span class="tab-close" data-close="' + esc(r.id) + '" title="删除规则">' +
      '<svg width="1em" height="1em" viewBox="0 0 20 20" fill="currentColor"><path d="M13.536 7.596a.8.8 0 1 0-1.132-1.132L10 8.87 7.596 6.464a.8.8 0 1 0-1.132 1.132L8.87 10l-2.405 2.404a.8.8 0 1 0 1.132 1.132L10 11.13l2.404 2.405a.8.8 0 1 0 1.132-1.132L11.13 10l2.405-2.404Z"></path></svg>' +
      '</span></div>';
  }).join('');
}

function bindTabs() {
  const box = $('ruleTabs');
  if (!box) return;
  box.addEventListener('click', function (e) {
    const closeBtn = e.target.closest ? e.target.closest('[data-close]') : null;
    if (closeBtn) {
      e.stopPropagation();
      delRule(closeBtn.getAttribute('data-close'));
      return;
    }
    const tab = e.target.closest ? e.target.closest('.app-header-menu-tab') : null;
    if (!tab) return;
    const rid = tab.getAttribute('data-rid');
    if (rid === CS.curId) return;
    const r = curRule();
    if (r && $('canvasRuleName')) r.name = $('canvasRuleName').value;
    CS.curId = rid;
    CS.sel = null;
    renderAll();
  });
  const add = $('btnRuleAdd');
  if (add) add.addEventListener('click', function () {
    const r = curRule();
    if (r && $('canvasRuleName')) r.name = $('canvasRuleName').value;
    const nr = newRule();
    CS.rules.push(nr);
    CS.curId = nr.id;
    CS.sel = null;
    renderAll();
    toast('已新建规则（记得点「保存」）');
  });
  const more = $('btnAppMore');
  if (more) more.addEventListener('click', function (e) {
    e.stopPropagation();
    toggleMenu($('helpMenu'));
  });
}

function delRule(rid) {
  if (CS.rules.length <= 1) { toast('至少保留一个规则'); return; }
  const r = CS.rules.filter(function (x) { return x.id === rid; })[0];
  showConfirm('删除规则', '将删除规则「' + ((r && r.name) || rid) + '」及其全部节点与连线，是否继续？', function () {
    CS.rules = CS.rules.filter(function (x) { return x.id !== rid; });
    if (CS.curId === rid) CS.curId = CS.rules[CS.rules.length - 1].id;
    CS.sel = null;
    renderAll();
    canvasSave();
  });
}

/* ============================================================
 * 五、左侧内容块库 + 拖拽创建
 * ============================================================ */
function renderSide() {
  const list = $('eleList');
  if (!list) return;
  let html = '';
  SIDE_GROUPS.forEach(function (g) {
    const color = CAT_COLOR[g[0]];
    html += '<div class="graph-ele-item graph-ele-condition">' +
      '<div class="ele-title">' + esc(CAT_NAME[g[0]]) + '</div><div class="ele-list">';
    g[1].forEach(function (t) {
      html += '<div class="ele-item" data-type="' + esc(t) + '" data-id="cardBox.' + esc(t) + '.0">' +
        '<i class="edot" style="background:' + color + '"></i>' +
        esc(NEW_TYPES[t]) + '</div>';
    });
    html += '</div></div>';
  });
  list.innerHTML = html;

}

function bindSide() {
  const list = $('eleList');
  if (list) {
    list.addEventListener('mousedown', function (e) {
      const item = e.target.closest ? e.target.closest('.ele-item') : null;
      if (!item) return;
      e.preventDefault();
      startDragCreate(item, item.getAttribute('data-type'));
    });
  }
}

function startDragCreate(item, type) {
  const label = NEW_TYPES[type] || type;
  let ghost = null;
  const mv = function (e) {
    if (!ghost) {
      ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      ghost.textContent = label;
      ($('page-canvas') || document.body).appendChild(ghost);
    }
    ghost.style.left = (e.clientX + 12) + 'px';
    ghost.style.top = (e.clientY + 10) + 'px';
  };
  const up = function (e) {
    document.removeEventListener('mousemove', mv);
    document.removeEventListener('mouseup', up);
    if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
    const panel = $('canvasPanel');
    if (!panel) return;
    const rc = panel.getBoundingClientRect();
    if (e.clientX < rc.left || e.clientX > rc.right || e.clientY < rc.top || e.clientY > rc.bottom) return;
    const pos = toCanvas(e.clientX, e.clientY);
    addNodeAt(type, pos.x, pos.y);
  };
  document.addEventListener('mousemove', mv);
  document.addEventListener('mouseup', up);
}

function nodeDefaults(type) {
  const d = DEFS[type];
  const n = { id: uid('n'), type: type, x: 0, y: 0 };
  n.v2 = true;
  if (d && d.fs) {
    d.fs.forEach(function (f) {
      if (f.t === 'note') return;
      n[f.k] = (f.d === undefined ? (f.t === 'bool' ? false : '') : f.d);
    });
  }
  return n;
}

function addNodeAt(type, x, y) {
  const r = curRule();
  if (!r) { toast('请先新建规则'); return; }
  const n = nodeDefaults(type);
  n.x = Math.round(x);
  n.y = Math.round(y);
  if (!Array.isArray(r.nodes)) r.nodes = [];
  r.nodes.push(n);
  if (!Array.isArray(r.links)) r.links = [];
  CS.sel = n.id;
  renderAll();
  openDrawer();
}

/* ============================================================
 * 六、画布渲染（节点 / 连线 / 视口变换）
 * ============================================================ */
// 端口纵向位置：随索引递增，配合节点高度自适应
function portTop(i) { return 40 + i * 28; }

function portsOf(n) {
  const d = DEFS[n.type] || {};
  return { ins: d.ins || CARD_DEFAULT_INS, outs: d.outs || CARD_DEFAULT_OUTS };
}

function nodeEl(n) {
  const el = document.createElement('div');
  el.className = 'cnode' + (CS.sel === n.id ? ' selected' : '');
  el.setAttribute('data-node', n.id);
  el.style.left = (Number(n.x) || 0) + 'px';
  el.style.top = (Number(n.y) || 0) + 'px';

  const p = portsOf(n);
  const title = NEW_TYPES[n.type] || n.type;
  const color = CAT_COLOR[(DEFS[n.type] || {}).cat || 'device'];
  const sub = nodeSummary(n);

  // 端口纵向自适应：连接点增多时同步增高节点，避免端口溢出卡片
  const maxPorts = Math.max(p.ins.length, p.outs.length);
  if (maxPorts > 3) el.style.minHeight = (108 + (maxPorts - 3) * 28) + 'px';

  el.innerHTML =
    '<div class="cnode-hd"><i class="dot" style="background:' + color + '"></i>' +
    '<span class="txt" title="' + esc(title + '｜' + sub) + '">' + esc(title) + '</span></div>' +
    '<div class="cnode-bd">' + esc(sub) + '</div>';

  // 端口
  p.ins.forEach(function (cfg, i) {
    const d = document.createElement('i');
    d.className = 'c-port c-port-in p' + i;
    d.style.top = portTop(i) + 'px';
    d.setAttribute('data-dir', 'in');
    d.setAttribute('data-port', cfg[0]);
    d.setAttribute('data-node', n.id);
    if (cfg[1]) d.title = cfg[1];
    el.appendChild(d);
    CS.portIndex[n.id + '|in|' + cfg[0]] = d;
    if (cfg[1] && i > 0) {
      const lab = document.createElement('span');
      lab.className = 'c-port-label l p' + i;
      lab.style.top = portTop(i) + 'px';
      lab.textContent = cfg[1];
      el.appendChild(lab);
    }
  });
  p.outs.forEach(function (cfg, i) {
    const d = document.createElement('i');
    d.className = 'c-port c-port-out p' + i;
    d.style.top = portTop(i) + 'px';
    d.setAttribute('data-dir', 'out');
    d.setAttribute('data-port', cfg[0]);
    d.setAttribute('data-node', n.id);
    if (cfg[1]) d.title = cfg[1];
    el.appendChild(d);
    CS.portIndex[n.id + '|out|' + cfg[0]] = d;
    if (cfg[1] && i > 0) {
      const lab = document.createElement('span');
      lab.className = 'c-port-label r p' + i;
      lab.style.top = portTop(i) + 'px';
      lab.textContent = cfg[1];
      el.appendChild(lab);
    }
  });
  return el;
}

function nodeSummary(n) {
  const d = DEFS[n.type];
  if (!d) return n.type;
  try { return d.sum ? d.sum(n) : d.label; } catch (e) { return d.label; }
}

function renderCanvas() {
  const box = $('canvasNodes');
  if (!box) return;
  CS.portIndex = {};
  box.innerHTML = '';
  const r = curRule();
  const empty = $('canvasEmpty');
  if (!r) {
    if (empty) { empty.textContent = '没有可编辑的规则'; empty.style.display = 'flex'; }
    return;
  }
  const nodes = r.nodes || [];
  if (empty) {
    empty.textContent = '拖拽左侧内容至这里创建';
    empty.style.display = nodes.length ? 'none' : 'flex';
  }
  nodes.forEach(function (n) { box.appendChild(nodeEl(n)); });
  window.requestAnimationFrame(drawLinks);
  applyView();
}

function portPos(el) {
  const vp = $('canvas-viewport');
  let x = 0, y = 0, e = el;
  while (e && e !== vp) {
    x += e.offsetLeft || 0;
    y += e.offsetTop || 0;
    e = e.offsetParent;
  }
  const w = el.offsetWidth / 2, h = el.offsetHeight / 2;
  return { x: x + w, y: y + h };
}

function drawLinks() {
  const rule = curRule();
  const layer = $('linkLayer');
  const svg = $('canvasLinks');
  if (!rule || !layer || !svg) return;
  layer.innerHTML = '';
  svg.setAttribute('width', '4000');
  svg.setAttribute('height', '3000');
  (rule.links || []).forEach(function (l) {
    const a = CS.portIndex[l.from + '|out|' + (l.fromPort || 'out')];
    const b = CS.portIndex[l.to + '|in|' + (l.toPort || 'in')];
    if (!a || !b) return;
    const pa = portPos(a), pb = portPos(b);
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M' + pa.x + ',' + pa.y +
      ' C' + (pa.x + 60) + ',' + pa.y + ' ' + (pb.x - 60) + ',' + pb.y + ' ' + pb.x + ',' + pb.y);
    path.setAttribute('class', 'link-path');
    path.setAttribute('data-link', l.id);
    layer.appendChild(path);
  });
}

function applyView() {
  const vp = $('canvas-viewport');
  if (vp) vp.style.transform = 'translate3d(' + CS.view.x + 'px,' + CS.view.y + 'px,0) scale(' + CS.view.z + ')';
  const zt = $('zoomText');
  if (zt) zt.textContent = Math.round(CS.view.z * 100) + '%';
}

function toCanvas(clientX, clientY) {
  const panel = $('canvasPanel');
  const rc = panel.getBoundingClientRect();
  return {
    x: (clientX - rc.left - CS.view.x) / CS.view.z,
    y: (clientY - rc.top - CS.view.y) / CS.view.z
  };
}

/* ============================================================
 * 七、节点拖动 / 端口连线 / 画布平移缩放
 * ============================================================ */
function bindCanvas() {
  const panel = $('canvasPanel');
  if (!panel) return;

  panel.addEventListener('mousedown', function (e) {
    // 悬浮工具条内的交互不触发画布平移 / 取消选中
    if (e.target.closest && e.target.closest('.graph-toolbar')) return;
    const port = e.target.closest ? e.target.closest('.c-port') : null;
    if (port) { startLink(port, e); return; }
    const nodeElM = e.target.closest ? e.target.closest('.cnode') : null;
    if (nodeElM) {
      const id = nodeElM.getAttribute('data-node');
      selectNode(id);
      startNodeDrag(nodeElM, id, e);
      return;
    }
    // 空白区域：平移画布 + 取消选中
    selectNode(null);
    startPan(e);
  });

  panel.addEventListener('mousemove', function (e) {
    if (CS.link) moveLink(e);
  });
  panel.addEventListener('mouseup', function (e) {
    if (CS.link) finishLink(e);
  });
  panel.addEventListener('dblclick', function (e) {
    const nodeElM = e.target.closest ? e.target.closest('.cnode') : null;
    if (nodeElM) openDrawer();
  });

  // 滚轮：默认平移，Ctrl+滚轮缩放
  panel.addEventListener('wheel', function (e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const before = toCanvas(e.clientX, e.clientY);
      const next = Math.min(2, Math.max(0.4, CS.view.z * (e.deltaY > 0 ? 0.9 : 1.1)));
      CS.view.z = next;
      const rc = panel.getBoundingClientRect();
      CS.view.x = e.clientX - rc.left - before.x * next;
      CS.view.y = e.clientY - rc.top - before.y * next;
      applyView();
      drawLinks();
    } else {
      CS.view.x -= e.deltaX;
      CS.view.y -= e.deltaY;
      applyView();
    }
  }, { passive: false });
}

function selectNode(id) {
  if (CS.sel === id) return;
  CS.sel = id;
  const box = $('canvasNodes');
  if (box) {
    Array.prototype.forEach.call(box.querySelectorAll('.cnode'), function (el) {
      el.classList.toggle('selected', el.getAttribute('data-node') === id);
    });
  }
  renderDrawer();
}

function startNodeDrag(el, id, e) {
  const r = curRule();
  if (!r) return;
  const n = (r.nodes || []).filter(function (x) { return x.id === id; })[0];
  if (!n) return;
  const start = toCanvas(e.clientX, e.clientY);
  const ox = Number(n.x) || 0, oy = Number(n.y) || 0;
  const mv = function (ev) {
    const p = toCanvas(ev.clientX, ev.clientY);
    n.x = Math.round(ox + (p.x - start.x));
    n.y = Math.round(oy + (p.y - start.y));
    el.style.left = n.x + 'px';
    el.style.top = n.y + 'px';
    drawLinks();
  };
  const up = function () {
    document.removeEventListener('mousemove', mv);
    document.removeEventListener('mouseup', up);
  };
  document.addEventListener('mousemove', mv);
  document.addEventListener('mouseup', up);
}

function startPan(e) {
  const panel = $('canvasPanel');
  const sx = e.clientX, sy = e.clientY;
  const ox = CS.view.x, oy = CS.view.y;
  panel.classList.add('panning');
  const mv = function (ev) {
    CS.view.x = ox + (ev.clientX - sx);
    CS.view.y = oy + (ev.clientY - sy);
    applyView();
  };
  const up = function () {
    panel.classList.remove('panning');
    document.removeEventListener('mousemove', mv);
    document.removeEventListener('mouseup', up);
  };
  document.addEventListener('mousemove', mv);
  document.addEventListener('mouseup', up);
}

let rubberPath = null;
function startLink(port, e) {
  const dir = port.getAttribute('data-dir');
  if (dir !== 'out') { toast('请从节点右侧圆点拖出连线'); return; }
  e.stopPropagation();
  CS.link = {
    from: port.getAttribute('data-node'),
    fromPort: port.getAttribute('data-port'),
    to: null,
    toPort: null,
    fromEl: port
  };
  port.classList.add('active');
  moveLink(e);
}

function moveLink(e) {
  const layer = $('rubberLayer');
  if (!layer || !CS.link) return;
  const a = portPos(CS.link.fromEl);
  const p = toCanvas(e.clientX, e.clientY);
  if (!rubberPath) {
    rubberPath = document.createElementNS(NS, 'path');
    rubberPath.setAttribute('class', 'rubber-line');
    layer.appendChild(rubberPath);
  }
  rubberPath.setAttribute('d', 'M' + a.x + ',' + a.y + ' C' + (a.x + 60) + ',' + a.y +
    ' ' + (p.x - 60) + ',' + p.y + ' ' + p.x + ',' + p.y);

  // 目标高亮
  const box = $('canvasNodes');
  if (!box) return;
  const hover = document.elementFromPoint(e.clientX, e.clientY);
  const target = hover && hover.closest ? hover.closest('.c-port[data-dir="in"]') : null;
  Array.prototype.forEach.call(box.querySelectorAll('.c-port-in'), function (el) {
    el.classList.toggle('hover-target', el === target);
  });
}

function finishLink(e) {
  const link = CS.link;
  CS.link = null;
  if (rubberPath && rubberPath.parentNode) rubberPath.parentNode.removeChild(rubberPath);
  rubberPath = null;
  const box = $('canvasNodes');
  if (box) {
    Array.prototype.forEach.call(box.querySelectorAll('.c-port-in'), function (el) {
      el.classList.remove('hover-target');
    });
  }
  if (!link) return;
  if (link.fromEl) link.fromEl.classList.remove('active');
  const hover = document.elementFromPoint(e.clientX, e.clientY);
  const target = hover && hover.closest ? hover.closest('.c-port[data-dir="in"]') : null;
  if (!target) { drawLinks(); return; }
  const toId = target.getAttribute('data-node');
  if (toId === link.from) { toast('不能连接到自身'); drawLinks(); return; }
  const r = curRule();
  if (!r) return;
  if (!Array.isArray(r.links)) r.links = [];
  const exists = r.links.some(function (l) {
    return l.from === link.from && l.to === toId &&
      (l.fromPort || 'out') === (link.fromPort || 'out') &&
      (l.toPort || 'in') === target.getAttribute('data-port');
  });
  if (exists) { toast('该连线已存在'); drawLinks(); return; }
  r.links.push({
    id: uid('l'),
    from: link.from,
    fromPort: link.fromPort || 'out',
    to: toId,
    toPort: target.getAttribute('data-port') || 'in'
  });
  drawLinks();
}

function delSelectedNode() {
  const r = curRule();
  if (!r || !CS.sel) { toast('请先选中要删除的节点'); return; }
  r.nodes = (r.nodes || []).filter(function (n) { return n.id !== CS.sel; });
  r.links = (r.links || []).filter(function (l) { return l.from !== CS.sel && l.to !== CS.sel; });
  CS.sel = null;
  renderCanvas();
  renderDrawer();
}

/* ============================================================
 * 八、右侧属性抽屉
 * ============================================================ */
function openDrawer() { renderDrawer(); }

function renderDrawer() {
  const box = $('canvasDrawer');
  if (!box) return;
  const r = curRule();
  const n = r && CS.sel ? (r.nodes || []).filter(function (x) { return x.id === CS.sel; })[0] : null;
  if (!n) { box.style.display = 'none'; box.innerHTML = ''; return; }

  const title = NEW_TYPES[n.type] || n.type;
  let body = '';

  {
    const d = DEFS[n.type] || { fs: [] };
    (d.fs || []).forEach(function (f) {
      if (f.t === 'note') {
        body += '<div class="drawer-sec">' + esc(f.tip || '') + '</div>';
        return;
      }
      const v = n[f.k];
      const id = 'f_' + f.k;
      if (f.t === 'area') {
        body += '<div class="dfrm"><label>' + esc(f.l) + '</label>' +
          '<textarea id="' + id + '" data-fk="' + esc(f.k) + '" placeholder="' + esc(f.ph || '') + '">' + esc(v || '') + '</textarea>' +
          (f.tip ? '<div class="tip">' + esc(f.tip) + '</div>' : '') + '</div>';
      } else if (f.t === 'bool') {
        body += '<div class="dfrm bool"><input type="checkbox" id="' + id + '" data-fk="' + esc(f.k) + '" data-ft="bool"' + (v ? ' checked' : '') + '>' +
          '<label for="' + id + '">' + esc(f.l) + '</label></div>';
      } else if (f.t === 'sel') {
        body += '<div class="dfrm"><label>' + esc(f.l) + '</label><select id="' + id + '" data-fk="' + esc(f.k) + '">' +
          (f.o || []).map(function (o) {
            return '<option value="' + esc(o[0]) + '"' + (String(v == null ? '' : v) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
          }).join('') + '</select>' +
          (f.tip ? '<div class="tip">' + esc(f.tip) + '</div>' : '') + '</div>';
      } else if (f.t === 'tag' || f.t === 'var') {
        const dl = f.t === 'tag' ? 'cvTagList' : 'cvVarList';
        body += '<div class="dfrm"><label>' + esc(f.l) + '</label>' +
          '<input type="text" id="' + id + '" data-fk="' + esc(f.k) + '" list="' + dl + '" value="' + esc(v == null ? '' : v) + '" placeholder="' + esc(f.ph || '') + '">' +
          (f.tip ? '<div class="tip">' + esc(f.tip) + '</div>' : '') + '</div>';
      } else if (f.t === 'num') {
        body += '<div class="dfrm"><label>' + esc(f.l) + '</label>' +
          '<input type="number" id="' + id + '" data-fk="' + esc(f.k) + '" data-ft="num" value="' + esc(v == null ? '' : v) + '">' +
          (f.tip ? '<div class="tip">' + esc(f.tip) + '</div>' : '') + '</div>';
      } else {
        body += '<div class="dfrm"><label>' + esc(f.l) + '</label>' +
          '<input type="text" id="' + id + '" data-fk="' + esc(f.k) + '" value="' + esc(v == null ? '' : v) + '" placeholder="' + esc(f.ph || '') + '">' +
          (f.tip ? '<div class="tip">' + esc(f.tip) + '</div>' : '') + '</div>';
      }
    });
    body += '<div class="drawer-sec">节点 ID：' + esc(n.id) + '</div>';
  }

  box.style.display = 'flex';
  box.innerHTML =
    '<div class="canvas-drawer-hd"><i class="dot"></i>' + esc(title) +
    '<span class="sp"></span>' +
    '<span class="dbtn danger" id="btnDrawerDel" title="删除节点">' +
    '<svg width="1em" height="1em" viewBox="0 0 20 20" fill="currentColor"><path d="M8.8 3.5a1 1 0 0 1 1 1h1.4a1 1 0 1 1 2 0h1.3a1.5 1.5 0 0 1 1.5 1.5v.6H3v-.6a1.5 1.5 0 0 1 1.5-1.5h1.3a1 1 0 0 1 1-1h2Zm-3.6 4.2h9.6l-.6 7.4a1.5 1.5 0 0 1-1.5 1.4H6.3a1.5 1.5 0 0 1-1.5-1.4l-.6-7.4Z"></path></svg>' +
    '</span>' +
    '<span class="dbtn" id="btnDrawerClose" title="收起">' +
    '<svg width="1em" height="1em" viewBox="0 0 20 20" fill="currentColor"><path d="M13.536 7.596a.8.8 0 1 0-1.132-1.132L10 8.87 7.596 6.464a.8.8 0 1 0-1.132 1.132L8.87 10l-2.405 2.404a.8.8 0 1 0 1.132 1.132L10 11.13l2.404 2.405a.8.8 0 1 0 1.132-1.132L11.13 10l2.405-2.404Z"></path></svg>' +
    '</span></div>' +
    '<div class="canvas-drawer-bd">' + body + '</div>' +
    tagDatalists();

  bindDrawer(n);
}

function tagDatalists() {
  const tags = CS.tags.map(function (t) {
    return '<option value="' + esc(t.tag) + '" label="' + esc(t.desc || t.tag) + '"></option>';
  }).join('');
  const vars = CS.varNames.map(function (v) {
    return '<option value="' + esc(v) + '"></option>';
  }).join('');
  return '<datalist id="cvTagList">' + tags + '</datalist><datalist id="cvVarList">' + vars + '</datalist>';
}

function bindDrawer(n) {
  const box = $('canvasDrawer');
  if (!box) return;
  const cl = $('btnDrawerClose');
  if (cl) cl.addEventListener('click', function () { selectNode(null); });
  const dl = $('btnDrawerDel');
  if (dl) dl.addEventListener('click', delSelectedNode);

  Array.prototype.forEach.call(box.querySelectorAll('[data-fk]'), function (el) {
    const k = el.getAttribute('data-fk');
    const isBool = el.getAttribute('data-ft') === 'bool' || el.type === 'checkbox';
    const isNum = el.getAttribute('data-ft') === 'num';
    const handler = function () {
      if (isBool) n[k] = !!el.checked;
      else if (isNum) n[k] = el.value === '' ? '' : Number(el.value);
      else n[k] = el.value;
      // 摘要实时刷新
      const card = document.querySelector('#canvasNodes .cnode[data-node="' + n.id + '"]');
      if (card) {
        const bd = card.querySelector('.cnode-bd');
        const hd = card.querySelector('.cnode-hd .txt');
        const sum = nodeSummary(n);
        if (bd) bd.textContent = sum;
        if (hd) hd.setAttribute('title', (NEW_TYPES[n.type] || n.type) + '｜' + sum);
      }
    };
    el.addEventListener('change', handler);
    el.addEventListener('input', function () { if (el.tagName !== 'TEXTAREA') handler(); });
    if (el.tagName === 'TEXTAREA') el.addEventListener('blur', handler);
  });

}

/* ============================================================
 * 九、工具条 / 菜单 / 弹层
 * ============================================================ */
function renderToolbarState() {
  const r = curRule();
  const name = $('canvasRuleName');
  if (name) name.value = r ? (r.name || '') : '';
  const st = $('canvasStatus');
  if (st) {
    const on = r ? r.enabled !== false : true;
    st.classList.toggle('off', !on);
    st.innerHTML = '<i class="graph-toolbare-status-icon"></i>' + (on ? '已启用' : '已停用');
    st.title = '点击切换启用 / 停用';
  }
}

function bindToolbar() {
  const name = $('canvasRuleName');
  if (name) {
    const fit = function () {
      name.style.width = '12px';
      name.style.width = Math.min(280, Math.max(24, name.scrollWidth + 8)) + 'px';
    };
    name.addEventListener('input', fit);
    name.addEventListener('change', function () {
      const r = curRule();
      if (r) r.name = name.value;
      renderTabs();
    });
    setTimeout(fit, 0);
  }
  const st = $('canvasStatus');
  if (st) st.addEventListener('click', function () {
    const r = curRule();
    if (!r) return;
    r.enabled = r.enabled === false;
    renderToolbarState();
    toast(r.enabled ? '规则已启用（记得保存）' : '规则已停用（记得保存）');
  });
  const sv = $('btnCanvasSave');
  if (sv) sv.addEventListener('click', canvasSave);
  const dn = $('btnDelNode');
  if (dn) dn.addEventListener('click', delSelectedNode);
  const cl = $('btnClear');
  if (cl) cl.addEventListener('click', function () {
    const r = curRule();
    if (!r || !(r.nodes || []).length) { toast('画布已经是空的'); return; }
    showConfirm('清空画布', '将删除当前规则内的全部节点与连线（共 ' + (r.nodes || []).length + ' 个节点），是否继续？', function () {
      r.nodes = [];
      r.links = [];
      CS.sel = null;
      renderAll();
    });
  });
  const cfg = $('btnRuleCfg');
  if (cfg) cfg.addEventListener('click', ruleSettingDialog);
  const ts = $('btnTest');
  if (ts) ts.addEventListener('click', runTest);
  const zm = $('btnZoom');
  if (zm) zm.addEventListener('click', function (e) {
    e.stopPropagation();
    toggleMenu($('zoomMenu'));
  });
  const zmenu = $('zoomMenu');
  if (zmenu) zmenu.addEventListener('click', function (e) {
    const it = e.target.closest ? e.target.closest('[data-z]') : null;
    if (!it) return;
    const z = it.getAttribute('data-z');
    if (z === 'fit') { CS.view = { x: 0, y: 0, z: 1 }; }
    else CS.view.z = Number(z) || 1;
    applyView();
    drawLinks();
    hideMenu($('zoomMenu'));
  });
  const hm = $('helpMenu');
  if (hm) hm.addEventListener('click', function (e) {
    const it = e.target.closest ? e.target.closest('[data-k]') : null;
    if (!it) return;
    hideMenu(hm);
    const k = it.getAttribute('data-k');
    if (k === 'back') { backToLive(); return; }
    if (k === 'setting') { ruleSettingDialog(); return; }
    if (k === 'shortcut') {
      showModal('快捷键指南',
        '<ul><li>Delete / Backspace：删除选中节点</li>' +
        '<li>Ctrl + S：保存规则</li>' +
        '<li>Esc：关闭属性面板 / 菜单</li>' +
        '<li>滚轮：平移画布；Ctrl + 滚轮：缩放画布</li>' +
        '<li>双击节点：打开属性面板</li></ul>');
      return;
    }
    const NAMES = { question: '问题反馈', community: '交流社区', updateLog: '更新日志', 'help-center': '使用教程' };
    showModal(NAMES[k] || '提示', '<div style="line-height:2;color:var(--text-color-level2)">本页为本地离线版，' +
      esc(NAMES[k] || '') + '入口保留占位。如需交流与反馈，请联系运维负责人。</div>');
  });
  document.addEventListener('click', function () {
    hideMenu($('zoomMenu'));
    hideMenu($('helpMenu'));
  });
  document.addEventListener('keydown', function (e) {
    const tag = (e.target && e.target.tagName) || '';
    const editing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (e.key === 'Escape') {
      hideMenu($('zoomMenu'));
      hideMenu($('helpMenu'));
      if (!editing) selectNode(null);
      return;
    }
    if (editing) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (CS.sel) { e.preventDefault(); delSelectedNode(); }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 's') {
      e.preventDefault();
      canvasSave();
    }
  });
}

function toggleMenu(el) {
  if (!el) return;
  const show = el.style.display === 'none' || !el.style.display;
  hideMenu($('zoomMenu'));
  hideMenu($('helpMenu'));
  el.style.display = show ? 'block' : 'none';
}
function hideMenu(el) { if (el) el.style.display = 'none'; }

function ruleSettingDialog() {
  const r = curRule();
  if (!r) return;
  const html =
    '<div class="row"><label>规则名称</label><input type="text" id="cfgName" value="' + esc(r.name || '') + '"></div>' +
    '<div class="row"><label>启用</label><input type="checkbox" id="cfgEnabled"' + (r.enabled === false ? '' : ' checked') + ' style="width:auto"></div>' +
    '<div class="row"><label>持续时间(s)</label><input type="number" id="cfgDur" value="' + Number(r.duration || 0) + '"></div>' +
    '<div class="row"><label>通知保持</label><select id="cfgHold">' +
    [['auto', '条件恢复即复位'], ['timed', '保持指定秒数'], ['latch', '人工确认后复位']].map(function (o) {
      return '<option value="' + o[0] + '"' + ((r.hold || 'timed') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('') + '</select></div>' +
    '<div class="row"><label>保持秒数</label><input type="number" id="cfgHoldSec" value="' + Number(r.holdSeconds == null ? 15 : r.holdSeconds) + '"></div>' +
    '<div class="tip" style="font-size:11px;color:var(--text-color-level4);line-height:1.7">' +
    '持续时间：条件成立需持续该秒数后才通知；通知保持：报警弹窗/推送的复位方式（沿用现有报警链路）。</div>';
  showModalForm('规则设置', html, function (root) {
    r.name = root.querySelector('#cfgName').value;
    r.enabled = !!root.querySelector('#cfgEnabled').checked;
    r.duration = Math.max(0, Number(root.querySelector('#cfgDur').value) || 0);
    r.hold = root.querySelector('#cfgHold').value;
    r.holdSeconds = Math.max(0, Number(root.querySelector('#cfgHoldSec').value) || 0);
    renderAll();
    toast('规则设置已更新（记得保存）');
  });
}

async function runTest() {
  const r = curRule();
  if (!r) return;
  if (!(r.nodes || []).length) { toast('画布为空，无法测试'); return; }
  try {
    const res = await window.api.testCanvas({ ruleId: r.id, tagValues: {}, varValues: {} });
    if (res && res.ok === false) { showModal('测试结果', '<div>测试失败：' + esc(res.error || '') + '</div>'); return; }
    const lines = [
      ['规则', (res.name || r.name || '')],
      ['是否触发', res.active ? '是（条件当前成立）' : '否'],
      ['触发值', String(res.value == null ? '-' : res.value)],
      ['报警级别', res.level || '-'],
      ['通知标题', res.title || '-'],
      ['通知正文', String(res.note || '-').replace(/\n/g, '<br>')],
      ['邮件推送', res.mail ? '是' : '否']
    ];
    showModal('测试结果（不写入运行状态）',
      '<table style="width:100%;table-layout:fixed">' + lines.map(function (l) {
        return '<tr><td style="width:88px;color:var(--text-color-level3)">' + esc(l[0]) +
          '</td><td style="white-space:normal">' + l[1] + '</td></tr>';
      }).join('') + '</table>');
  } catch (e) {
    showModal('测试结果', '<div>测试失败：' + esc(e.message) + '</div>');
  }
}

function showConfirm(title, text, onOk) {
  const ov = document.createElement('div');
  ov.className = 'cv-modal-ov';
  ov.innerHTML = '<div class="cv-modal"><h3>' + esc(title) + '</h3>' +
    '<div style="line-height:1.8;color:var(--text-color-level2)">' + esc(text) + '</div>' +
    '<div class="ft"><button class="cancel">取消</button><button class="ok">确认</button></div></div>';
  ($('page-canvas') || document.body).appendChild(ov);
  const close = function () { if (ov.parentNode) ov.parentNode.removeChild(ov); };
  ov.querySelector('.cancel').addEventListener('click', close);
  ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
  ov.querySelector('.ok').addEventListener('click', function () { close(); onOk(); });
}

function showModal(title, html) {
  const ov = document.createElement('div');
  ov.className = 'cv-modal-ov';
  ov.innerHTML = '<div class="cv-modal"><h3>' + esc(title) + '</h3><div>' + html + '</div>' +
    '<div class="ft"><button class="ok">知道了</button></div></div>';
  ($('page-canvas') || document.body).appendChild(ov);
  const close = function () { if (ov.parentNode) ov.parentNode.removeChild(ov); };
  ov.querySelector('.ok').addEventListener('click', close);
  ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
}

function showModalForm(title, html, onOk) {
  const ov = document.createElement('div');
  ov.className = 'cv-modal-ov';
  ov.innerHTML = '<div class="cv-modal"><h3>' + esc(title) + '</h3><div class="bd">' + html + '</div>' +
    '<div class="ft"><button class="cancel">取消</button><button class="ok">确定</button></div></div>';
  ($('page-canvas') || document.body).appendChild(ov);
  const close = function () { if (ov.parentNode) ov.parentNode.removeChild(ov); };
  ov.querySelector('.cancel').addEventListener('click', close);
  ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
  ov.querySelector('.ok').addEventListener('click', function () { close(); onOk(ov.querySelector('.bd')); });
}

/* ============================================================
 * 十、整体渲染与初始化
 * ============================================================ */
function renderAll() {
  renderTabs();
  renderToolbarState();
  renderCanvas();
  renderDrawer();
}

async function reloadVars() {
  try {
    const t = await window.api.loadTags();
    CS.tags = normalizeTags(t);
  } catch (e) { CS.tags = []; }
  try {
    const v = await window.api.loadVars();
    CS.varNames = normalizeVars(v);
  } catch (e) { CS.varNames = []; }
  CS.tagMap = {};
  CS.tags.forEach(function (t) { CS.tagMap[t.tag] = t; });
  if (CS.sel) renderDrawer();
}

/* 画布页全屏：进入画布页时隐藏应用外壳（顶栏/标签栏/状态栏），
 * 使画面与参考的极客版编辑器一致；离开画布页自动恢复。 */
function syncShell() {
  const pg = $('page-canvas');
  const on = !!(pg && pg.classList.contains('active'));
  document.body.classList.toggle('cv-full', on);
  if (on) setTimeout(function () { applyView(); drawLinks(); }, 0);
}

/* 返回主界面（实时点位），同时恢复应用外壳 */
function backToLive() {
  const tab = document.querySelector('#tabs .tab[data-t="live"]');
  if (tab) tab.click();
}

function canvasInitBindings() {
  renderSide();
  bindTabs();
  bindSide();
  bindToolbar();
  bindCanvas();
  reloadVars().then(function () { return canvasLoad(); });
  window.addEventListener('resize', function () { drawLinks(); });
  const tabsBox = $('tabs');
  if (tabsBox) tabsBox.addEventListener('click', function () { setTimeout(syncShell, 0); });
  const lgBack = document.querySelector('.app-header-menu-left');
  if (lgBack) {
    lgBack.style.cursor = 'pointer';
    lgBack.title = '返回实时点位';
    lgBack.addEventListener('click', backToLive);
  }
  syncShell();
}

window.canvasInitBindings = canvasInitBindings;
window.__canvasReloadVars = reloadVars;

})();
