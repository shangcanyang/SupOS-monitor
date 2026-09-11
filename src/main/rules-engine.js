const logger = require('./logger');
const canvasEngine = require('./canvas-engine');

class RulesEngine {
  constructor({ getPoints, getDevices, getCanvasRules, onAlarm }){
    this.getPoints = getPoints;
    this.getDevices = getDevices;
    this.getCanvasRules = getCanvasRules;
    this.onAlarm = onAlarm;
    this.rt = {};
    this.pausedUntil = 0;
    this.timer = null;
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
    logger.log('设置临时设定值：' + tag + ' HH=' + rt.override.hh + ' H=' + rt.override.h +
               ' L=' + rt.override.l + ' LL=' + rt.override.ll);
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
    logger.log('监控已暂停' + (minutes ? ' ' + minutes + ' 分钟' : '（手动恢复）'));
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
      const rt = this.getRT(p.tag);
      if (rt.value === null || rt.value === undefined) continue;

      if (rt.status !== null && String(rt.status) !== '0'){
        if (!rt.abnormal){
          rt.abnormal = true;
          logger.log('数据质量异常：' + p.tag + ' status=' + rt.status + '，暂不判断', 'WARN');
        }
        continue;
      }
      if (rt.abnormal){ rt.abnormal = false; logger.log('数据质量恢复：' + p.tag); }

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
            logger.log('数值回落，临时设定值已还原：' + p.tag);
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
    const rules = this.getCanvasRules ? this.getCanvasRules() : [];
    if (!rules || !rules.length) return;

    for (const rule of rules){
      if (!rule.enabled) continue;
      const rid = '_cr_' + rule.id;
      if (!this.rt[rid]){
        this.rt[rid] = { active: false, since: 0, cooldownUntil: 0, inAlarm: false, lastLevel: '' };
      }
      const cr = this.rt[rid];

      let res;
      try { res = canvasEngine.evalRule(rule, this.rt); }
      catch (e) { res = { active: false }; }

      if (!res.active){
        cr.since = 0;
        if (cr.cooldownUntil && now >= cr.cooldownUntil){
          cr.cooldownUntil = 0;
          cr.inAlarm = false;
        }
        continue;
      }

      if (!cr.since) cr.since = now;

      const durMs = (rule.duration || 0) * 1000;
      if (now - cr.since < durMs) continue;

      if (!cr.cooldownUntil){
        cr.inAlarm = true;
        cr.cooldownUntil = now + (rule.cooldown || 10) * 60000;
        logger.log('画布规则触发 [首次] ' + rule.name);
        this.onAlarm();
      } else if (now >= cr.cooldownUntil){
        cr.inAlarm = true;
        cr.cooldownUntil = now + (rule.cooldown || 10) * 60000;
        logger.log('画布规则触发 [冷却到期] ' + rule.name);
        this.onAlarm();
      }
    }
  }

  fire(p, rt, lvl, reason){
    const dev = this.getDeviceOf(p.tag);
    logger.log('触发报警 [' + reason + '] [' + dev + '] ' + p.tag + ' = ' + rt.value + ' (' + lvl + ')');
    this.onAlarm();
  }

  collectActive(){
    const out = [];
    const points = this.getPoints();
    for (let i = 0; i < points.length; i++){
      const p = points[i];
      const rt = this.rt[p.tag];
      if (!rt || !rt.inAlarm) continue;
      const t = this.effectiveThresholds(p);
      out.push({
        tag: p.tag, desc: p.desc || '', unit: p.unit || '',
        value: rt.value, level: rt.level, time: rt.lastUpdate,
        thresholds: { hh: t.hh, h: t.h, l: t.l, ll: t.ll },
        isTemp: t.temp,
        device: this.getDeviceOf(p.tag)
      });
    }
    const rules = this.getCanvasRules ? this.getCanvasRules() : [];
    for (const rule of rules){
      const rid = '_cr_' + rule.id;
      const cr = this.rt[rid];
      if (!cr || !cr.inAlarm) continue;
      const trig = rule.nodes.find(n => n.type === 'trigger');
      out.push({
        tag: rule.name || '画布规则',
        desc: '画布规则触发',
        unit: '',
        value: '-',
        level: (trig && trig.level) || 'HH',
        time: Date.now(),
        thresholds: { hh: '-', h: '-', l: '-', ll: '-' },
        isTemp: false,
        device: '高级规则'
      });
    }
    return out;
  }

  snapshot(){
    const out = {};
    const points = this.getPoints();
    for (let i = 0; i < points.length; i++){
      const p = points[i];
      const rt = this.rt[p.tag];
      if (!rt) {
        out[p.tag] = { value: null, status: null, lastUpdate: 0, inAlarm: false, level: null,
                       thresholds: { hh: p.hh, h: p.h, l: p.l, ll: p.ll }, isTemp: false };
        continue;
      }
      const t = this.effectiveThresholds(p);
      out[p.tag] = {
        value: rt.value, status: rt.status, lastUpdate: rt.lastUpdate,
        inAlarm: rt.inAlarm, level: rt.level,
        thresholds: { hh: t.hh, h: t.h, l: t.l, ll: t.ll },
        isTemp: t.temp
      };
    }
    return out;
  }

  getRTStatus(tag){
    const rt = this.rt[tag];
    if (!rt) return { status: null, override: null };
    return { status: rt.status, override: rt.override };
  }
}

module.exports = RulesEngine;