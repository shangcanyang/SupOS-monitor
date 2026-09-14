// ============================================================
// 画布规则求值器 v2
//
// 相比 v1 的三点关键改进（解决「判断一次就结束、不能持久」）：
//   1) 同一 tick 内（now 相同）节点状态只更新一次，重复求值直接复用结果
//      —— 同一节点被多个分支引用时结果一致，不再互相打断
//   2) 记忆化按 nodeId::fromPort 缓存，被重复引用返回缓存值（v1 返回 null，
//      会让整条链在该 tick 静默失效）
//   3) 新增状态类节点（锁存 / 翻转 / 计数 / 边沿 / 保持 / 脉冲），状态记在
//      nodeState 中，由 rules-engine 落盘，重启后继续沿用
//
// 求值范围：仅新版画布规则（顶层 model:'signal'），旧画布节点不再参与求值
// ============================================================

'use strict';

const MAX_DEPTH = 200;
const MAX_HIST = 7200; // rate / stat 窗口历史上限（1s tick 约 2 小时）

// ---------------- 值转换 ----------------
function toNum(v){
  if (typeof v === 'number') return isNaN(v) ? null : v;
  if (typeof v === 'boolean' || v === null || v === undefined) return null;
  if (typeof v === 'string'){
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    return isNaN(n) ? null : n;
  }
  return null;
}

function toBool(v){
  if (v === true) return true;
  if (v === false) return false;
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string'){
    const s = v.trim().toLowerCase();
    if (['true', '1', 'on', 'yes', 'y'].indexOf(s) >= 0) return true;
    if (['false', '0', 'off', 'no', 'n', ''].indexOf(s) >= 0) return false;
    const n = Number(s);
    if (!isNaN(n)) return n !== 0;
  }
  return null;
}

function toStr(v){
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

// 常量节点 / 固定值写变量的取值
function fixedVal(node){
  if (node.valueType === 'string') return node.value == null ? '' : String(node.value);
  if (node.valueType === 'bool') return toBool(node.value);
  const n = toNum(node.value);
  return n === null ? (node.value === undefined ? null : node.value) : n;
}

// ---------------- 节点状态 ----------------
function nst(ctx, id, init){
  let st = ctx.nodeState[id];
  if (!st) st = ctx.nodeState[id] = {};
  if (init){
    for (const k in init){
      if (st[k] === undefined) st[k] = init[k];
    }
  }
  st.tick = st.tick || 0;
  return st;
}

// 时间戳状态（tick 幂等）
function tickState(st, ctx){
  if (st.tick === ctx.now) return false; // 本 tick 已更新过
  st.tick = ctx.now;
  return true;
}

// ============================================================
// 新版「高级规则」信号链（米家自动化极客版节点体系）
//   事件节点触发 → 逻辑/条件节点过滤 → 动作节点执行
//   流程/变量节点带记忆状态，随规则一并持久化（nodeState / vars）
// ============================================================
// 本进程启动时刻：用于「本自动化启用时」节点在引擎启动后触发一次
const PROCESS_START = Date.now();

function isV2Rule(rule){
  // 仅新版画布规则（顶层显式 model:signal）参与求值
  return !!(rule && rule.model === 'signal');
}

function portLinked(rule, nodeId, port){
  return (rule.links || []).some((l) =>
    l && l.to === nodeId && String(l.toPort || 'in') === port);
}

function hasOutLink(rule, nodeId){
  return (rule.links || []).some((l) => l && l.from === nodeId);
}

// 通知载体节点：取规则中的「执行操作」节点（记录日志类除外）
function pickNotifyNode(rule){
  const nodes = (rule && rule.nodes) || [];
  return nodes.find((n) => n && n.type === 'deviceOutput' && n.mode !== 'log') ||
         nodes.find((n) => n && n.type === 'deviceOutput') || null;
}

// 比较：数值优先、文本兜底；op 为空视为「不判断」返回 null
function cmpOp(v, op, target){
  if (!op) return null;
  const a = toNum(v), b = toNum(target);
  if (a !== null && b !== null){
    switch (op){
      case '==': return a === b;
      case '!=': return a !== b;
      case '>':  return a > b;
      case '<':  return a < b;
      case '>=': return a >= b;
      case '<=': return a <= b;
      default:   return null;
    }
  }
  const s = toStr(v), t = toStr(target);
  switch (op){
    case '==': return s === t;
    case '!=': return s !== t;
    case '>':  return s > t;
    case '<':  return s < t;
    case '>=': return s >= t;
    case '<=': return s <= t;
    default:   return null;
  }
}

// 星期过滤（1=周一 … 7=周日，空=每天）
function dayOk(days, d){
  const s = String(days == null ? '' : days).trim();
  if (!s) return true;
  const w = d.getDay() === 0 ? 7 : d.getDay();
  const list = s.split(',').map((x) => Number(String(x).trim()))
                .filter((n) => n >= 1 && n <= 7);
  if (!list.length) return true;
  return list.indexOf(w) >= 0;
}

// "HH:MM" → 当天分钟数；非法返回 null
function minutesOf(s){
  const m = String(s == null ? '' : s).trim().match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

function localTimeText(d){
  const p = (n) => (n < 10 ? '0' + n : String(n));
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
         p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

// 「设备触发赋值」：把位号当前值或固定值写入变量
function writeVar(ctx, node, tagValue){
  if (!node.varName) return;
  if (node.assignFrom === 'const'){
    const raw = node.constValue;
    if (raw === undefined || raw === null || raw === ''){ ctx.vars[node.varName] = ''; return; }
    const n = toNum(raw);
    ctx.vars[node.varName] = (n === null ? String(raw) : n);
  } else {
    ctx.vars[node.varName] = tagValue;
  }
}

// 清除某条规则内所有节点的记忆状态（人工确认复位时调用，保证复位彻底）
function resetRuleState(rule, nodeState){
  if (!rule || !nodeState) return 0;
  const nodes = rule.nodes || [];
  let n = 0;
  for (let i = 0; i < nodes.length; i++){
    const id = nodes[i] && nodes[i].id;
    if (id && nodeState[id] !== undefined){
      delete nodeState[id];
      n++;
    }
  }
  return n;
}

// ---------------- 求值入口 ----------------
function evalRule(rule, state){
  const none = { active: false };
  if (!rule || rule.enabled === false) return none;

  const ctx = {
    now: Number(state && state.now) || Date.now(),
    runtime: (state && state.runtime) || {},
    vars: (state && state.vars) || {},
    nodeState: (state && state.nodeState) || {},
    memo: {},
    depth: 0,
    acts: []
  };

  // 新版信号链规则：在链尾拉取求值，事件源在过程中产生边沿信号
  if (isV2Rule(rule)) return evalV2Rule(rule, ctx);

  // 旧画布规则（无 model:'signal'）不再兼容，直接忽略
  return none;
}

// 新版规则求值：从所有「链尾节点」拉取；链尾 = 出线全部悬空的节点
function evalV2Rule(rule, ctx){
  const res = { active: false, triggerId: null, value: null, actions: [] };
  const nodes = (rule.nodes || []).filter((n) => n && n.id);
  if (!nodes.length) return res;

  const sinks = nodes.filter((n) => !hasOutLink(rule, n.id));
  for (const n of sinks){
    try { evalNode(rule, n.id, ctx, 'out'); } catch (e) {}
  }

  res.actions = ctx.acts.slice();
  for (const a of res.actions){
    if (a.mode !== 'log'){ res.active = true; break; }
  }
  // 通知里的「触发值」：优先取动作节点捕获的上游值，取不到时由调用方回退到位号文本
  const first = res.actions[0];
  res.value = (first && first.value !== undefined) ? first.value : null;
  return res;
}

function evalNode(rule, nodeId, ctx, fromPort){
  const port = fromPort || 'out';
  const key = nodeId + '::' + port;
  if (Object.prototype.hasOwnProperty.call(ctx.memo, key)) return ctx.memo[key];
  ctx.memo[key] = null; // 占位，防环
  if (ctx.depth >= MAX_DEPTH) return null;

  const node = (rule.nodes || []).find((n) => n.id === nodeId);
  if (!node) return null;

  ctx.depth++;
  let out;
  try {
    out = evalV2Core(rule, node, ctx, port);
  } catch (e) {
    out = null;
  }
  ctx.depth--;
  ctx.memo[key] = out;
  return out;
}

// ---------------- v2 内容块求值（25 个新节点） ----------------
function evalV2Core(rule, node, ctx, fromPort){
  const ins = (p) => {
    const l = (rule.links || []).find((x) =>
      x && x.to === node.id && String(x.toPort || 'in') === p);
    if (!l) return null;
    return evalNode(rule, l.from, ctx, l.fromPort || 'out');
  };
  const tagVal = (tag) => {
    if (!tag) return null;
    const rt = ctx.runtime[tag];
    return rt ? rt.value : null;
  };

  switch (node.type){

    /* ---------------- 设备 ---------------- */
    // 事件发生或状态更新：位号变化 / 满足条件（上升沿）输出一拍
    case 'deviceInput': {
      if (!node.tag) return false;
      const st = nst(ctx, node.id, { inited: false, prev: null, cond: null, last: false });
      if (!tickState(st, ctx)) return st.last === true;
      const cur = tagVal(node.tag);
      const first = !st.inited;
      let ev = false;
      if (node.mode === 'match' && node.op){
        const cond = cmpOp(cur, node.op, node.value);
        ev = !first && cond === true && st.cond !== true;
        st.cond = cond;
      } else {
        ev = !first && st.prev !== null && cur !== null && String(st.prev) !== String(cur);
      }
      st.inited = true; st.prev = cur; st.last = ev;
      return ev;
    }

    // 查询当前状态：无输入，取位号当前值；配了条件则返回是否满足
    case 'deviceGet': {
      const v = tagVal(node.tag);
      if (node.op) return cmpOp(v, node.op, node.value);
      return v;
    }

    // 执行操作：报警弹窗 + 推送 / 仅记录日志（沿用现有报警链路）
    case 'deviceOutput': {
      const v = ins('in');
      if (toBool(v) !== true) return false;
      ctx.acts.push({
        id: node.id, type: 'deviceOutput',
        mode: node.mode === 'log' ? 'log' : 'notify',
        label: node.label || '', msg: node.msg || '',
        level: node.level || 'HH', mail: node.mail === true,
        value: (typeof v === 'boolean' ? null : v)
      });
      return true;
    }

    /* ---------------- 时间 ---------------- */
    // 定时：到点输出一拍（同一分钟只触发一次）
    case 'alarmClock': {
      const d = new Date(ctx.now);
      const cur = d.getHours() * 60 + d.getMinutes();
      const st = nst(ctx, node.id, { at: 0, last: false });
      if (!tickState(st, ctx)) return st.last === true;
      const list = String(node.time == null ? '' : node.time)
        .split(',').map(minutesOf).filter((x) => x !== null);
      const key = Math.floor(ctx.now / 60000);
      let ev = false;
      if (list.length && dayOk(node.days, d) && list.indexOf(cur) >= 0 && st.at !== key){
        st.at = key; ev = true;
      }
      st.last = ev;
      return ev;
    }

    // 时间段：处于时间段内为真（可取反）
    case 'timeRange': {
      const a = minutesOf(node.start), b = minutesOf(node.end);
      if (a === null || b === null) return false;
      const d = new Date(ctx.now);
      const cur = d.getHours() * 60 + d.getMinutes();
      let inside = (a <= b) ? (cur >= a && cur < b) : (cur >= a || cur < b);
      if (!dayOk(node.days, d)) inside = false;
      return node.invert === true ? !inside : inside;
    }

    // 延时：fire=触发后延时 N 秒执行一次 / hold=持续满足 N 秒 / off=触发后保持 N 秒
    case 'delay': {
      const mode = node.delayMode || 'fire';
      const sec = Math.max(0, toNum(node.seconds) || 0);
      const st = nst(ctx, node.id, { since: 0, until: 0, prev: false, last: false });
      if (!tickState(st, ctx)) return st.last === true;
      const v = toBool(ins('in')) === true;
      let out = false;
      if (mode === 'hold'){
        if (v){
          if (!st.since) st.since = ctx.now;
          out = (ctx.now - st.since) >= sec * 1000;
        } else {
          st.since = 0;
        }
      } else if (mode === 'fire'){
        if (v && !st.prev) st.until = ctx.now + sec * 1000;
        if (st.until && ctx.now >= st.until){ out = true; st.until = 0; }
      } else {
        if (v && !st.prev) st.until = ctx.now + sec * 1000;
        out = !!st.until && ctx.now < st.until;
        if (st.until && ctx.now >= st.until) st.until = 0;
      }
      st.prev = v; st.last = out;
      return out;
    }

    // 状态维持了一段时间：条件（或指定位号）连续成立 N 秒
    case 'statusLast': {
      const src = node.tag ? cmpOp(tagVal(node.tag), node.op, node.value) : toBool(ins('in'));
      const cond = src === true;
      const sec = Math.max(0, toNum(node.seconds) || 0);
      const st = nst(ctx, node.id, { since: 0, last: false });
      if (!tickState(st, ctx)) return st.last === true;
      if (cond){
        if (!st.since) st.since = ctx.now;
        st.last = (ctx.now - st.since) >= sec * 1000;
      } else {
        st.since = 0; st.last = false;
      }
      return st.last;
    }

    // 事件先后发生：事件1 之后 N 秒内事件2 发生则输出一拍
    case 'eventSequence': {
      const e1 = toBool(ins('in1')) === true;
      const e2 = toBool(ins('in2')) === true;
      const win = Math.max(0, toNum(node.window) || 0) * 1000;
      const st = nst(ctx, node.id, { at: 0, last: false });
      if (!tickState(st, ctx)) return st.last === true;
      if (e1) st.at = ctx.now;
      let out = false;
      if (e2 && st.at && (ctx.now - st.at) <= win){ out = true; st.at = 0; }
      st.last = out;
      return out;
    }

    /* ---------------- 流程 ---------------- */
    // 当-如果-就：「当」收到事件、「如果」条件成立时输出一拍
    case 'condition': {
      const ev = toBool(ins('in')) === true;
      const linked = portLinked(rule, node.id, 'cond');
      const ok = linked ? (toBool(ins('cond')) === true) : true;
      const st = nst(ctx, node.id, { prev: false, last: false });
      if (!tickState(st, ctx)) return st.last === true;
      st.last = ev && ok && !st.prev;
      st.prev = ev;
      return st.last;
    }

    // 循环：启动后每 N 秒输出一拍；可限定次数，启动结束重新计数
    case 'loop': {
      const active = toBool(ins('in')) === true;
      const sec = Math.max(1, toNum(node.seconds) || 60);
      const times = Math.max(0, Math.round(toNum(node.times) || 0));
      const st = nst(ctx, node.id, { count: 0, next: 0, on: false, last: false });
      if (!tickState(st, ctx)) return st.last === true;
      let out = false;
      if (!active){
        st.count = 0; st.next = 0; st.on = false;
      } else {
        if (!st.on){ st.on = true; st.next = ctx.now + sec * 1000; }
        if ((!times || st.count < times) && ctx.now >= st.next){
          out = true; st.count++; st.next = ctx.now + sec * 1000;
        }
      }
      st.last = out;
      return out;
    }

    // 最多触发指定次数：转发输入事件，超过次数不再转发（复位端口清零）
    case 'onlyNTimes': {
      const v = toBool(ins('in')) === true;
      const rst = toBool(ins('in2')) === true;
      const times = Math.max(1, Math.round(toNum(node.times) || 1));
      const st = nst(ctx, node.id, { count: 0, prev: false, last: false });
      if (!tickState(st, ctx)) return st.last === true;
      if (rst) st.count = 0;
      let out = false;
      if (v && !st.prev && st.count < times){ st.count++; out = true; }
      st.prev = v; st.last = out;
      return out;
    }

    // 达到指定次数时：累计到目标次数输出一拍并清零，可限定统计窗口
    case 'counter': {
      const v = toBool(ins('in')) === true;
      const rst = toBool(ins('in2')) === true;
      const target = Math.max(1, Math.round(toNum(node.target) || 1));
      const win = Math.max(0, toNum(node.window) || 0);
      const st = nst(ctx, node.id, { count: 0, prev: false, at: 0, last: false });
      if (!tickState(st, ctx)) return st.last === true;
      if (rst || (win > 0 && st.count > 0 && (ctx.now - st.at) > win * 1000)) st.count = 0;
      let out = false;
      if (v && !st.prev){
        st.count++; st.at = ctx.now;
        if (st.count >= target){ out = true; st.count = 0; }
      }
      st.prev = v; st.last = out;
      return out;
    }

    // 模式切换：每次「切换」事件切到下一个模式，当前模式名记忆在节点状态
    case 'modeSwitch': {
      const v = toBool(ins('in')) === true;
      const modes = String(node.modes == null ? '' : node.modes)
        .split(',').map((s) => s.trim()).filter(Boolean);
      const len = modes.length || 1;
      const st = nst(ctx, node.id, {
        idx: Math.max(0, Math.round(toNum(node.mode) || 0)), prev: false, last: false
      });
      if (!tickState(st, ctx)) return st.last === true;
      let out = false;
      if (v && !st.prev){ st.idx = (st.idx + 1) % len; out = true; }
      st.prev = v;
      st.mode = modes[st.idx % len] || '';
      st.last = out;
      return out;
    }

    /* ---------------- 逻辑 ---------------- */
    // 当任一事件发生
    case 'signalOr':
      return toBool(ins('in1')) === true || toBool(ins('in2')) === true ||
             toBool(ins('in3')) === true;

    // 满足任一条件
    case 'logicOr': {
      const a = toBool(ins('in1')), b = toBool(ins('in2')), c = toBool(ins('in3'));
      if (a === null && b === null && c === null) return null;
      return a === true || b === true || c === true;
    }

    // 满足全部条件（只判断已接线的端口）
    case 'logicAnd': {
      const ps = ['in1', 'in2', 'in3'].filter((p) => portLinked(rule, node.id, p));
      if (!ps.length) return null;
      for (let i = 0; i < ps.length; i++){
        if (toBool(ins(ps[i])) !== true) return false;
      }
      return true;
    }

    // 状态取反
    case 'logicNot': {
      if (!portLinked(rule, node.id, 'in')) return null;
      const v = toBool(ins('in'));
      if (v === null) return null;
      return !v;
    }

    /* ---------------- 其他 ---------------- */
    // 自定义状态：置位/复位锁存，状态记忆并随规则持久化
    case 'register': {
      const s = toBool(ins('in')) === true;
      const r = toBool(ins('in2')) === true;
      const st = nst(ctx, node.id, { value: false, last: false });
      if (!tickState(st, ctx)) return st.last === true;
      if (r) st.value = false;
      else if (s) st.value = true;
      st.last = st.value;
      return st.value;
    }

    // 本自动化启用时：规则启用后保持成立（可直接驱动「循环」等流程节点；
    // 需要「只执行一次」时接「当-如果-就」，用其上升沿取一拍）
    case 'onLoad': {
      const st = nst(ctx, node.id, { run: 0 });
      st.run = PROCESS_START;
      return true;
    }

    /* ---------------- 变量 ---------------- */
    // 设备触发赋值：位号变化（或满足条件）时把位号当前值 / 固定值写入变量
    case 'deviceInputSetVar': {
      if (!node.tag) return false;
      const st = nst(ctx, node.id, { inited: false, prev: null, cond: null, last: false });
      if (!tickState(st, ctx)) return st.last === true;
      const cur = tagVal(node.tag);
      const first = !st.inited;
      let ev = false;
      if (node.op){
        const cond = cmpOp(cur, node.op, node.value);
        ev = !first && cond === true && st.cond !== true;
        st.cond = cond;
      } else {
        ev = !first && st.prev !== null && cur !== null && String(st.prev) !== String(cur);
      }
      st.inited = true; st.prev = cur; st.last = ev;
      if (ev) writeVar(ctx, node, cur);
      return ev;
    }

    // 查询设备并赋值：触发时读取位号当前值写入变量
    case 'deviceGetSetVar': {
      if (toBool(ins('in')) !== true) return false;
      if (!node.varName || !node.tag) return true;
      ctx.vars[node.varName] = tagVal(node.tag);
      return true;
    }

    // 变量值更新：变量变化 / 满足条件时触发一拍
    case 'varChange': {
      if (!node.name) return false;
      const st = nst(ctx, node.id, { inited: false, prev: null, cond: null, last: false });
      if (!tickState(st, ctx)) return st.last === true;
      const cur = ctx.vars[node.name];
      const first = !st.inited;
      let ev = false;
      if (node.op){
        const cond = cmpOp(cur, node.op, node.value);
        ev = !first && cond === true && st.cond !== true;
        st.cond = cond;
      } else {
        ev = !first && String(st.prev) !== String(cur);
      }
      st.inited = true; st.prev = cur; st.last = ev;
      return ev;
    }

    // 查询变量值：返回变量当前值；配了条件则返回是否满足
    case 'varGet': {
      const cur = node.name ? ctx.vars[node.name] : undefined;
      if (node.op) return cmpOp(cur, node.op, node.value);
      return cur === undefined ? null : cur;
    }

    // 数值运算：触发时用左值（变量/常量）与右值（变量/常量）运算后写入变量
    case 'varSetNumber': {
      if (toBool(ins('in')) !== true) return false;
      if (!node.name) return true;
      const lv = node.fromVar ? toNum(ctx.vars[node.fromVar]) : toNum(node.a);
      const rv = node.bVar ? toNum(ctx.vars[node.bVar]) : toNum(node.b);
      let val = null, ok = false;
      switch (node.op || '+'){
        case 'set': ok = lv !== null; val = lv; break;
        case '-':   ok = lv !== null && rv !== null; val = lv - rv; break;
        case '*':   ok = lv !== null && rv !== null; val = lv * rv; break;
        case '/':   ok = lv !== null && rv !== null && rv !== 0; val = ok ? (lv / rv) : null; break;
        default:    ok = lv !== null && rv !== null; val = lv + rv;
      }
      if (ok) ctx.vars[node.name] = val;
      return true;
    }

    // 文本拼接：{变量名} / {tag:位号} / {value}（上游值）/ {time}
    case 'varSetString': {
      const upstream = ins('in');
      if (toBool(upstream) !== true) return false;
      if (!node.name) return true;
      const d = new Date(ctx.now);
      let txt = String(node.template == null ? '' : node.template);
      txt = txt.replace(/\{tag:([^}]+)\}/g, (m, t) => toStr(tagVal(String(t).trim())));
      txt = txt.replace(/\{time\}/g, localTimeText(d));
      txt = txt.replace(/\{value\}/g, typeof upstream === 'boolean' ? '' : toStr(upstream));
      txt = txt.replace(/\{([^}:{}]+)\}/g, (m, k) => {
        const key = String(k).trim();
        return ctx.vars[key] === undefined ? m : toStr(ctx.vars[key]);
      });
      ctx.vars[node.name] = txt;
      return true;
    }

    default:
      return null;
  }
}
module.exports = {
  evalRule, evalNode, toNum, toBool, toStr, resetRuleState,
  isV2Rule, pickNotifyNode
};
