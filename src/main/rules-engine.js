const logger = require('./logger');
const canvasEngine = require('./canvas-engine');
const canvasState = require('./canvas-state');
const varsMod = require('./vars');

// 冷却分钟规范化：空/非法 → 默认值；0 表示「只提醒一次，冷却期内不重复」
function normCooldown(v, dflt){
  if (v === null || v === undefined || v === '') return dflt;
  const n = Number(v);
  if (isNaN(n) || n < 0) return dflt;
  return n;
}

// ===== 自定义通知文案 =====
// {time} {rule} {value} 三个占位符；用户可自行编辑通知内容，留空走默认文案
function fmtTime(t){
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
         p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

function fmtValue(v){
  if (v === null || v === undefined) return '-';
  if (typeof v === 'number'){
    if (!isFinite(v)) return String(v);
    if (Number.isInteger(v)) return String(v);
    return String(Math.round(v * 100) / 100);
  }
  if (typeof v === 'boolean') return v ? '成立' : '不成立';
  return String(v);
}

// 触发值为布尔（比较节点输出）时，退回到规则内测点的实际值，避免通知里只写「成立」
function tagValueText(rt, rule){
  const parts = [];
  const nodes = (rule && rule.nodes) || [];
  for (const n of nodes){
    if ((n.type === 'tag' || n.type === 'tagStatus' ||
         n.type === 'deviceInput' || n.type === 'deviceGet' ||
         n.type === 'deviceInputSetVar' || n.type === 'deviceGetSetVar' ||
         n.type === 'statusLast') && n.tag){
      const r = rt && rt[n.tag];
      if (r && r.value !== null && r.value !== undefined && r.value !== ''){
        parts.push(n.tag + '=' + fmtValue(r.value));
      }
    }
  }
  return parts.join('，');
}

function displayValue(v, fallback){
  if (v === null || v === undefined || typeof v === 'boolean'){
    return fallback ? fallback : fmtValue(v);
  }
  return fmtValue(v);
}

// 渲染通知正文 + 拼出完整推送文本（标题/正文/时间/规则名/报警级别）
function notifyText(rule, trig, value, now, fallback){
  const tpl = (trig && typeof trig.msg === 'string' && trig.msg.trim())
    ? trig.msg.trim()
    : '【设备报警】\n规则：{rule}\n触发值：{value}\n时间：{time}';
  const body = tpl
    .replace(/\{rule\}/g, rule.name || rule.id || '')
    .replace(/\{value\}/g, displayValue(value, fallback))
    .replace(/\{time\}/g, fmtTime(now));
  // 新版「执行操作」节点的操作说明优先作为通知名（旧版通知节点无 label，行为不变）
  const actLabel = (trig && trig.type === 'deviceOutput' &&
                    typeof trig.label === 'string' && trig.label.trim()) ? trig.label.trim() : '';
  const name = actLabel ||
    ((typeof rule.name === 'string' && rule.name.trim()) ? rule.name.trim() : '自定义通知');
  const level = (trig && trig.level) || 'HH';
  const title = '【' + level + '】' + name;
  return {
    name: name,
    level: level,
    title: title,
    body: body,
    plain: title + '\n' + body + '\n时间：' + fmtTime(now),
    mail: !!(trig && trig.mail)
  };
}

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
        cooldownUntil: 0, acked: false,
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
          rt.acked = false;              // 数值回落：解除人工确认静默，下次越限重新提醒
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

      const cdMin = normCooldown(p.cooldown, 10);
      if (!rt.cooldownUntil){
        if (rt.acked){
          // 已人工确认且数值仍越限：保持静默，不再重复提醒
          rt.cooldownUntil = -1;
        } else {
          rt.inAlarm = true; rt.level = lvl;
          // 冷却 0：只提醒一次，条件持续成立也不再重复
          rt.cooldownUntil = cdMin > 0 ? now + cdMin * 60000 : -1;
          this.fire(p, rt, lvl, '首次');
        }
      } else if (rt.cooldownUntil > 0 && now >= rt.cooldownUntil){
        if (rt.acked){
          // 已人工确认：冷却到期也不再重复提醒，待数值回落正常后自动重新布防
          rt.cooldownUntil = -1;
        } else {
          rt.inAlarm = true; rt.level = lvl;
          rt.cooldownUntil = now + cdMin * 60000;
          this.fire(p, rt, lvl, '冷却到期');
        }
      }
    }

    this.tickCanvasRules(now);
  }

  // 画布规则的 tick 序号：以进程启动毫秒为基准严格递增，
  // 保证大于上一次运行落盘的状态值，避免跨重启撞号导致首个 tick 被跳过
  nextTickId(){
    if (!this._tickBase) this._tickBase = Date.now();
    this._tickSeq = (this._tickSeq || 0) + 1;
    return this._tickBase + this._tickSeq;
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

    // 运行时值视图：复用同一个对象，只在每 tick 更新字段，
    // 避免每秒为全部位号重新分配对象（CPU / GC 优化）
    if (!this._runtimeView) this._runtimeView = {};
    const runtime = this._runtimeView;
    const alive = {};
    for (const tag in this.rt){
      alive[tag] = true;
      const r = this.rt[tag];
      let v = runtime[tag];
      if (!v){ v = runtime[tag] = { value: null, status: null }; }
      v.value = r.value;
      v.status = r.status;
    }
    for (const tag in runtime){
      if (!alive[tag]) delete runtime[tag];
    }
    const state = {
      runtime,
      vars: this.canvasVars,
      nodeState: this.canvasNodeState,
      // 严格递增的 tick 序号（含进程启动时间基准，保证大于上次运行落盘的值），
      // 供 canvas-engine 的 tick 幂等判断使用，避免同一毫秒内的两次 tick 丢事件
      tickId: this.nextTickId(),
      now
    };

    for (const rule of rules){
      if (!rule.enabled) continue;
      const rid = '_cr_' + rule.id;
      if (!this.rt[rid]){
        this.rt[rid] = {
          active: false, since: 0, inAlarm: false,
          recoveredAt: 0, acked: false, lastFire: 0,
          lastValue: null, lastValueText: '', lastNote: '', mailRequested: false,
          mailSent: false, mailAt: 0
        };
      }
      const cr = this.rt[rid];

      let res;
      try { res = canvasEngine.evalRule(rule, state); }
      catch (e) { res = { active: false }; }

      let trig = canvasEngine.pickNotifyNode(rule);
      if (res.acts && res.acts.length){
        for (const a of res.acts){
          if (a.mode === 'log'){
            logger.log('画布动作 [' + (rule.name || rule.id) + '] ' +
                       (a.label || '记录日志') + (a.msg ? ' | ' + a.msg : ''));
          }
        }
        const notifyAct = res.acts.filter(a => a.mode !== 'log')[0];
        if (notifyAct) trig = notifyAct;
      }
      if (Object.prototype.hasOwnProperty.call(res, 'value')) cr.lastValue = res.value;

      // 画布规则为事件型：一次动作触发即一次报警，默认锁存到人工确认
      const hold = rule.hold || 'latch';
      const holdMs = Math.max(0, Number(rule.holdSeconds) || 0) * 1000;

      if (res.active){
        if (!cr.since) cr.since = now;
        // 条件需持续「保持秒数」后才通知（0 = 立即通知）
        // 注：旧代码这里误写成未声明的 durMs，画布规则一触发就抛 ReferenceError，
        // 弹出「Uncaught Exception: durMs is not defined」，报警完全不可用。
        if (now - cr.since < holdMs) continue;

        // 已人工确认：条件仍成立时保持静默，不重复推送/弹窗，等条件恢复后重新计数
        if (cr.acked){
          cr.inAlarm = false;
          continue;
        }

        cr.recoveredAt = 0;

        // 条件成立只提醒一次，无重复提醒节奏；需等条件恢复（下次越限）才重新提醒
        if (!cr.inAlarm){
          cr.inAlarm = true;
          cr.acked = false;
          cr.lastFire = now;
          const vTxt = tagValueText(this.rt, rule);
          cr.lastValueText = vTxt;
          const nt = notifyText(rule, trig, cr.lastValue, now, vTxt);
          cr.lastNote = nt.plain;
          cr.mailRequested = nt.mail;
          cr.mailSent = false;
          logger.log('自定义通知触发 [' + nt.level + '] ' + nt.name + ' | ' + nt.body);
          this.onAlarm();
        }
      } else {
        cr.since = 0;
        if (cr.inAlarm){
          if (hold === 'latch'){
            // 保持模式：条件恢复也不复位，等人工确认
          } else if (hold === 'timed'){
            if (!cr.recoveredAt) cr.recoveredAt = now;
            if (now - cr.recoveredAt >= holdMs){
              cr.inAlarm = false;
              cr.recoveredAt = 0;
            }
          } else {
            // 自动复位：条件恢复即复位
            cr.inAlarm = false;
            cr.recoveredAt = 0;
          }
        } else {
          cr.recoveredAt = 0;
        }
        // 条件已恢复：结束本轮确认周期，下次成立视为新一次通知
        if (cr.acked) cr.acked = false;
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
    const trig = canvasEngine.pickNotifyNode(rule);
    const now = Date.now();
    cr.inAlarm = false;
    cr.acked = true;
    cr.since = 0;
    cr.recoveredAt = 0;
    // 清空该规则内节点的记忆状态，避免节点级锁存导致确认后立即回弹
    canvasEngine.resetRuleState(rule, this.canvasNodeState);

    // 通知自定义通知节点：已人工确认（用于蓝屏/弹窗续期或收尾）
    const note = notifyText(rule || {}, trig, cr.lastValue, now,
                            cr.lastValueText || tagValueText(this.rt, rule));
    cr.lastNote = note.plain;
    try {
      if (typeof this.onAck === 'function') this.onAck(ruleId, note);
    } catch (e) {
      logger.log('确认通知回调异常：' + (e && e.message ? e.message : e));
    }

    logger.log('自定义通知人工确认：' + note.name);
    return { ok: true };
  }

  // 人工确认（测点高低限报警）：本次报警静默，不再重复弹窗；
  // 数值恢复正常后 acked 自动清零，下次越限重新提醒。
  ackPoint(tag){
    const rt = this.rt[tag];
    if (!rt) return { ok: false, error: '位号未在运行' };
    rt.inAlarm = false;
    rt.acked = true;
    logger.log('测点报警人工确认：' + tag);
    return { ok: true };
  }

  // 变量定义被增删改后调用：下一次 tick 立即重新读盘
  markVarsDirty(){
    this._varsDirty = true;
  }

  // 等待确认的报警：给通知服务用于「保持弹窗/续期」与「确认后收尾」
  findAckedAlarm(){
    const rules = this.getCanvasRules ? this.getCanvasRules() : [];
    for (const rule of rules){
      const cr = this.rt['_cr_' + rule.id];
      if (!cr || !cr.acked || cr.inAlarm) continue;
      if (cr.lastFire && this.isAckNotified(rule.id, cr.lastFire)) continue;
      const trig = canvasEngine.pickNotifyNode(rule);
      const note = notifyText(rule, trig, cr.lastValue, cr.lastFire || Date.now());
      return { ruleId: rule.id, rule: rule, note: note, lastFire: cr.lastFire };
    }
    return null;
  }

  // 确认通知已送达（按规则 + 触发时间记账，同一次报警只发一次确认）
  markAckNotified(ruleId, lastFire){
    if (!this._ackInAlarm || typeof this._ackInAlarm !== 'object') this._ackInAlarm = {};
    this._ackInAlarm[ruleId] = lastFire || Date.now();
  }

  isAckNotified(ruleId, lastFire){
    const got = this._ackInAlarm ? this._ackInAlarm[ruleId] : 0;
    return !!got && got === lastFire;
  }

  // 报警弹窗/邮件是否已按「本次触发」发过（邮件开关 true 但邮件服务不可用时不会误标）
  isMailSent(ruleId, lastFire){
    const cr = this.rt['_cr_' + ruleId];
    if (!cr) return false;
    return !!cr.mailSent && cr.mailAt === (lastFire || cr.lastFire);
  }

  markMailSent(ruleId, lastFire){
    const cr = this.rt['_cr_' + ruleId];
    if (!cr) return;
    cr.mailSent = true;
    cr.mailAt = lastFire || cr.lastFire;
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
      const trig = canvasEngine.pickNotifyNode(rule);
      const hold = rule.hold || 'auto';
      const note = notifyText(rule, trig, cr.lastValue, cr.lastFire || Date.now(),
                              cr.lastValueText || tagValueText(this.rt, rule));
      out.push({
        tag: note.name,
        desc: note.body,
        note: note.body,
        unit: '',
        value: displayValue(cr.lastValue, cr.lastValueText || tagValueText(this.rt, rule)),
        level: note.level,
        time: cr.lastFire || cr.since || Date.now(),
        thresholds: { hh: '-', h: '-', l: '-', ll: '-' },
        isTemp: false,
        device: '高级规则',
        isCanvasRule: true,
        ruleId: rule.id,
        canvasHold: hold,
        acked: !!cr.acked,
        mail: note.mail,
        lastFire: cr.lastFire
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