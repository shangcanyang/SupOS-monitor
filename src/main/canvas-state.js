// ============================================================
// 画布运行时状态持久化
//
// 保存两类「需要跨重启保持」的运行时数据：
//   1) 变量当前值（canvasVars）—— 使写变量节点的结果重启后不丢
//   2) 节点内部状态（canvasNodeState）—— 锁存/翻转/计数/边沿/保持/脉冲等
//
// 落盘策略：调用方按节流节奏调用 save()，本模块负责瘦身（剔除 hist 这类
// 大数组与派生缓存）后原子写入 canvas-state.json。
// ============================================================

'use strict';

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const FILE = path.join(app.getPath('userData'), 'canvas-state.json');
const SKIP_FIELDS = { hist: 1, tick: 1, last: 1 }; // 历史数组 / tick 标记 / 派生缓存

function load(){
  const empty = { vars: {}, nodes: {} };
  try {
    if (!fs.existsSync(FILE)) return empty;
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!raw || typeof raw !== 'object') return empty;
    return {
      vars: (raw.vars && typeof raw.vars === 'object') ? raw.vars : {},
      nodes: (raw.nodes && typeof raw.nodes === 'object') ? raw.nodes : {}
    };
  } catch (e){
    return empty;
  }
}

// 只保留原始类型的字段，剔除 hist 等大块数据
function slimNodes(nodes){
  const out = {};
  if (!nodes || typeof nodes !== 'object') return out;
  for (const id in nodes){
    const st = nodes[id];
    if (!st || typeof st !== 'object') continue;
    const o = {};
    let has = false;
    for (const k in st){
      if (SKIP_FIELDS[k]) continue;
      const v = st[k];
      const t = typeof v;
      if (t === 'number' || t === 'boolean' || t === 'string'){
        o[k] = v;
        has = true;
      }
    }
    if (has) out[id] = o;
  }
  return out;
}

function slimVars(vars){
  const out = {};
  if (!vars || typeof vars !== 'object') return out;
  for (const k in vars){
    const v = vars[k];
    const t = typeof v;
    if (t === 'number' || t === 'boolean' || t === 'string') out[k] = v;
  }
  return out;
}

function save(vars, nodes){
  try {
    const data = JSON.stringify({
      vars: slimVars(vars),
      nodes: slimNodes(nodes),
      savedAt: Date.now()
    }, null, 2);
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, data, 'utf8');
    fs.renameSync(tmp, FILE);
    return true;
  } catch (e){
    return false;
  }
}

// 用于变化检测；不含时间戳，值没变就不会重复写盘
function signature(vars, nodes){
  return JSON.stringify(slimVars(vars)) + '|' + JSON.stringify(slimNodes(nodes));
}

function clear(){
  try { if (fs.existsSync(FILE)) fs.unlinkSync(FILE); } catch (e) {}
}

module.exports = { load, save, signature, slimNodes, slimVars, clear, FILE };
