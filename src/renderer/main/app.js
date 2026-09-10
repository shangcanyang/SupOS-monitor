// ---------- 页签切换 ----------
document.querySelectorAll('#tabs .tab').forEach(function (tab) {
  tab.addEventListener('click', function () {
    document.querySelectorAll('#tabs .tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const name = tab.getAttribute('data-t');
    document.getElementById('page-' + name).classList.add('active');
  });
});

// ---------- 状态栏时间 ----------
function updateStatusBar() {
  document.getElementById('sbRight').textContent =
    'SupOS-monitor v1.0.0　·　' + new Date().toLocaleTimeString('zh-CN');
}
updateStatusBar();
setInterval(updateStatusBar, 1000);

// ---------- 配置读取/保存 ----------
async function loadConfigToUI() {
  const cfg = await window.api.getConfig();
  document.getElementById('setServer').value = cfg.server || '';
  document.getElementById('setUser').value   = cfg.username || '';
  document.getElementById('setPass').value   = cfg.password || '';
  const dir = await window.api.getDataDir();
  document.getElementById('sbLeft').textContent = '配置目录：' + dir;
}

async function saveAccount() {
  const cfg = {
    server:   document.getElementById('setServer').value,
    username: document.getElementById('setUser').value,
    password: document.getElementById('setPass').value
  };
  if (!cfg.server || !cfg.username || !cfg.password) {
    alert('平台地址、用户名、密码均不能为空。');
    return;
  }
  await window.api.saveConfig(cfg);
  alert('已保存。');
}

// ---------- 绑定按钮 ----------
document.querySelector('#page-set .primary').addEventListener('click', saveAccount);

// ---------- 启动时加载 ----------
window.addEventListener('DOMContentLoaded', loadConfigToUI);
loadConfigToUI();