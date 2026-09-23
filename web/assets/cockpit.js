/* Situation domain — the Ledger whitebox table and its stat bar.
 *
 * Split out of script.html (ADR-0015 D8 follow-through): the shell polls and
 * hands the snapshot over, this asset only renders. Moved verbatim — no
 * behaviour change. Depends on the shell for `window.Cx` (esc).
 */
(function () {
  var Cx = window.Cx;

  /* 已知判定词表 —— **唯一来源**是 CI-144 码注册表 `E-*`/`W-*` 与
   * Tuck `Decision`；此处只做"渲染分类"，不重新定义语义。
   *
   * 为什么必须显式列出、而不能用 `indexOf('ERR')` 这类子串猜测：
   * 注册表里是 `E-RISK-MISSING` / `W-RISK-UNKNOWN` 这种形状，
   * **既不含 `ERR` 也不含 `WARN`**；子串猜测会把它们全判成"没问题"。
   * 且账本实际产出（Tuck `gateway-audit.jsonl`）里根本没有 `status` 字段
   * ⇒ 原实现每行取到 `'?'` ⇒ **整张表恒绿**，连"被拒"都绿（K-088）。
   *
   * 故：**未在表内的一律 `unknown`**（中性灰），绝不落绿 ——
   * 与 DNA 原则 7「覆盖范围 = 声明范围」同向。
   */
  /* Tuck `Decision` 的四个变体逐字列出（`tuck-core/src/lib.rs`：
   * `Pass` / `Reject` / `NeedHumanConfirm` / `HardOverridePass`）。
   * `HARDOVERRIDEPASS` **必须显式列出**：它以 `HARDOVERRIDE` 开头、不以 `PASS`
   * 开头，边界匹配抓不到它 —— 靠"看起来像 pass"去找正是子串匹配的老毛病。 */
  var OK_STATUS = ['PASS', 'OK', 'MET', 'ALLOW', 'FORWARD', 'HARDOVERRIDEPASS'];
  var WARN_STATUS = ['WARN'];
  var BAD_STATUS = ['REJECT', 'FAIL', 'BLOCK', 'DENY', 'ERR'];
  /* 码注册表（`commonintents/.github/CI-144_码注册表.md`）的**严重度前缀**：
   * `E-*` 错误、`W-*` 警告。必须单独列，因为 `E-RISK-MISSING` / `W-RISK-UNKNOWN`
   * 里既没有 `ERR` 也没有 `WARN` —— 这正是原实现把整个注册表判成"没问题"的原因。 */
  var BAD_PREFIX = ['E-'];
  var WARN_PREFIX = ['W-'];

  /* 判定 → 渲染分类。返回 'ok' | 'warn' | 'bad' | 'unknown'。
   *
   * **只做边界匹配**：整个串精确相等 ⇒ 命中；或串**以**某条词开头 ⇒ 命中。
   * 刻意**不做**任意位置子串匹配 —— 原实现在这一点上出过错，且是有教育意义的
   * 那种：`"HARDOVERRIDEPASS".indexOf("E-")` 能命中（`OVERRIDE-` 里的 `E-`），
   * 于是 Tuck 的合法判定 `HardOverridePass` 被判成"坏"。子串匹配会**在词中间**
   * 找到"证据"，这与本轮要治的病同源：**判据指向了代理，而不是那个被消费的对象**。
   *
   * 未知一律 `unknown`（中性灰），**绝不落绿** —— 与 DNA 原则 7 同向。
   */
  function classifyStatus(status) {
    if (!status) return 'unknown';
    var s = String(status).toUpperCase();
    function hit(list) {
      for (var i = 0; i < list.length; i++) {
        if (s === list[i] || s.indexOf(list[i]) === 0) return true;
      }
      return false;
    }
    if (hit(BAD_STATUS) || hit(BAD_PREFIX)) return 'bad';
    if (hit(WARN_STATUS) || hit(WARN_PREFIX)) return 'warn';
    if (hit(OK_STATUS)) return 'ok';
    return 'unknown';
  }

  /* 从一条账本记录里取**真实**判定。
   *
   * Tuck `/v1/audit`（经本面板 `/api/audit` 透传）的真实形状是：
   *   { seq, ts, payload: { kind: 'request'|'response',
   *                         data: { action: 'forward', messages: [{ action: 'pass' }] },
   *                         trace_id } }
   * —— 顶层**没有** `status`/`decision`。原实现读的正是这两个不存在的字段。
   *
   * 取值顺序的**关键点**：`payload.kind` 是**事件类型**（这是"请求记录"还是
   * "响应记录"），**不是判定**。所以它排在**最后**当兜底，绝不能挡在
   * `messages[].action`（那才是判定所在的槽位）前面。
   * 实测：本仓 `Tuck/gateway-audit.jsonl` 全 1409 条的 `kind` 只有
   * `request`/`response`，若先取 `kind`，**每一条都会得到事件类型**，
   * 等于还是没读判定。
   *
   * 只认**显式存在**的值：取不到就是 `''`，由 `classifyStatus` 判 `unknown`，
   * **不猜、不默认成通过**。
   */
  function statusOf(e) {
    if (e.status != null && e.status !== '') return e.status;
    if (e.decision != null && e.decision !== '') return e.decision;
    if (e.verdict != null && e.verdict !== '') return e.verdict;
    if (e.record_type != null && e.record_type !== '') return e.record_type;
    var p = e.payload || {};
    var d = p.data || {};
    if (d.action != null && d.action !== '') return d.action;
    if (Array.isArray(d.messages)) {
      for (var i = 0; i < d.messages.length; i++) {
        var m = d.messages[i] || {};
        if (m.action != null && m.action !== '') return m.action;
      }
    }
    /* 兜底：只剩"这是什么记录"。它是事件类型而非判定，所以一律会被
     * classifyStatus 判为 unknown（中性灰）——**如实呈现"这里没有判定"**，
     * 而不是让一个类型名冒充判定。 */
    if (p.kind != null && p.kind !== '') return p.kind;
    return '';
  }

  var CLS = { ok: 'e-ok', warn: 'e-warn', bad: 'e-bad', unknown: 'e-unknown' };

  function render(snap) {
    document.getElementById('episode').textContent = snap.episode || '无';
    var ledger = snap.ledger || [];
    document.getElementById('nledger').textContent = ledger.length;
    document.getElementById('tick').textContent = new Date().toLocaleTimeString();
    var box = document.getElementById('entries');
    if (!ledger.length) {
      /* Through the exit layer (ADR-0044): the sentence and the way out come
       * from one place, and `.empty` is kept because it is already this
       * cockpit's block. */
      var td = document.createElement('td');
      td.colSpan = 5;
      td.appendChild(window.CxWayout.build('ledger-empty'));
      var tr = document.createElement('tr');
      tr.appendChild(td);
      box.innerHTML = '';
      box.appendChild(tr);
      return;
    }
    // 水之波光 Ledger 表格：状态/时间/trace_id/调用/说明 五列 + 点击展开 payload。
    // 与证轨事件表同构（碳硅同看同一账本），但数据源是 Tuck 审计链。
    // ≤620px 降级为纵向卡片堆叠（td data-label 标签在上/值在下，首列自明）。
    var rows = '';
    ledger.slice().reverse().forEach(function (e) {
      var status = statusOf(e);
      var kind = classifyStatus(status);
      // 取不到任何显式判定时，如实写出「未知」，而不是让空串冒充一个判定。
      var label = status === '' ? '未知' : String(status).toUpperCase();
      var cls = CLS[kind] || 'e-unknown';
      var tid = e.trace_id || (e.payload && e.payload.trace_id) || e.episode_id || '';
      var call = e.tool || e.args || '';
      var note = e.summary || e.verdict || e.reason || '';
      var payload = JSON.stringify(e.data || e.payload || e, null, 1);
      rows += '<tr class="lt-row" tabindex="0" role="button" aria-expanded="false" onclick="var t=this;t.classList.toggle(\'lt-open\');var ex=t.nextElementSibling;if(ex&&ex.classList.contains(\'lt-exp\')){ex.hidden=!ex.hidden;}">' +
        '<td data-label="状态"><span class="chip ' + cls + '" title="' + Cx.esc(kind) + '">' + Cx.esc(label) + '</span></td>' +
        '<td class="lt-c-ts" data-label="时间">' + Cx.esc(String(e.ts || e.created_at || '').slice(0, 19)) + '</td>' +
        '<td class="lt-c-tid" data-label="trace_id">' + Cx.esc(tid) + '</td>' +
        '<td class="lt-c-call" data-label="调用">' + Cx.esc(call) + '</td>' +
        '<td class="lt-c-note" data-label="说明">' + Cx.esc(note) + '</td></tr>' +
        '<tr class="lt-exp" hidden><td colspan="5"><pre>' + Cx.esc(payload) + '</pre></td></tr>';
    });
    box.innerHTML = rows;
    if (window.syncFades) window.syncFades();
  }

  window.CxCockpit = { render: render, classifyStatus: classifyStatus, statusOf: statusOf };
})();
