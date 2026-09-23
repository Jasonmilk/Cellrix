/* Situation domain — the Ledger whitebox table and its stat bar.
 *
 * Split out of script.html (ADR-0015 D8 follow-through): the shell polls and
 * hands the snapshot over, this asset only renders. Moved verbatim — no
 * behaviour change. Depends on the shell for `window.Cx` (esc).
 */
(function () {
  var Cx = window.Cx;

  /* 已渲染的行：key → 节点数组（`<tr>` + 展开用的 `<tr class="lt-exp">`）。
   * 与 `chat.js` 同一思路（逐条创建、不整块重建），只是这里要按 key 记住，
   * 才能在数据到达时判断"这一行变了没有"。 */
  var ROW_NODES = {};
  var ROW_HTML = {};
  var EMPTY_SHOWN = false;

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
  /* `WARN`：警告级注册码（`W-*`）与**需要人看**的判定。
   * `NEEDHUMANCONFIRM` 是 Tuck 的一个**真实判定**，不是"判不出" —— 它的意思是
   * "需要人来定"。若把它渲染成中性灰的 `unknown`，"在等人"与"没有数据"就看起来
   * 一样，而两者处置完全不同（一个要通知人，一个要查为什么没数据）。
   * ⇒ 它是 `warn`：一个**值得人注意的已知判定**。 */
  var WARN_STATUS = ['WARN', 'NEEDHUMANCONFIRM'];
  var BAD_STATUS = ['REJECT', 'FAIL', 'BLOCK', 'DENY', 'ERR'];
  /* 码注册表（`commonintents/.github/CI-144_码注册表.md`）的**严重度前缀**：
   * `E-*` 错误、`W-*` 警告。必须单独列，因为 `E-RISK-MISSING` / `W-RISK-UNKNOWN`
   * 里既没有 `ERR` 也没有 `WARN` —— 这正是原实现把整个注册表判成"没问题"的原因。 */
  var BAD_PREFIX = ['E-'];
  var WARN_PREFIX = ['W-'];

  /* HTTP 状态码的**独立**分类。
   *
   * 为什么必须与上面的词表分开：Tuck 的审计链里，`request` 记录的判定是
   * `data.messages[].action`（`forward`/`pass` 这类**词**），而 `response` 记录的判定是
   * `data.status` —— 它是 **HTTP 码**（`200`/`400`/`502` 这类**数**）。
   * 两者是不同的取值空间，混进同一张词表会让"数字前缀"与"字母前缀"互相污染。
   *
   * 实测（`Tuck/gateway-audit.jsonl` 815 条 response）：`200`×312、`"ok"`×500、`400`×3。
   * ⇒ 这正是"坏"的真实样本来源（此前我报告"真实链里无坏值"，是因为我根本没读到这一层）。
   */
  function classifyHttpStatus(s) {
    if (!/^[1-5][0-9]{2}$/.test(s)) return null;
    var d = s.charAt(0);
    if (d === '2' || d === '3') return 'ok';
    if (d === '4' || d === '5') return 'bad';
    return null;   // 1xx 信息类：既非成功也非失败 ⇒ 交回上层判 unknown
  }

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
    if (s === '0') return 'unknown';   // `0` = 未开始/无状态，不是"好"
    var http = classifyHttpStatus(s);
    if (http) return http;
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
    /* `d.status` 是 **response 记录**的判定槽位：HTTP 码（`200`/`400`/`502`）或
     * 流式的 `"ok"`。实测 815 条 response **全部**带它 —— 此前漏读这一层，
     * 导致整批 response 都被判 `unknown`。它与 request 的 `messages[].action`
     * 是**两个不同的槽位**，故都列出、互不遮挡。 */
    if (d.status != null && d.status !== '') return d.status;
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
      if (EMPTY_SHOWN) { return; }              /* 已经是空态：不重建占位行 */
      /* 从"有"变"无"：先撤掉已渲染的行与缓存，否则数据回来时两者会同时存在。 */
      Object.keys(ROW_NODES).forEach(function (k) {
        (ROW_NODES[k] || []).forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
      });
      ROW_NODES = {}; ROW_HTML = {};
      var td = document.createElement('td');
      td.colSpan = 5;
      td.appendChild(window.CxWayout.build('ledger-empty'));
      var tr = document.createElement('tr');
      tr.appendChild(td);
      box.innerHTML = '';
      box.appendChild(tr);
      EMPTY_SHOWN = true;
      return;
    }
    /* 有数据 ⇒ 若之前是空态，占位行必须先撤掉（否则它会留在表头下面）。 */
    if (EMPTY_SHOWN) { box.innerHTML = ''; EMPTY_SHOWN = false; }
    /* ── 局部渲染：按 key 复用行，不整表重建 ────────────────────────────────
     *
     * 此前是 `box.innerHTML = rows` —— 每次清空重造**全部**行。代价不只是 CPU：
     * **它抹掉 DOM 状态** —— 展开的 `<tr class="lt-open">`、滚动位置、焦点都会丢。
     * 数据每 2 秒到一次，于是用户展开一行后很难读下去。
     *
     * 本仓早有正确范式：`chat.js` 逐条 `createElement` + `appendChild`，
     * 流式回复只追加文本、失败行只替换那一条 —— **从不整块重建**。
     * 这里照它做，差别只在账本是**最新在前**，所以新行用 `insertBefore` 前置：
     * 既有节点不被移动，浏览器因此保持滚动锚点。
     *
     * 键取 `entry_id || id || trace_id`；都没有时退回 `ts#序号`（仍确定）。
     * 键相同而**内容变了**（同一记录的判定被改写）⇒ 重建那一行，不影响其余。
     */
    function keyOf(e, i) {
      return String(e.entry_id || e.id || (e.payload && e.payload.trace_id) ||
        e.trace_id || '') || ('#' + i);
    }
    function rowHtml(e) {
      var status = statusOf(e);
      var kind = classifyStatus(status);
      // 取不到任何显式判定时，如实写出「未知」，而不是让空串冒充一个判定。
      var label = status === '' ? '未知' : String(status).toUpperCase();
      var cls = CLS[kind] || 'e-unknown';
      var tid = e.trace_id || (e.payload && e.payload.trace_id) || e.episode_id || '';
      var call = e.tool || e.args || '';
      var note = e.summary || e.verdict || e.reason || '';
      var payload = JSON.stringify(e.data || e.payload || e, null, 1);
      return '<tr class="lt-row" tabindex="0" role="button" aria-expanded="false" onclick="var t=this;t.classList.toggle(\'lt-open\');var ex=t.nextElementSibling;if(ex&&ex.classList.contains(\'lt-exp\')){ex.hidden=!ex.hidden;}">' +
        '<td data-label="状态"><span class="chip ' + cls + '" title="' + Cx.esc(kind) + '">' + Cx.esc(label) + '</span></td>' +
        '<td class="lt-c-ts" data-label="时间">' + Cx.esc(String(e.ts || e.created_at || '').slice(0, 19)) + '</td>' +
        '<td class="lt-c-tid" data-label="trace_id">' + Cx.esc(tid) + '</td>' +
        '<td class="lt-c-call" data-label="调用">' + Cx.esc(call) + '</td>' +
        '<td class="lt-c-note" data-label="说明">' + Cx.esc(note) + '</td></tr>' +
        '<tr class="lt-exp" hidden><td colspan="5"><pre>' + Cx.esc(payload) + '</pre></td></tr>';
    }

    /* 这次要显示的顺序：最新在前（与既有行为一致）。 */
    var ordered = ledger.slice().reverse();
    var want = {}, seen = {}, i, k;
    for (i = 0; i < ordered.length; i++) {
      /* ⚠️ key **不含数组下标**。曾把 `#' + i` 拼进去，结果**追加一条**会让每行的
       * key 整体平移 ⇒ 全部被当作新行重建 —— 恰恰摧毁了局部渲染的目的。
       * 现在只对**同键重复**（同一 trace 多条）用出现序号区分，与位置无关。 */
      var base = keyOf(ordered[i], 0);
      seen[base] = (seen[base] || 0) + 1;
      k = base + (seen[base] > 1 ? '#' + seen[base] : '');
      want[k] = ordered[i];
    }

    /* 移除已不在数据里的行（并清掉缓存） */
    Object.keys(ROW_NODES).forEach(function (old) {
      if (want[old]) { return; }
      (ROW_NODES[old] || []).forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
      delete ROW_NODES[old];
      delete ROW_HTML[old];
    });

    /* 从**最新到最旧**逐个确保存在，每个都插到**当前首位之前** —— 倒序 + 前插，
     * 最终顺序即「最新在前」。
     *
     * ⚠️ 这一处改了两次，两次的病根不同，都值得记：
     *  ① 初版是「逆序 + insertBefore」但误写成从旧到新，顺序插成了 旧→新；
     *  ② 第二版改成「从旧到新 + appendChild」，**新行排到了末尾** —— 因为
     *     **已挂载的旧节点不会跟着重排**，只 append 新行，旧行还留在原位。
     * ⇒ 正解是**倒序 + insertBefore(首)**：`insertBefore` 对**已挂载**节点是
     *   **移动**而非复制，于是重排顺带完成。
     *
     * ⇒ 教训：**"节点有没有被重建"与"它排在哪里"是两件独立的事。**
     *   只断言前者，顺序反了也照样绿（本轮就是这么漏过去的）。 */
    seen = {};
    for (i = ordered.length - 1; i >= 0; i--) {
      var base2 = keyOf(ordered[i], 0);
      seen[base2] = (seen[base2] || 0) + 1;
      k = base2 + (seen[base2] > 1 ? '#' + seen[base2] : '');
      var html = rowHtml(ordered[i]);
      var anchorEl = box.firstChild;
      if (ROW_NODES[k] && ROW_HTML[k] === html) {
        /* 内容没变，但**位置可能要变** ⇒ 仍把已挂载节点移到首位（移动，不是重建）。 */
        var ex = ROW_NODES[k];
        for (var q = ex.length - 1; q >= 0; q--) { box.insertBefore(ex[q], anchorEl); anchorEl = ex[q]; }
        continue;
      }
      if (ROW_NODES[k]) {                                        /* 内容变了：只重建这一行 */
        ROW_NODES[k].forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
      }
      var tpl = document.createElement('tbody');
      tpl.innerHTML = html;
      var nodes = [];
      while (tpl.firstChild) { nodes.push(tpl.firstChild); tpl.removeChild(tpl.firstChild); }
      for (var j = nodes.length - 1; j >= 0; j--) { box.insertBefore(nodes[j], anchorEl); anchorEl = nodes[j]; }
      ROW_NODES[k] = nodes;
      ROW_HTML[k] = html;
    }
    if (window.syncFades) window.syncFades();
  }

  window.CxCockpit = { render: render, classifyStatus: classifyStatus, statusOf: statusOf };

  /* 向壳声明"我这样渲染一份快照"。壳据此**只在驾驶舱上台时**调用 ——
   * 这正是本资产此前缺失的那一句：壳每 2 秒无条件渲染它，哪怕它不在台上
   * （实测见 `web/tests/perf_measure.js`）。
   *
   * 注册放在导出之后：壳在 `applyView` 里于 ENTER 之后补渲染，所以注册只要在
   * 第一次数据到达前完成即可（本脚本与 `script.html` 同批装配，满足）。 */
  if (window.Cx && window.Cx.onRender) { window.Cx.onRender('cockpit', render); }
})();
