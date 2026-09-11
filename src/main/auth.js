let TICKET = null;
let TICKET_EXPIRE = 0;

async function login(cfg){
  const base = cfg.server.replace(/\/+$/, '');
  const body = {
    userName: cfg.username,
    password: cfg.password,
    key: '',
    forceLogin: false,
    verifyCode: '',
    verifyChannel: ''
  };
  const headers = {
    'Content-Type': 'application/json; charset=UTF-8',
    'Accept': 'application/json'
  };

  let r, text, data;
  try {
    r = await fetch(base + '/inter-api/auth/login', {
      method: 'POST', headers, body: JSON.stringify(body)
    });
    text = await r.text();
  } catch (e) {
    return { ok: false, error: '网络错误：' + e.message };
  }

  try { data = JSON.parse(text); }
  catch (e) { return { ok: false, error: 'HTTP ' + r.status + ' 响应非 JSON：' + text.substring(0, 200) }; }

  if (data.needForceLogin === true){
    body.forceLogin = true;
    try {
      r = await fetch(base + '/inter-api/auth/login', {
        method: 'POST', headers, body: JSON.stringify(body)
      });
      text = await r.text();
      data = JSON.parse(text);
    } catch (e) {
      return { ok: false, error: '强制登录失败：' + e.message };
    }
  }

  if (r.status === 401 || r.status === 480)
    return { ok: false, error: 'HTTP ' + r.status + ' 鉴权失败，请检查用户名密码' };
  if (!data.ticket)
    return { ok: false, error: 'HTTP ' + r.status + ' 无 ticket：' + JSON.stringify(data).substring(0, 200) };

  TICKET = data.ticket;
  TICKET_EXPIRE = Date.now() + (data.expire || 36000) * 1000;
  return { ok: true, ticket: TICKET, expire: data.expire || 36000 };
}

async function refresh(){
  if (!TICKET) return false;
  const config = require('./config');
  const cfg = config.load();
  const base = cfg.server.replace(/\/+$/, '');
  try {
    const r = await fetch(base + '/inter-api/auth/token/refresh', {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + TICKET,
        'Cookie': 'suposTicket=' + TICKET
      }
    });
    return r.status === 200;
  } catch (e) {
    return false;
  }
}

function getTicket(){ return TICKET; }
function isExpired(){ return !TICKET || Date.now() > TICKET_EXPIRE - 60000; }
function clear(){ TICKET = null; TICKET_EXPIRE = 0; }

module.exports = { login, refresh, getTicket, isExpired, clear };