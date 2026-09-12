const logger = require('./logger');
const canvasEngine = require('./canvas-engine');
const canvasState = require('./canvas-state');
const varsMod = require('./vars');

class RulesEngine {
  constructor({ getPoints, getDevices, getCanvasRules, getDevicePause, onAlarm }){
    this.getPoints = getPoints;
    this.getDevices = getDevices;
    this.getCanvasRules = getCanvasRules;
    this.getDevicePause = getDevicePause;
    this.onAlarm = onAlarm;
    this.rt = {};
    this.pausedUntil = 0;
    this.timer = null;

    // 变量运行时值与节点状态从磁盘恢复，保证画布规则跨重启继续跑
    const saved = canvasState.load();
    this.canvasVars = saved.vars || {};
    this.canvasNodeState = saved.nodes || {};
    this._persistAt = 0;
    this._persistSig = canvasState.signature(this.canvasVars, this.canvasNodeState);
  }

  getRT(tag){
    if (!this.rt[tag]){
      this.rt[tag] = {
        value: null, status: null, ts: null, lastUpdate: 0,
        inAlarm: false, level: null,
        pendingLevel: null, pendingSince: 0,
        cooldownUntil: 0,
        override: null, normalSince: 0,
        abnormal: false
      };
    }
    return this.rt[tag];
  }

  onPoint({ tag, value, status, ts }){
    const rt = this.getRT(tag);
    let v = null;
    if (value !== null && value !== undefined && value !== ''){
      const n = Number(value);
      v = isNaN(n) ? value : n;
    }
    rt.value = v;
    rt.status = status;
    rt.ts = ts;
    rt.lastUpdate = Date.now();
  }

  getDeviceOf(tag){
    if (!tag) return '未分类';
    const up = String(tag).toUpperCase();
    const devs = this.getDevices();
    for (let i = 0; i < devs.length; i++){
      const d = devs[i];
      if (!d || !d.name) continue;
      const kws = d.keywords || [];
      for (let k = 0; k < kws.length; k++){
        const kw = String(kws[k]).toUpperCase();
        if (kw && up.indexOf(kw) !== -1) return d.name;
      }
    }
    return '未分类';
  }

  isDevicePaused(dev, now){
    if (!this.getDevicePause) return false;
    const map = this.getDevicePause();
    if (!map || map[dev] === undefined) return false;
    const until = map[dev];
    if (until === 0) return true;
    return now < until;
  }

  effectiveThresholds(p){
    const rt = this.getRT(p.tag);
    const o = rt.override;
    if (o){
      if (o.expire > Date.now()) return { hh: o.hh, h: o.h, l: o.l, ll: o.ll, temp: true };
      rt.override = null;
      logger.log('临时设定值到期还原：' + p.tag);
    }
    return { hh: p.hh, h: p.h, l: p.l, ll: p.ll, temp: false };
  }

  levelOf(p, val){
    if (typeof val !== 'number' || isNaN(val)) return null;
    const t = this.effectiveThresholds(p);
    if (t.hh !== null && t.hh !== undefined && val >= t.hh) return 'HH';
    if (t.h  !== null && t.h  !== undefined && val >= t.h)  return 'H';
    if (t.ll !== null && t.ll !== undefined && val <= t.ll) return 'LL';
    if (t.l  !== null && t.l  !== undefined && val <= t.l)  return 'L';
    return null;
  }

  setOverride(tag, { hh, h, l, ll }, hours){
    const rt = this.getRT(tag);
    const n = v => (v === '' || v == null) ? null : Number(v);
    rt.override = {
      hh: n(hh), h: n(h), l: n(l), ll: n(ll),
      expire: Date.now() + (hours || 2) * 3600000
    };
    logger.log('设置临时设定值：' + tag);
  }

  start(){
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 1000);
  }
  stop(){
    if (this.timer){ clearInterval(this.timer); this.timer = null; }
  }

  pause(minutes){
    this.pausedUntil = minutes ? Date.now() + minutes * 60000 : Infinity;
    logger.log('监控已暂停');
  }
  resume(){
    this.pausedUntil = 0;
    logger.log('监控已恢复');
  }
  isPaused(){ return this.pausedUntil > Date.now(); }

  tick(){
    if (this.isPaused()) return;
    const now = Date.now();
    const points = this.getPoints();

    for (let i = 0; i < points.length; i++){
      const p = points[i];
      if (!p || !p.tag) continue;
      if (p.enabled === false) continue;

      const dev = this.getDeviceOf(p.tag);
      if (this.isDevicePaused(dev, now)){
        const rt = this.getRT(p.tag);
        rt.pendingLevel = null;
        rt.pendingSince = 0;
        continue;
      }

      const rt = this.getRT(p.tag);
      if (rt.value === null || rt.value === undefined) continue;

      if (rt.status !== null && String(rt.status) !== '0'){
        if (!rt.abnormal){
          rt.abnormal = true;
          logger.log('数据质量异常：' + p.tag, 'WARN');
        }
        continue;
      }
      if (rt.abnormal){ rt.abnormal = false; }

      const lvl = this.levelOf(p, rt.value);
      const durMs = (p.duration || 0) * 1000;

      if (lvl === null){
        rt.pendingLevel = null;
        rt.pendingSince = 0;
        if (rt.cooldownUntil && now >= rt.cooldownUntil){
          rt.cooldownUntil = 0;
          rt.inAlarm = false;
          rt.level = null;
          rt.normalSince = 0;
        }
        if (rt.override){
          if (!rt.normalSince) rt.normalSince = now;
          else if (now - rt.normalSince > 30000){
            rt.override = null;
            rt.normalSince = 0;
          }
        }
        continue;
      }
      rt.normalSince = 0;

      if (rt.pendingLevel !== lvl){
        rt.pendingLevel = lvl;
        rt.pendingSince = now;
      }
      if (now - rt.pendingSince < durMs) continue;

      if (!rt.cooldownUntil){
        rt.inAlarm = true; rt.level = lvl;
        rt.cooldownUntil = now + (p.cooldown || 10) * 60000;
        this.fire(p, rt, lvl, '首次');
      } else if (now >= rt.cooldownUntil){
        rt.inAlarm = true; rt.level = lvl;
        rt.cooldownUntil = now + (p.cooldown || 10) * 60000;
        this.fire(p, rt, lvl, '冷却到期');
      }
    }

    this.tickCanvasRules(now);
  }

  tickCanvasRules(now){
    // 每 tick 加载变量定义，把缺省值填入运行时
    try {
      const defs = varsMod.load().vars || [];
      const seen = {};
      for (const v of defs){
        seen[v.name] = true;
        if (this.canvasVars[v.name] === undefined){
          this.canvasVars[v.name] = v.init;
        }
      }
      // 已删除的变量从运行时清理
      for (const k in this.canvasVars){
        if (!seen[k]) delete this.canvasVars[k];
      }
    } catch (e) {}

    const rules = this.getCanvasRules ? this.getCanvasRules() : [];
    if (!rules || !rules.length){
      this.persistCanvasState(now);
      return;
    }

    const runtime = {};
    for (const tag in this.rt){
      runtime[tag] = { value: this.rt[tag].value, status: this.rt[tag].status };
    }
    const state = {
      runtime,
      vars: this.canvasVars,
      nodeState: this.canvasNodeState,
      now
    };

    for (const rule of rules){
      if (!rule.enabled) continue;
      const rid = '_cr_' + rule.id;
      if (!this.rt[rid]){
        this.rt[rid] = {
          active: false, since: 0, cooldownUntil: 0, inAlarm: false,
          recoveredAt: 0, acked: false, lastFire: 0
        };
      }
      const cr = this.rt[rid];

      let res;
      try { res = canvasEngine.evalRule(rule, state); }
      catch (e) { res = { active: false }; }

      const hold = rule.hold || 'auto';                                       // auto | timed | latch
      const holdMs = Math.max(0, Number(rule.holdSeconds) || 0) * 1000;
      const cooldownMs = Math.max(0, Number(rule.cooldown) || 0) * 60000;

      if (res.active){
        cr.recoveredAt = 0;
        if (!cr.since) cr.since = now;
        const durMs = (rule.duration || 0) * 1000;
        if (now - cr.since < durMs) continue;

        // 保持模式且已人工确认：条件仍未恢复时只维持报警显示，不重复推送/弹窗
        if (hold === 'latch' && cr.acked){
          cr.inAlarm = true;
          continue;
        }

        if (!cr.cooldownUntil){
          cr.inAlarm = true;
          cr.acked = false;
          cr.cooldownUntil = now + cooldownMs;
          cr.lastFire = now;
          logger.log('画布规则触发 [首次] ' + (rule.name || rule.id));
          this.onAlarm();
        } else if (now >= cr.cooldownUntil){
          cr.inAlarm = true;
          cr.acked = false;
          cr.cooldownUntil = now + cooldownMs;
          cr.lastFire = now;
          logger.log('画布规则触发 [冷却到期] ' + (rule.name || rule.id));
          this.onAlarm();
        }
        // 冷却期内条件持续成立：报警保持显示，但不重复推送，等待冷却到期再提醒
      } else {
        cr.since = 0;
        if (cr.inAlarm){
          if (hold === 'latch'){
            // 保持模式：条件恢复也不复位，等人工确认
            if (cr.acked){
              cr.inAlarm = false;
              cr.acked = false;
              cr.cooldownUntil = 0;
            }
          } else if (hold === 'timed'){
            if (!cr.recoveredAt) cr.recoveredAt = now;
            if (now - cr.recoveredAt >= holdMs){
              cr.inAlarm = false;
              cr.recoveredAt = 0;
              cr.cooldownUntil = 0;
            }
          } else {
            // 自动复位：条件恢复即复位（冷却只用于重复提醒节奏）
            cr.inAlarm = false;
            cr.recoveredAt = 0;
            cr.cooldownUntil = 0;
          }
        } else {
          cr.recoveredAt = 0;
          // 条件已恢复：结束本轮确认周期，下次成立视为新一次报警
          if (cr.acked) cr.acked = false;
          if (cr.cooldownUntil && now >= cr.cooldownUntil) cr.cooldownUntil = 0;
        }
      }
    }

    this.persistCanvasState(now);
  }

  // 人工确认复位（保持模式的画布规则）
  ackRule(ruleId){
    const cr = this.rt['_cr_' + ruleId];
    if (!cr) return { ok: false, error: '规则未在运行' };
    const rules = this.getCanvasRules ? this.getCanvasRules() : [];
    const rule = rules.find((r) => r.id === ruleId);
    const now = Date.now();
    cr.inAlarm = false;
    cr.acked = true;
    cr.since = 0;
    cr.recoveredAt = 0;
    // 清空该规则内节点的记忆状态，避免节点级锁存导致确认后立即回弹
    canvasEngine.resetRuleState(rule, this.canvasNodeState);
    // 确认后重新计冷却，避免条件仍成立时立刻再次弹出
    cr.cooldownUntil = now + Math.max(0, Number(rule && rule.cooldown) || 0) * 60000;
    logger.log('画布规则人工确认复位：' + ((rule && rule.name) || ruleId));
    return { ok: true };
  }

  // 变量值与节点状态落盘（节流 + 变化检测，避免频繁写盘）
  persistCanvasState(now){
    if (now - this._persistAt < 10000) return;
    const sig = canvasState.signature(this.canvasVars, this.canvasNodeState);
    if (sig === this._persistSig) return;
    this._persistAt = now;
    this._persistSig = sig;
    canvasState.save(this.canvasVars, this.canvasNodeState);
  }

  fire(p, rt, lvl, reason){
    const dev = this.getDeviceOf(p.tag);
    logger.log('触发报警 [' + reason + '] [' + dev + '] ' + p.tag + ' = ' + rt.value + ' (' + lvl + ')');
    this.onAlarm();
  }

  collectActive(){
    const out = [];
    const points = this.getPoints();
    const now = Date.now();
    for (let i = 0; i < points.length; i++){
      const p = points[i];
      const rt = this.rt[p.tag];
      if (!rt || !rt.inAlarm) continue;
      const dev = this.getDeviceOf(p.tag);
      if (this.isDevicePaused(dev, now)) continue;
      const t = this.effectiveThresholds(p);
      out.push({
        tag: p.tag, desc: p.desc || '', unit: p.unit || '',
        value: rt.value, level: rt.level, time: rt.lastUpdate,
        thresholds: { hh: t.hh, h: t.h, l: t.l, ll: t.ll },
        isTemp: t.temp,
        device: dev
      });
    }
    const rules = this.getCanvasRules ? this.getCanvasRules() : [];
    for (const rule of rules){
      const rid = '_cr_' + rule.id;
      const cr = this.rt[rid];
      if (!cr || !cr.inAlarm) continue;
      const trig = rule.nodes.find(n => n.type === 'trigger');
      const hold = rule.hold || 'auto';
      out.push({
        tag: rule.name || '画布规则',
        desc: (hold === 'latch' && !cr.acked)
          ? '画布规则触发（保持中，需确认复位）'
          : '画布规则触发',
        unit: '',
        value: '-',
        level: (trig && trig.level) || 'HH',
        time: cr.lastFire || cr.since || Date.now(),
        thresholds: { hh: '-', h: '-', l: '-', ll: '-' },
        isTemp: false,
        device: '高级规则',
        isCanvasRule: true,
        ruleId: rule.id,
        canvasHold: hold,
        acked: !!cr.acked
      });
    }
    return out;
  }

  snapshot(){
    const out = {};
    const points = this.getPoints();
    const now = Date.now();
    for (let i = 0; i < points.length; i++){
      const p = points[i];
      const rt = this.rt[p.tag];
      if (!rt){
        out[p.tag] = { value: null, status: null, lastUpdate: 0, inAlarm: false, level: null,
                       thresholds: { hh: p.hh, h: p.h, l: p.l, ll: p.ll }, isTemp: false,
                       devicePaused: false };
        continue;
      }
      const t = this.effectiveThresholds(p);
      const dev = this.getDeviceOf(p.tag);
      out[p.tag] = {
        value: rt.value, status: rt.status, lastUpdate: rt.lastUpdate,
        inAlarm: rt.inAlarm, level: rt.level,
        thresholds: { hh: t.hh, h: t.h, l: t.l, ll: t.ll },
        isTemp: t.temp,
        devicePaused: this.isDevicePaused(dev, now)
      };
    }
    return out;
  }
}

module.exports = RulesEngine;