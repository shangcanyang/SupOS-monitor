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
// 节点清单（30 种）：
//   数据源  tag / bool / tagStatus / constN
//   判断    compare / range / deviation / rate / textCmp
//   逻辑    logic / not / xor
//   流程    if / merge
//   时间    duration / delay / hold / pulse / timeRange
//   状态    latch / toggle / edge / counter
//   运算    arith / mathFn / scale / stat
//   变量    varGet / varSet
//   触发    trigger
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

  const nodes = rule.nodes || [];
  const trigger = nodes.find((n) => n.type === 'trigger');
  if (!trigger) return none;

  const link = (rule.links || []).find((l) =>
    l.to === trigger.id && String(l.toPort || 'in') === 'in');
  if (!link) return none;

  const ctx = {
    now: Number(state && state.now) || Date.now(),
    runtime: (state && state.runtime) || {},
    vars: (state && state.vars) || {},
    nodeState: (state && state.nodeState) || {},
    memo: {},
    depth: 0
  };

  let active = false;
  try {
    active = evalNode(rule, link.from, ctx, link.fromPort || 'out') === true;
  } catch (e) {
    active = false;
  }
  return { active: active, triggerId: trigger.id };
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
    out = evalCore(rule, node, ctx, port);
  } catch (e) {
    out = null;
  }
  ctx.depth--;
  ctx.memo[key] = out;
  return out;
}

function evalCore(rule, node, ctx, fromPort){
  const ins = (p) => {
    const l = (rule.links || []).find((x) =>
      x.to === node.id && String(x.toPort || 'in') === p);
    if (!l) return null;
    return evalNode(rule, l.from, ctx, l.fromPort || 'out');
  };
  const inA = () => { // 单输入端口兼容 in1 / in
    const v = ins('in1');
    return (v === null || v === undefined) ? ins('in') : v;
  };

  switch (node.type){

    // ---------------- 数据源 ----------------
    case 'tag': {
      const rt = ctx.runtime[node.tag];
      return rt ? rt.value : null;
    }

    case 'bool': {
      const rt = ctx.runtime[node.tag];
      if (!rt) return null;
      return toBool(rt.value);
    }

    case 'tagStatus': {
      const rt = ctx.runtime[node.tag];
      if (!rt) return null;
      if (node.invert === true) return String(rt.status) !== '0';
      return String(rt.status) === '0';
    }

    case 'constN':
      return fixedVal(node);

    // ---------------- 判断 ----------------
    case 'compare': {
      const v = toNum(inA());
      const t = toNum(node.value);
      if (v === null || t === null) return null;
      switch (node.op){
        case '>':  return v > t;
        case '<':  return v < t;
        case '>=': return v >= t;
        case '<=': return v <= t;
        case '!=': return v !== t;
        default:   return v === t;
      }
    }

    case 'range': {
      const v = toNum(inA());
      const min = toNum(node.min);
      const max = toNum(node.max);
      if (v === null) return null;
      if (min === null && max === null) return null;
      const inside = (min === null || v >= min) && (max === null || v <= max);
      return node.invert === true ? !inside : inside;
    }

    case 'deviation': {
      const v = toNum(inA());
      const base = toNum(node.base);
      const th = toNum(node.threshold);
      if (v === null || base === null || th === null) return null;
      return Math.abs(v - base) > th;
    }

    case 'rate': {
      const v = toNum(inA());
      const th = toNum(node.threshold);
      const win = Math.max(1, toNum(node.window) || 60);
      if (v === null || th === null) return null;
      const st = nst(ctx, node.id, { hist: [] });
      if (tickState(st, ctx)){
        st.hist.push([ctx.now, v]);
        if (st.hist.length > MAX_HIST) st.hist.splice(0, st.hist.length - MAX_HIST);
        const cut = ctx.now - win * 1000;
        while (st.hist.length && st.hist[0][0] < cut) st.hist.shift();
        const oldest = st.hist[0];
        // 窗口未积够 1/2 时间时不判定，避免刚启动就误报
        st.last = (ctx.now - oldest[0] >= win * 500) && (Math.abs(v - oldest[1]) > th);
      }
      return st.last === true;
    }

    case 'textCmp': {
      const v = toStr(inA());
      const op = node.op || 'eq';
      const pat = node.value == null ? '' : String(node.value);
      const ci = node.ignoreCase === true;
      const a = ci ? v.toLowerCase() : v;
      const b = ci ? pat.toLowerCase() : pat;
      switch (op){
        case 'eq':          return a === b;
        case 'ne':          return a !== b;
        case 'contains':    return b !== '' && a.indexOf(b) >= 0;
        case 'notContains': return b === '' || a.indexOf(b) < 0;
        case 'startsWith':  return b !== '' && a.indexOf(b) === 0;
        case 'endsWith':    return b !== '' && a.lastIndexOf(b) === a.length - b.length;
        case 'empty':       return v === '';
        case 'notEmpty':    return v !== '';
        case 'regex':
          try { return new RegExp(pat, ci ? 'i' : '').test(v); }
          catch (e){ return null; }
        default: return null;
      }
    }

    // ---------------- 逻辑 ----------------
    case 'logic': {
      const a = toBool(ins('in1'));
      const b = toBool(ins('in2'));
      if (a === null || b === null) return null;
      switch (node.op){
        case 'OR':   return a || b;
        case 'NAND': return !(a && b);
        case 'NOR':  return !(a || b);
        default:     return a && b;
      }
    }

    case 'not': {
      const b = toBool(inA());
      return b === null ? null : !b;
    }

    case 'xor': {
      const a = toBool(ins('in1'));
      const b = toBool(ins('in2'));
      if (a === null || b === null) return null;
      return a !== b;
    }

    // ---------------- 流程 ----------------
    case 'if': {
      const condIn = ins('cond');
      const sigIn = ins('in');
      let cond = condIn;
      // 兼容：条件端口没接线时，直接把信号端口的值当条件，避免「只连一路就永远不通」
      if (cond === null && (typeof sigIn === 'boolean' || typeof sigIn === 'number')) cond = sigIn;
      if (cond === null) return false;
      // 条件端口独立接线、且信号端口也接了线时，信号必须为真（保持 v1 语义）
      if (condIn !== null && sigIn !== null && toBool(sigIn) !== true) return false;
      const c = toBool(cond);
      if (c === null) return false;
      return fromPort === 'out_false' ? c === false : c === true;
    }

    case 'merge': {
      return ins('in1') === true || ins('in2') === true || ins('in3') === true;
    }

    // ---------------- 时间 ----------------
    case 'duration': {
      const v = toBool(inA()) === true;
      const sec = Math.max(0, toNum(node.seconds) || 0);
      const st = nst(ctx, node.id, { since: 0 });
      if (tickState(st, ctx)){
        if (v){
          if (!st.since) st.since = ctx.now;
          st.last = (ctx.now - st.since) >= sec * 1000;
        } else {
          st.since = 0;
          st.last = false;
        }
      }
      return st.last === true;
    }

    case 'delay': {
      const v = toBool(inA()) === true;
      const sec = Math.max(0, toNum(node.seconds) || 0);
      const st = nst(ctx, node.id, { since: 0 });
      if (tickState(st, ctx)){
        if (v){
          if (!st.since) st.since = ctx.now;
          st.last = (ctx.now - st.since) >= sec * 1000;
        } else {
          st.since = 0;
          st.last = false;
        }
      }
      return st.last === true;
    }

    // 保持（延时释放）：输入为真立即输出真，输入转假后再保持 N 秒
    case 'hold': {
      const v = toBool(inA()) === true;
      const sec = Math.max(0, toNum(node.seconds) || 0);
      const st = nst(ctx, node.id, { offAt: 0, value: false });
      if (tickState(st, ctx)){
        if (v){
          st.value = true;
          st.offAt = 0;
        } else if (st.value){
          if (!st.offAt) st.offAt = ctx.now;
          if (ctx.now - st.offAt >= sec * 1000){
            st.value = false;
            st.offAt = 0;
          }
        }
        st.last = st.value;
      }
      return st.last === true;
    }

    // 脉冲：输入上升沿后输出固定时长
    case 'pulse': {
      const v = toBool(inA()) === true;
      const sec = Math.max(1, toNum(node.seconds) || 1);
      const st = nst(ctx, node.id, { until: 0, prev: false });
      if (tickState(st, ctx)){
        if (v && !st.prev) st.until = ctx.now + sec * 1000;
        st.prev = v;
        st.last = st.until > ctx.now;
      }
      return st.last === true;
    }

    case 'timeRange': {
      const d = new Date(ctx.now);
      const cur = d.getHours() * 60 + d.getMinutes();
      const days = String(node.days == null ? '' : node.days).trim();
      if (days){
        const w = d.getDay() === 0 ? 7 : d.getDay();
        const list = days.split(',').map((s) => Number(String(s).trim()))
          .filter((n) => n >= 1 && n <= 7);
        if (list.length && list.indexOf(w) < 0) return false;
      }
      const parse = (s) => {
        const m = String(s).trim().match(/^(\d{1,2}):(\d{1,2})$/);
        if (!m) return null;
        const h = Number(m[1]), mi = Number(m[2]);
        if (h > 23 || mi > 59) return null;
        return h * 60 + mi;
      };
      const starts = String(node.start == null ? '' : node.start).split(',').filter((s) => s.trim());
      const ends = String(node.end == null ? '' : node.end).split(',').filter((s) => s.trim());
      if (!starts.length) return null;
      let any = false;
      for (let i = 0; i < starts.length; i++){
        const a = parse(starts[i]);
        const b = parse(ends[i] || ends[0] || '');
        if (a === null || b === null) continue;
        any = true;
        if (a <= b ? (cur >= a && cur < b) : (cur >= a || cur < b)) return true;
      }
      return any ? false : null;
    }

    // ---------------- 状态 ----------------
    case 'latch': { // RS 锁存：输出保持，直到被复位
      const s = toBool(ins('in1')) === true;
      const r = toBool(ins('in2')) === true;
      const st = nst(ctx, node.id, { value: false });
      if (tickState(st, ctx)){
        if (node.op === 'rs'){ // 复位优先
          if (r) st.value = false;
          else if (s) st.value = true;
        } else {               // 置位优先（默认）
          if (s) st.value = true;
          else if (r) st.value = false;
        }
        st.last = st.value;
      }
      return st.last === true;
    }

    case 'toggle': { // 状态翻转
      const v = toBool(inA()) === true;
      const rst = toBool(ins('in2')) === true;
      const st = nst(ctx, node.id, { value: false, prev: false });
      if (tickState(st, ctx)){
        if (rst) st.value = false;
        else if (v && !st.prev) st.value = !st.value;
        st.prev = v;
        st.last = st.value;
      }
      return st.last === true;
    }

    case 'edge': { // 边沿检测
      const v = toBool(inA()) === true;
      const dir = node.dir || 'rise';
      const st = nst(ctx, node.id, { prev: false });
      if (tickState(st, ctx)){
        if (dir === 'fall') st.last = !v && st.prev;
        else if (dir === 'both') st.last = v !== st.prev;
        else st.last = v && !st.prev;
        st.prev = v;
      }
      return st.last === true;
    }

    case 'counter': { // 计数器
      const v = toBool(inA()) === true;
      const rst = toBool(ins('in2')) === true;
      const target = Math.max(1, Math.round(toNum(node.target) || 1));
      const st = nst(ctx, node.id, { count: 0, prev: false });
      if (tickState(st, ctx)){
        if (rst) st.count = 0;
        else if (v && !st.prev) st.count++;
        st.prev = v;
        const mode = node.mode || 'bool';
        if (mode === 'value') st.last = st.count;
        else if (mode === 'pulse') st.last = st.count > 0 && st.count % target === 0;
        else st.last = st.count >= target;
      }
      return (node.mode === 'value') ? toNum(st.last) : st.last === true;
    }

    // ---------------- 运算 ----------------
    case 'arith': {
      const a = toNum(ins('in1'));
      let b = toNum(ins('in2'));
      if (b === null) b = toNum(node.value);
      if (a === null || b === null) return null;
      switch (node.op){
        case '-':   return a - b;
        case '*':   return a * b;
        case '/':   return b === 0 ? null : a / b;
        case '%':   return b === 0 ? null : a % b;
        case 'max': return Math.max(a, b);
        case 'min': return Math.min(a, b);
        case 'pow': return Math.pow(a, b);
        default:    return a + b;
      }
    }

    case 'mathFn': {
      const v = toNum(inA());
      if (v === null) return null;
      const digits = Math.max(0, Math.min(6, Math.round(toNum(node.digits) || 0)));
      const k = Math.pow(10, digits);
      switch (node.fn){
        case 'round': return Math.round(v * k) / k;
        case 'floor': return Math.floor(v);
        case 'ceil':  return Math.ceil(v);
        case 'sqrt':  return v < 0 ? null : Math.sqrt(v);
        case 'neg':   return -v;
        case 'log10': return v <= 0 ? null : Math.log10(v);
        case 'ln':    return v <= 0 ? null : Math.log(v);
        default:      return Math.abs(v);
      }
    }

    case 'scale': { // 线性映射
      const v = toNum(inA());
      if (v === null) return null;
      const i0 = toNum(node.inMin), i1 = toNum(node.inMax);
      const o0 = toNum(node.outMin), o1 = toNum(node.outMax);
      if (i0 === null || i1 === null || o0 === null || o1 === null) return null;
      if (i1 === i0) return o0;
      let r = o0 + (v - i0) * (o1 - o0) / (i1 - i0);
      if (node.clamp === true){
        r = Math.max(Math.min(o0, o1), Math.min(Math.max(o0, o1), r));
      }
      return r;
    }

    case 'stat': { // 窗口统计
      const v = toNum(inA());
      const win = Math.max(1, toNum(node.window) || 60);
      const st = nst(ctx, node.id, { hist: [] });
      if (tickState(st, ctx)){
        if (v !== null){
          st.hist.push([ctx.now, v]);
          if (st.hist.length > MAX_HIST) st.hist.splice(0, st.hist.length - MAX_HIST);
        }
        const cut = ctx.now - win * 1000;
        while (st.hist.length && st.hist[0][0] < cut) st.hist.shift();
        const arr = st.hist.map((x) => x[1]);
        if (!arr.length){
          st.last = null;
        } else {
          const fn = node.fn || 'avg';
          if (fn === 'max') st.last = Math.max.apply(null, arr);
          else if (fn === 'min') st.last = Math.min.apply(null, arr);
          else if (fn === 'sum') st.last = arr.reduce((a, b) => a + b, 0);
          else if (fn === 'range') st.last = Math.max.apply(null, arr) - Math.min.apply(null, arr);
          else if (fn === 'std'){
            const m = arr.reduce((a, b) => a + b, 0) / arr.length;
            st.last = Math.sqrt(arr.reduce((a, b) => a + (b - m) * (b - m), 0) / arr.length);
          } else {
            st.last = arr.reduce((a, b) => a + b, 0) / arr.length;
          }
        }
      }
      return (st.last === undefined) ? null : st.last;
    }

    // ---------------- 变量 ----------------
    case 'varGet': {
      if (!node.name) return null;
      const v = ctx.vars[node.name];
      if (v === undefined || v === null) return node.fallback === undefined ? null : node.fallback;
      return v;
    }

    case 'varSet': {
      if (!node.name) return true;
      const mode = node.mode || 'input';
      const st = nst(ctx, node.id, {});
      if (mode === 'fixed'){
        if (tickState(st, ctx)) ctx.vars[node.name] = fixedVal(node);
        return true;
      }
      const fire = toBool(inA()) === true;
      if (tickState(st, ctx)){
        if (fire){
          if (mode === 'inc'){
            const cur = toNum(ctx.vars[node.name]);
            ctx.vars[node.name] = (cur === null ? 0 : cur) + (toNum(node.step) || 1);
          } else {
            const v = ins('in1');
            const val = (v === null || v === undefined) ? ins('in') : v;
            if (val !== null && val !== undefined) ctx.vars[node.name] = val;
          }
        }
        st.last = true;
      }
      return true;
    }

    // ---------------- 触发 ----------------
    case 'trigger':
      return ins('in') === true;

    default:
      return null;
  }
}

module.exports = { evalRule, evalNode, toNum, toBool, toStr, resetRuleState };
