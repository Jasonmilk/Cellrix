/* Situation domain — the Ledger whitebox table and its stat bar.
 *
 * Split out of script.html (ADR-0015 D8 follow-through): the shell polls and
 * hands the snapshot over, this asset only renders. Moved verbatim — no
 * behaviour change. Depends on the shell for `window.Cx` (esc).
 */
(function () {
  var Cx = window.Cx;

  function render(snap) {
    document.getElementById('episode').textContent = snap.episode || '无';
    var ledger = snap.ledger || [];
    document.getElementById('nledger').textContent = ledger.length;
    document.getElementById('tick').textContent = new Date().toLocaleTimeString();
    var box = document.getElementById('entries');
    if (!ledger.length) {
      box.innerHTML = '<tr><td colspan="5"><div class="empty">暂无记录（Noop 模式 ledger 为空——配置 reasoning 后产生）</div></td></tr>';
      return;
    }
    // 水之波光 Ledger 表格：状态/时间/trace_id/调用/说明 五列 + 点击展开 payload。
    // 与证轨事件表同构（碳硅同看同一账本），但数据源是 Tuck 审计链。
    // ≤620px 降级为纵向卡片堆叠（td data-label 标签在上/值在下，首列自明）。
    var rows = '';
    ledger.slice().reverse().forEach(function (e) {
      var status = (e.status || e.record_type || '?').toUpperCase();
      var cls = status.indexOf('ERR') > -1 || status === 'BLOCK' ? 'e-bad' : (status.indexOf('WARN') > -1 ? 'e-warn' : 'e-ok');
      var tid = e.trace_id || e.episode_id || '';
      var call = e.tool || e.args || '';
      var note = e.summary || e.verdict || e.reason || '';
      var payload = JSON.stringify(e.data || e.payload || e, null, 1);
      rows += '<tr class="lt-row" tabindex="0" role="button" aria-expanded="false" onclick="var t=this;t.classList.toggle(\'lt-open\');var ex=t.nextElementSibling;if(ex&&ex.classList.contains(\'lt-exp\')){ex.hidden=!ex.hidden;}">' +
        '<td data-label="状态"><span class="chip ' + cls + '">' + Cx.esc(status) + '</span></td>' +
        '<td class="lt-c-ts" data-label="时间">' + Cx.esc(String(e.ts || e.created_at || '').slice(0, 19)) + '</td>' +
        '<td class="lt-c-tid" data-label="trace_id">' + Cx.esc(tid) + '</td>' +
        '<td class="lt-c-call" data-label="调用">' + Cx.esc(call) + '</td>' +
        '<td class="lt-c-note" data-label="说明">' + Cx.esc(note) + '</td></tr>' +
        '<tr class="lt-exp" hidden><td colspan="5"><pre>' + Cx.esc(payload) + '</pre></td></tr>';
    });
    box.innerHTML = rows;
    if (window.syncFades) window.syncFades();
  }

  window.CxCockpit = { render: render };
})();
