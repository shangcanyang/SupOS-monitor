function evalNode(rule, nodeId, values, depth) {
  depth = depth || 0;
  if (depth > 50) return null;
  const node = rule.nodes.find(n => n.id === nodeId);
  if (!node) return null;

  if (node.type === 'tag') {
    const v = values[node.tag];
    return v == null ? null : v.value;
  }
  if (node.type === 'bool') {
    const v = values[node.tag];
    if (v == null) return null;
    const val = v.value;
    return val === true || val === 1 || val === '1' || val === 'true';
  }

  const inLinks = rule.links.filter(l => l.to === nodeId);
  const ins = inLinks.map(l => evalNode(rule, l.from, values, depth + 1));

  if (node.type === 'compare') {
    const v = ins[0];
    if (typeof v !== 'number') return null;
    const t = Number(node.value);
    switch (node.op) {
      case '>=': return v >= t;
      case '>':  return v >  t;
      case '<=': return v <= t;
      case '<':  return v <  t;
      case '==': return v === t;
      case '!=': return v !== t;
    }
    return null;
  }
  if (node.type === 'range') {
    const v = ins[0];
    if (typeof v !== 'number') return null;
    return v >= Number(node.min) && v <= Number(node.max);
  }
  if (node.type === 'logic') {
    const a = ins[0], b = ins[1];
    if (node.op === 'AND') return a === true && b === true;
    if (node.op === 'OR')  return a === true || b === true;
    return null;
  }
  if (node.type === 'not') {
    return ins[0] === true ? false : (ins[0] === false ? true : null);
  }
  return null;
}

function evalRule(rule, values) {
  if (!rule.enabled) return { active: false };
  const trigger = rule.nodes.find(n => n.type === 'trigger');
  if (!trigger) return { active: false };

  const inLinks = rule.links.filter(l => l.to === trigger.id);
  if (!inLinks.length) return { active: false };

  const r = evalNode(rule, inLinks[0].from, values);
  return { active: r === true };
}

module.exports = { evalRule, evalNode };