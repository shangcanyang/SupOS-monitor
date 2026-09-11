function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtVal(v){
  if (v === null || v === undefined || v === '') return '-';
  const n = Number(v);
  return isNaN(n) ? String(v) : n.toFixed(3);
}
function fmtTh(v){ return (v == null) ? '-' : fmtVal(v); }

let currentItems = [];

function render(items){
  currentItems = items || [];
  document.getElementById('count').textContent = currentItems.length + ' 项';
  const box = document.getElementById('list');

  if (!currentItems.length){
    box.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:60px 20px;font-size:13px">' +
                    '暂无报警，一切正常 ✓</div>';
    return;
  }

  box.innerHTML = currentItems.map((it, i) => {
    const t = it.thresholds;
    return '<div class="item ' + it.level + '">' +
      '<div class="hd">' +
        '<span class="lv ' + it.level + '">' + esc(it.level) + '</span>' +
        '<span class="tag">' + esc(it.tag) + '</span>' +
        '<span class="dev">' + esc(it.device || '未分类') + '</span>' +
      '</div>' +
      (it.desc ? '<div class="desc">' + esc(it.desc) + '</div>' : '') +
      '<div class="valbox">' +
        '<span class="val-k">当前值</span>' +
        '<span class="val-v">' + fmtVal(it.value) + '</span>' +
        (it.unit ? '<span class="val-u">' + esc(it.unit) + '</span>' : '') +
        (it.isTemp ? '<span class="temp">临时设定值生效中</span>' : '') +
      '</div>' +
      '<div class="ths">' +
        '<b>HH</b>=' + fmtTh(t.hh) + '　' +
        '<b>H</b>='  + fmtTh(t.h)  + '　' +
        '<b>L</b>='  + fmtTh(t.l)  + '　' +
        '<b>LL</b>=' + fmtTh(t.ll) +