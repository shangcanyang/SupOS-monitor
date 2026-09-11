const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const logger = require('./logger');
const config = require('./config');
const mailer = require('./mailer');

let timer = null;
let busy = false;
let started = false;

const MUTE_KEYWORDS = ['关闭', '停用', '停止', '静音', '暂停', 'stop', 'mute', 'disable'];
const UNMUTE_KEYWORDS = ['开启', '启动', '启用', '恢复', 'start', 'unmute', 'enable', 'resume'];

function matchAny(text, keywords){
  const t = String(text || '').toLowerCase();
  for (const kw of keywords){
    if (t.indexOf(kw.toLowerCase()) >= 0) return true;
  }
  return false;
}

function isFromAllowed(fromAddr, toList){
  if (!fromAddr) return false;
  const f = fromAddr.toLowerCase();
  return toList.includes(f);
}

// 只处理"回复"邮件：主题以 Re:/RE:/回复 开头
function isReplyMail(subject){
  const s = String(subject || '').trim();
  return /^(Re:|RE:|re:|回复[：:]|答复[：:])/i.test(s);
}

// ============================================================
// 处理指令
// ============================================================
async function handleCommand(cmd, cfg, fromAddr){
  if (cmd === 'mute'){
    if (cfg.mail.alertMuted){
      logger.log('【邮件指令】已经处于静音状态，忽略');
      return;
    }
    cfg.mail.alertMuted = true;
    cfg.mail.mutedAt = Date.now();
    cfg.mail.mutedBy = fromAddr;
    config.save(cfg);
    logger.log('【邮件指令】√ 暂停邮件报警（来自 ' + fromAddr + '）');

    const subject = '【SupOS-monitor 确认】邮件报警已暂停';
    const text = '已收到您的指令，邮件报警已暂停。\n' +
                 '回复"开启"或"恢复"可恢复。\n\n' +
                 '时间：' + logger.fmtDT(new Date()) + '\n';
    const html =
      '<div style="font-family:\'Microsoft YaHei\',Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;">' +
      '<div style="background:linear-gradient(135deg,#16a34a,#15803d);border-radius:10px;padding:20px 24px;color:#fff;">' +
        '<div style="font-size:18px;font-weight:700;">✓ 邮件报警已暂停</div>' +
        '<div style="font-size:12px;opacity:.9;margin-top:4px;">' + logger.fmtDT(new Date()) + '</div>' +
      '</div>' +
      '<div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px;padding:18px 24px;font-size:13px;line-height:1.7;color:#475569;">' +
        '触发者：<b>' + fromAddr + '</b><br>' +
        '回复邮件内容包含 <b>开启</b> / <b>恢复</b> 即可重新接收报警。' +
      '</div>' +
      '</div>';
    await mailer.send(cfg.mail, subject, text, html);
  }
  else if (cmd === 'unmute'){
    if (!cfg.mail.alertMuted){
      logger.log('【邮件指令】当前未静音，忽略');
      return;
    }
    cfg.mail.alertMuted = false;
    cfg.mail.mutedAt = 0;
    cfg.mail.mutedBy = '';
    config.save(cfg);
    logger.log('【邮件指令】√ 恢复邮件报警（来自 ' + fromAddr + '）');

    const subject = '【SupOS-monitor 确认】邮件报警已恢复';
    const text = '已收到您的指令，邮件报警已恢复。\n\n' +
                 '时间：' + logger.fmtDT(new Date()) + '\n';
    const html =
      '<div style="font-family:\'Microsoft YaHei\',Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;">' +
      '<div style="background:linear-gradient(135deg,#2563eb,#1d4ed8);border-radius:10px;padding:20px 24px;color:#fff;">' +
        '<div style="font-size:18px;font-weight:700;">✓ 邮件报警已恢复</div>' +
        '<div style="font-size:12px;opacity:.9;margin-top:4px;">' + logger.fmtDT(new Date()) + '</div>' +
      '</div>' +
      '<div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px;padding:18px 24px;font-size:13px;line-height:1.7;color:#475569;">' +
        '触发者：<b>' + fromAddr + '</b>' +
      '</div>' +
      '</div>';
    await mailer.send(cfg.mail, subject, text, html);
  }
}

// ============================================================
// 一次 IMAP 检查（分两阶段，避免下载全部源码）
// ============================================================
async function checkOnce(){
  if (busy){
    logger.log('【邮件指令】上一次检查还在进行中，跳过本次');
    return { ok: false, busy: true, message: '上一次检查还在进行中' };
  }
  busy = true;
  const t0 = Date.now();

  let client = null;
  let processedCount = 0;
  let mutedNow = 0;
  let skipped = 0;

  try {
    const cfg = config.load();
    if (!cfg.mail.enabled)        return { ok: false, message: '邮件功能未启用' };
    if (!cfg.mail.imapEnabled)    return { ok: false, message: 'IMAP 监听未启用' };
    if (!cfg.mail.from || !cfg.mail.pass) return { ok: false, message: '缺少发件邮箱或授权码' };

    const toList = String(cfg.mail.to || '')
      .split(/[,，;；\s]+/)
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);
    if (!toList.length) return { ok: false, message: '收件人列表为空' };

    logger.log('【邮件指令】开始检查… 登录邮箱=' + cfg.mail.from + '，允许的回复者=' + toList.join(' / '));

    client = new ImapFlow({
      host: 'imap.qq.com',
      port: 993,
      secure: true,
      auth: { user: cfg.mail.from, pass: cfg.mail.pass },
      logger: false,
      tls: { rejectUnauthorized: false }
    });

    await client.connect();
    logger.log('【邮件指令】IMAP 已连接');

    const lock = await client.getMailboxLock('INBOX');
    try {
      let uids = await client.search({ seen: false }, { uid: true });
      logger.log('【邮件指令】未读邮件共 ' + uids.length + ' 封');
      if (!uids.length) return { ok: true, processed: 0, muted: 0, skipped: 0 };

      // 最多处理最近 50 封
      if (uids.length > 50) uids = uids.slice(-50);

      // ============================================================
      // 第一阶段：只拉 envelope（不拉 source），一次往返，非常快
      // ============================================================
      const envelopes = [];
      for await (const msg of client.fetch(uids, { envelope: true, uid: true }, { uid: true })){
        const subj = (msg.envelope && msg.envelope.subject) || '';
        const fromVal = msg.envelope && msg.envelope.from && msg.envelope.from[0];
        const fromAddr = fromVal ? (fromVal.address || '') : '';
        envelopes.push({ uid: msg.uid, subject: subj, from: fromAddr });
      }
      logger.log('【邮件指令】已拉取 ' + envelopes.length + ' 封邮件头，开始筛选');

      // ============================================================
      // 第二阶段：过滤 + 只对匹配的拉 source 处理
      // ============================================================
      for (const env of envelopes){
        const { uid, subject, from } = env;
        let shouldMarkSeen = true;
        try {
          // ① 主题必须含 SupOS-monitor
          if (subject.indexOf('SupOS-monitor') < 0){
            skipped++;
            continue;
          }
          // ② 必须是回复邮件（避免处理程序自己发的报警邮件）
          if (!isReplyMail(subject)){
            logger.log('【邮件指令】跳过 #' + uid + '（不是回复邮件）：' + subject);
            skipped++;
            continue;
          }
          // ③ 发件人必须在收件人列表
          if (!isFromAllowed(from, toList)){
            logger.log('【邮件指令】跳过 #' + uid + '（发件人 ' + from + ' 不在允许列表）');
            skipped++;
            continue;
          }

          // 全部通过 → 拉 source 处理
          logger.log('【邮件指令】处理 #' + uid + ' 主题="' + subject + '" 发件人=' + from);

          const full = await client.fetchOne(uid, { source: true }, { uid: true });
          if (!full || !full.source){
            logger.log('【邮件指令】无法获取 #' + uid + ' 内容，跳过');
            continue;
          }

          const parsed = await simpleParser(full.source);
          const bodyText = parsed.text || '';
          const matchText = bodyText + '\n' + subject;

          let cmd = null;
          if (matchAny(matchText, MUTE_KEYWORDS)) cmd = 'mute';
          else if (matchAny(matchText, UNMUTE_KEYWORDS)) cmd = 'unmute';

          if (cmd){
            logger.log('【邮件指令】识别到指令：' + cmd);
            const fresh = config.load();
            await handleCommand(cmd, fresh, from);
            processedCount++;
            if (cmd === 'mute') mutedNow = 1;
          } else {
            logger.log('【邮件指令】未识别到指令关键字（正文前 100 字：' +
                       bodyText.substring(0, 100).replace(/\s+/g, ' ') + '）');
          }
        } catch (innerErr){
          logger.log('【邮件指令】单封处理失败 #' + uid + '：' + innerErr.message, 'WARN');
        } finally {
          if (shouldMarkSeen){
            try { await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true }); } catch(_) {}
          }
        }
      }
    } finally {
      try { lock.release(); } catch(_) {}
    }

    try { await client.logout(); } catch(_) {}
    client = null;

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    logger.log('【邮件指令】检查完成，耗时 ' + elapsed + ' 秒（处理 ' + processedCount +
               ' 封，跳过 ' + skipped + ' 封，静音状态 ' + (mutedNow ? '已切换' : '未变') + '）');

    return { ok: true, processed: processedCount, skipped, muted: mutedNow, elapsed };

  } catch (e){
    logger.log('【邮件指令】IMAP 检查失败：' + e.message, 'ERROR');
    if (client){ try { await client.logout(); } catch(_) {} }
    return { ok: false, message: e.message };
  } finally {
    busy = false;
  }
}

// ============================================================
// 启动/停止
// ============================================================
function start(intervalSec){
  stop();
  const sec = intervalSec || 60;
  started = true;
  logger.log('【邮件指令】监听启动，间隔 ' + sec + ' 秒');
  setTimeout(() => { if (started) checkOnce(); }, 5000);
  timer = setInterval(() => {
    if (started && !busy) checkOnce();
  }, sec * 1000);
}

function stop(){
  if (started) logger.log('【邮件指令】监听停止');
  started = false;
  if (timer){ clearInterval(timer); timer = null; }
}

function isRunning(){ return started; }
function isBusy(){ return busy; }

module.exports = { start, stop, isRunning, isBusy, checkOnce };