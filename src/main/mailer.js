const nodemailer = require('nodemailer');
const logger = require('./logger');

function fmtDT(d){
  const p = n => n < 10 ? '0' + n : '' + n;
  return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate()) + ' ' +
         p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}
function fmtVal(v){
  if (v == null || v === '') return '-';
  const n = Number(v);
  return isNaN(n) ? String(v) : n.toFixed(3);
}
function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ---------- 报警级别配色 ----------
const LEVEL_META = {
  HH: { name: '高高限', color: '#dc2626', bg: '#fee2e2', border: '#dc2626' },
  H:  { name: '高限',   color: '#f97316', bg: '#ffedd5', border: '#f97316' },
  L:  { name: '低限',   color: '#ca8a04', bg: '#fef9c3', border: '#eab308' },
  LL: { name: '低低限', color: '#2563eb', bg: '#dbeafe', border: '#3b82f6' }
};

// ============================================================
// 纯文本版本（作为 fallback，邮件客户端不支持 HTML 时用）
// ============================================================
function buildAlarmText(items){
  let s = 'SupOS-monitor 测点报警通知\r\n';
  s += '时间：' + fmtDT(new Date()) + '\r\n';
  s += '共 ' + items.length + ' 项报警\r\n';
  s += '----------------------------------------\r\n';
  items.forEach((it, i) => {
    s += (i+1) + '. [' + it.level + '] [' + it.device + '] ' + it.tag +
         (it.desc ? '（' + it.desc + '）' : '') + '\r\n';
    s += '   当前值：' + fmtVal(it.value) + (it.unit ? ' ' + it.unit : '') + '\r\n';
    s += '   阈值：HH=' + fmtVal(it.thresholds.hh) + ' H=' + fmtVal(it.thresholds.h) +
         ' L=' + fmtVal(it.thresholds.l) + ' LL=' + fmtVal(it.thresholds.ll) + '\r\n';
    s += '   触发时间：' + (it.time ? fmtDT(new Date(it.time)) : '-') + '\r\n';
  });
  s += '----------------------------------------\r\n';
  s += '（本邮件由 SupOS-monitor 自动发送，请勿回复）\r\n';
  return s;
}

// ============================================================
// HTML 版本
// ============================================================
function buildAlarmHtml(items){
  const now = fmtDT(new Date());

  // 按装置统计
  const devStat = {};
  const devOrder = [];
  for (const it of items){
    const d = it.device || '未分类';
    if (devStat[d] === undefined){ devStat[d] = 0; devOrder.push(d); }
    devStat[d]++;
  }
  // 按级别统计
  const lvStat = { HH:0, H:0, L:0, LL:0 };
  for (const it of items){
    if (lvStat[it.level] !== undefined) lvStat[it.level]++;
  }

  // 级别徽章行
  let lvBadges = '';
  for (const lv of ['HH','H','L','LL']){
    if (lvStat[lv]){
      const m = LEVEL_META[lv];
      lvBadges +=
        '<span style="display:inline-block;margin-right:8px;padding:3px 10px;' +
        'background:' + m.bg + ';color:' + m.color + ';border:1px solid ' + m.border + ';' +
        'border-radius:10px;font-size:12px;font-weight:700;">' +
        lv + ' ' + m.name + ' × ' + lvStat[lv] + '</span>';
    }
  }

  // 装置徽章
  let devBadges = '';
  for (const d of devOrder){
    devBadges +=
      '<span style="display:inline-block;margin:3px 6px 3px 0;padding:2px 9px;' +
      'background:#f1f5f9;color:#475569;border-radius:8px;font-size:12px;">' +
      esc(d) + ' × ' + devStat[d] + '</span>';
  }

  // 报警卡片
  const cards = items.map((it, i) => {
    const m = LEVEL_META[it.level] || LEVEL_META.HH;
    const t = it.thresholds || {};
    const time = it.time ? fmtDT(new Date(it.time)) : '-';

    return '' +
    '<div style="margin-bottom:14px;background:#fff;border:1px solid #e2e8f0;' +
    'border-left:5px solid ' + m.border + ';border-radius:8px;padding:14px 16px;' +
    'box-shadow:0 1px 3px rgba(0,0,0,.04);">' +

      // 头部：级别 + 位号 + 装置
      '<div style="margin-bottom:10px;">' +
        '<span style="display:inline-block;padding:2px 10px;background:' + m.bg + ';' +
        'color:' + m.color + ';font-weight:700;font-size:12px;border-radius:10px;' +
        'margin-right:8px;">' + it.level + ' · ' + m.name + '</span>' +
        '<span style="font-family:Consolas,Menlo,monospace;font-weight:700;' +
        'color:#0f172a;font-size:15px;">' + esc(it.tag) + '</span>' +
        '<span style="float:right;background:#f1f5f9;color:#64748b;font-size:12px;' +
        'padding:2px 9px;border-radius:8px;">' + esc(it.device || '未分类') + '</span>' +
      '</div>' +

      // 描述
      (it.desc
        ? '<div style="color:#475569;font-size:13px;margin-bottom:10px;">' +
          esc(it.desc) + '</div>'
        : '') +

      // 当前值块
      '<div style="background:#f8fafc;border:1px solid #f1f5f9;border-radius:6px;' +
      'padding:10px 14px;margin-bottom:10px;">' +
        '<span style="color:#94a3b8;font-size:12px;margin-right:10px;">当前值</span>' +
        '<span style="font-family:Consolas,Menlo,monospace;font-size:24px;' +
        'font-weight:700;color:' + m.color + ';">' + fmtVal(it.value) + '</span>' +
        (it.unit
          ? '<span style="color:#64748b;font-size:12px;margin-left:4px;">' + esc(it.unit) + '</span>'
          : '') +
        (it.isTemp
          ? '<span style="display:inline-block;background:#ffedd5;color:#c2410c;' +
            'font-size:11px;padding:2px 8px;border-radius:8px;margin-left:10px;">临时设定值生效中</span>'
          : '') +
      '</div>' +

      // 阈值
      '<div style="font-family:Consolas,Menlo,monospace;font-size:12px;' +
      'color:#64748b;background:#fafbfc;border:1px solid #f1f5f9;' +
      'border-radius:5px;padding:8px 12px;margin-bottom:8px;">' +
        '<b style="color:#334155;">HH</b>=' + fmtVal(t.hh) + '　' +
        '<b style="color:#334155;">H</b>='  + fmtVal(t.h)  + '　' +
        '<b style="color:#334155;">L</b>='  + fmtVal(t.l)  + '　' +
        '<b style="color:#334155;">LL</b>=' + fmtVal(t.ll) +
      '</div>' +

      // 触发时间
      '<div style="color:#94a3b8;font-size:12px;">' +
        '触发时间：<span style="color:#475569;">' + time + '</span>' +
      '</div>' +

    '</div>';
  }).join('');

  // 整体 HTML
  return '' +
  '<!DOCTYPE html>' +
  '<html><head><meta charset="utf-8"></head>' +
  '<body style="margin:0;padding:0;background:#f5f7fa;' +
  'font-family:\'Microsoft YaHei\',\'PingFang SC\',Arial,sans-serif;' +
  'font-size:14px;color:#1f2937;">' +

  '<div style="max-width:680px;margin:0 auto;padding:20px 16px;">' +

    // ---- 顶部标题 ----
    '<div style="background:linear-gradient(135deg,#dc2626,#b91c1c);' +
    'border-radius:10px 10px 0 0;padding:20px 24px;color:#fff;">' +
      '<div style="font-size:20px;font-weight:700;margin-bottom:4px;">' +
        '⚠ SupOS-monitor 测点报警' +
      '</div>' +
      '<div style="font-size:13px;opacity:.9;">共 ' + items.length +
        ' 项测点超限，请及时处理</div>' +
    '</div>' +

    // ---- 概览区 ----
    '<div style="background:#fff;padding:18px 24px;border:1px solid #e2e8f0;' +
    'border-top:none;">' +
      '<div style="margin-bottom:12px;">' +
        '<span style="color:#64748b;font-size:12px;display:inline-block;width:70px;">' +
          '触发时间</span>' +
        '<span style="font-family:Consolas,Menlo,monospace;color:#0f172a;' +
        'font-size:13px;">' + now + '</span>' +
      '</div>' +

      (lvBadges
        ? '<div style="margin-bottom:12px;">' +
          '<div style="color:#64748b;font-size:12px;margin-bottom:6px;">按级别</div>' +
          lvBadges +
          '</div>'
        : '') +

      (devOrder.length > 1
        ? '<div>' +
          '<div style="color:#64748b;font-size:12px;margin-bottom:6px;">按装置</div>' +
          devBadges +
          '</div>'
        : '') +
    '</div>' +

    // ---- 报警卡片列表 ----
    '<div style="background:#fff;padding:18px 24px;border:1px solid #e2e8f0;' +
    'border-top:none;">' +
      '<div style="font-size:14px;font-weight:700;color:#0f172a;' +
      'padding-left:10px;border-left:3px solid #dc2626;margin-bottom:14px;">' +
        '报警详情' +
      '</div>' +
      cards +
    '</div>' +

    // ---- 底部 ----
    '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-top:none;' +
    'border-radius:0 0 10px 10px;padding:14px 24px;text-align:center;' +
    'color:#94a3b8;font-size:12px;line-height:1.7;">' +
      '本邮件由 <b style="color:#64748b;">SupOS-monitor</b> 自动发送，请勿回复<br>' +
      '如需停止接收，请在客户端「邮件设置」中关闭' +
    '</div>' +

  '</div>' +
  '</body></html>';
}

// ============================================================
// 发送
// ============================================================
async function send(mail, subject, body, htmlBody){
  if (!mail || !mail.enabled || !mail.from || !mail.pass || !mail.to)
    return { ok: false, error: '邮件未启用或配置不完整' };

  const tx = nodemailer.createTransport({
    host: 'smtp.qq.com', port: 465, secure: true,
    auth: { user: mail.from, pass: mail.pass }
  });

  let lastErr = '';
  for (let i = 1; i <= 3; i++){
    try {
      await tx.sendMail({
        from: mail.from,
        to: mail.to,
        subject,
        text: body,
        html: htmlBody || undefined
      });
      logger.log('邮件已发送 → ' + mail.to);
      return { ok: true };
    } catch (e){
      lastErr = e.message;
      logger.log('邮件发送失败（第 ' + i + ' 次）：' + e.message, 'ERROR');
      if (i < 3) await new Promise(r => setTimeout(r, 5000));
    }
  }
  return { ok: false, error: lastErr };
}

// 兼容旧调用：buildAlarmBody 现在返回 {text, html}
function buildAlarmBody(items){
  return {
    text: buildAlarmText(items),
    html: buildAlarmHtml(items)
  };
}

module.exports = { send, buildAlarmBody, buildAlarmText, buildAlarmHtml };