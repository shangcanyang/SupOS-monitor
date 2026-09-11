const WebSocket = require('ws');
const auth = require('./auth');
const logger = require('./logger');

class WSClient {
  constructor(opts){
    this.server = opts.server;
    this.onData = opts.onData;
    this.onState = opts.onState;
    this.tags = [];
    this.ws = null;
    this.seq = 0;
    this.hbTimer = null;
    this.reconnectTimer = null;
    this.manualClose = false;
    this.reconnectDelay = 3000;
  }

  wsUrl(){
    let base = this.server.replace(/\/+$/, '');
    base = base.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
    return base + '/inter-api/broker/ws?token=' + encodeURIComponent(auth.getTicket());
  }

  connect(tags){
    this.tags = tags || this.tags;
    this.manualClose = false;
    if (!auth.getTicket()){
      logger.log('无 ticket，无法建立 WS', 'WARN');
      return;
    }
    try { this.ws = new WebSocket(this.wsUrl()); }
    catch (e) {
      logger.log('WS 创建失败：' + e.message, 'ERROR');
      this.scheduleReconnect();
      return;
    }
    this.onState('connecting');

    this.ws.on('open', () => {
      logger.log('WS 已连接，发送认证报文');
      this.send({
        reqID: String(++this.seq),
        reqType: 'request',
        content: { token: auth.getTicket() }
      });
    });

    this.ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw); } catch (e) { return; }
      this.handle(msg);
    });

    this.ws.on('error', e => logger.log('WS 错误：' + e.message, 'WARN'));

    this.ws.on('close', () => {
      logger.log('WS 已断开', 'WARN');
      this.onState('closed');
      this.stopHeartbeat();
      if (!this.manualClose) this.scheduleReconnect();
    });
  }

  handle(msg){
    const c = msg.content || {};
    const authVal = (c.auth !== undefined) ? c.auth : msg.auth;
    if (authVal !== undefined){
      if (String(authVal) === '1'){
        logger.log('WS 认证通过');
        this.onState('online');
        this.subscribe();
        this.startHeartbeat();
      } else {
        logger.log('WS 认证失败 auth=' + authVal, 'ERROR');
      }
      return;
    }
    if (msg.resType === 'push' && c.subType === 'device_prop'){
      const body = c.body || {};
      for (const fullPath in body){
        const arr = body[fullPath];
        if (!arr || !arr.length) continue;
        const it = arr[0];
        const parts = fullPath.split(':');
        const tag = parts[parts.length - 1];
        this.onData({ tag, value: it.value, status: it.status, ts: it.timestamp });
      }
    }
  }

  subscribe(){
    if (!this.tags.length){ logger.log('没有可订阅的位号', 'WARN'); return; }
    const props = this.tags.map(t => ({ attributeNamespace: 'system', attributeName: t }));
    this.send({
      reqID: String(++this.seq),
      reqType: 'subscribe',
      content: {
        subType: 'device_prop',
        body: [{
          templateNamespace: 'system',
          templateName: 'LinkObject',
          instanceName: 'serverdata1',
          props
        }]
      }
    });
    logger.log('已订阅 ' + props.length + ' 个位号');
  }

  startHeartbeat(){
    this.stopHeartbeat();
    this.hbTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === 1) this.send({ reqType: 'heartBeat' });
    }, 30000);
  }
  stopHeartbeat(){
    if (this.hbTimer){ clearInterval(this.hbTimer); this.hbTimer = null; }
  }

  send(obj){
    try { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }
    catch (e) { logger.log('WS 发送失败：' + e.message, 'ERROR'); }
  }

  scheduleReconnect(){
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      logger.log('WS 3 秒后重连…');
      this.connect(this.tags);
    }, this.reconnectDelay);
  }

  close(){
    this.manualClose = true;
    this.stopHeartbeat();
    if (this.reconnectTimer){ clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    try { if (this.ws) this.ws.close(); } catch (e) {}
    this.ws = null;
  }
}

module.exports = WSClient;