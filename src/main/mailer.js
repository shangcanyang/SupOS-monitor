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

async function send(mail, subject, body){
  if (!mail || !mail.enabled || !mail.from || !mail.pass || !mail.to)
    return { ok: false, error: '邮件未启用或配置不完整' };

  const tx = nodemailer.createTransport({
    host: 'smtp.qq.com', port: 465, secure: true,
    auth: { user: mail.from, pass: mail.pass }
  });
  let lastErr = '';
  for (let i = 1; i <= 3; i++){
    try {
      await tx.sendMail({ from: mail.from, to: mail.to, subject, text: body });
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

function buildAlarmBody(items){
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

module.exports = { send, buildAlarmBody };