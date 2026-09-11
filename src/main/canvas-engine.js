// 画布规则求值器（支持 fromPort 分支判断）
function evalNode(rule, nodeId, state, depth, visited, fromPort){
  depth = depth || 0;
  visited = visited || {};
  fromPort = fromPort || 'out';
  if (depth > 100 || visited[nodeId]) return null;

  // 用 nodeId + fromPort 作为访问标记，允许 if 的两个出口分别求值
  const visitKey = nodeId + '::' + fromPort;
  if (visited[visitKey]) return null;
  visited[visitKey] = true;

  const node = rule.nodes.find(n => n.id === nodeId);
  if (!node) return null;

  const now = state.now || Date.now();
  const runtime = state.runtime || {};
  const vars = state.vars || (state.vars = {});
  const nodeState = state.nodeState || (state.nodeState = {});

  if (node.type === 'tag'){
    const v = runtime[node.tag];
    return v ? v.value : null;
  }
  if (node.type === 'bool'){
    const v = runtime[node.tag];
    if (!v) return null;
    const val = v.value;
    return val === true || val === 1 || val === '1' || val === 'true';
  }
  if (node.type === 'tagStatus'){
    const v = runtime[node.tag];
    if (!v) return null;
    return String(v.status) === '0';
  }

  const ins = (port) => {
    const l = rule.links.find(x => x.to === nodeId && (x.toPort || 'in') === port);
    if (!l) return null;
    return evalNode(rule, l.from, state, depth + 1, visited, l.fromPort || 'out');
  };

  if (node.type === 'compare'){
    const v = ins('in');
    if (typeof v !== 'number' || isNaN(v)) return null;
    const t = Number(node.value);
    if (isNaN(t)) return null;
    switch (node.op){
      case '>=': return v >= t;
      case '>':  return v >  t;
      case '<=': return v <= t;
      case '<':  return v <  t;
      case '==': return v === t;
      case '!=': return v !== t;
    }
    return null;
  }
  if (node.type === 'range'){
    const v = ins('in');
    if (typeof v !== 'number' || isNaN(v)) return null;
    const min = Number(node.min), max = Number(node.max);
    if (isNaN(min) || isNaN(max)) return null;
    return v >= min && v <= max;
  }
  if (node.type === 'deviation'){
    const v = ins('in');
    if (typeof v !== 'number' || isNaN(v)) return null;
    const base = Number(node.base), th = Number(node.threshold);
    if (isNaN(base) || isNaN(th)) return null;
    return Math.abs(v - base) > th;
  }
  if (node.type === 'rate'){
    const v = ins('in');
    if (typeof v !== 'number' || isNaN(v)) return null;
    const th = Number(node.threshold);
    const win = Number(node.window) || 60;
    if (isNaN(th)) return null;
    if (!nodeState[nodeId]) nodeState[nodeId] = { hist: [] };
    const hist = nodeState[nodeId].hist;
    hist.push({ t: now, v });
    while (hist.length && now - hist[0].t > win * 1000) hist.shift();
    if (!hist.length) return null;
    const oldest = hist[0];
    if (now - oldest.t < win * 500) return null;
    return Math.abs(v - oldest.v) > th;
  }

  if (node.type === 'logic'){
    const a = ins('in1'), b = ins('in2');
    if (a === null || b === null) return null;
    if (node.op === 'AND') return a === true && b === true;
    if (node.op === 'OR')  return a === true || b === true;
    return null;
  }
  if (node.type === 'not'){
    const v = ins('in');
    if (v === null) return null;
    return v !== true;
  }
  if (node.type === 'xor'){
    const a = ins('in1'), b = ins('in2');
    if (a === null || b === null) return null;
    return a !== b;
  }

  if (node.type === 'duration'){
    const v = ins('in');
    if (!nodeState[nodeId]) nodeState[nodeId] = { since: 0 };
    const st = nodeState[nodeId];
    if (v === true){
      if (!st.since) st.since = now;
      const sec = Number(node.seconds) || 0;
      return (now - st.since) >= sec * 1000;
    }
    st.since = 0;
    return false;
  }
  if (node.type === 'delay'){
    const v = ins('in');
    if (!nodeState[nodeId]) nodeState[nodeId] = { since: 0 };
    const st = nodeState[nodeId];
    if (v === true){
      if (!st.since) st.since = now;
      const sec = Number(node.seconds) || 0;
      return (now - st.since) >= sec * 1000;
    }
    st.since = 0;
    return false;
  }
  if (node.type === 'timeRange'){
    const d = new Date(now);
    const cur = d.getHours() * 60 + d.getMinutes();
    const p = s => {
      const m = String(s || '').match(/^(\d{1,2}):(\d{1,2})$/);
      if (!m) return null;
      return Number(m[1]) * 60 + Number(m[2]);
    };
    const a = p(node.start), b = p(node.end);
    if (a === null || b === null) return null;
    if (a <= b) return cur >= a && cur < b;
    return cur >= a || cur < b;
  }

  if (node.type === 'varGet'){
    if (!node.name) return null;
    const v = vars[node.name];
    return v === undefined ? null : v;
  }
  if (node.type === 'varSet'){
    if (!node.name) return null;
    let v = null;
    if (node.mode === 'fixed'){
      v = node.value;
      if (node.valueType !== 'string' && v !== '' && v !== null && v !== undefined){
        const n = Number(v);
        if (!isNaN(n)) v = n;
      }
    } else {
      v = ins('in');
    }
    if (v !== null && v !== undefined) vars[node.name] = v;
    // varSet 是一个"动作"，同时也把信号继续往后传
    return true;
  }

  // ---- 分支节点 ----
  if (node.type === 'if'){
    const sig = ins('in');
    const cond = ins('cond');
    if (sig !== true) return false;
    if (cond === null) return false;
    // 根据从哪个出口追踪过来，返回对应判断
    if (fromPort === 'out_true')  return cond === true;
    if (fromPort === 'out_false') return cond === false;
    return cond === true;
  }
  if (node.type === 'merge'){
    const a = ins('in1');
    const b = ins('in2');
    return (a === true || b === true);
  }

  return null;
}

function evalRule(rule, state){
  if (!rule.enabled) return { active: false };
  const trigger = rule.nodes.find(n => n.type === 'trigger');
  if (!trigger) return { active: false };
  const l = rule.links.find(x => x.to === trigger.id && (x.toPort || 'in') === 'in');
  if (!l) return { active: false };
  const r = evalNode(rule, l.from, state, 0, {}, l.fromPort || 'out');
  return { active: r === true };
}

module.exports = { evalRule, evalNode };