/* ============================================================
  Cellrix ProveTrack view layer (ADR-0016 D1) — state + rendering + interaction
  State S and capability probe HAS are owned solely by this layer; the data layer stays stateless (D6).
  Cross-asset communication goes through the window.CxProveTrack namespace (ADR-0016 D2).
  ============================================================ */
(function () {
  'use strict';
  var PT = window.CxProveTrack = window.CxProveTrack || {};
  var D = PT.data, R = PT.render, EF = window.CxEventFamily,
      $ = D.$, esc = D.esc, STATUS = D.STATUS, fmtDur = D.fmtDur, fmtTok = D.fmtTok;
  if (!EF || !R) { throw new Error('prove_track.view.js requires event_family.js + prove_track.render.js'); }

  /* The classes this layer draws differently, taken from the contract's kind
   * table: a class name is a type fact and has exactly one source. */
  var TOOL_CLS = EF.KIND_CLASS.tool, REPLY_CLS = EF.KIND_CLASS.reply,
      THINK_CLS = EF.KIND_CLASS.reasoning, ATTEMPT_CLS = EF.KIND_CLASS.plan,
      CHECK_CLS = EF.KIND_CLASS.check, VERDICT_CLS = EF.KIND_CLASS.verdict;

  /* The lanes this view draws, read off the render table rather than retyped.
   * Each lane's element id is derived from its name; a lane with no element is
   * skipped here and caught by the DOM contract test instead of by a crash. */
  var LANES = (function () {
    var seen = {}, out = [];
    Object.keys(R.LANE_OF).forEach(function (k) {
      var l = R.LANE_OF[k];
      if (!seen[l]) { seen[l] = true; out.push(l); }
    });
    return out;
  })();
  function laneEl(lane) {
    return $('eLane' + lane.charAt(0).toUpperCase() + lane.slice(1));
  }

  /* ---------- State ---------- */
  var S = {
    session: [], turnIds: [], turnIndex: {},
    durMode: 'equal', openTurns: {}, callsOpen: true, q: '',
    sel: null, replayIdx: -1, replayTimer: null,
    lastFocusEv: null, lastFocusEl: null, meta: null,
    usage: null,
    /* Compact view. Borrowed from DSH's transcript policy, which calls it
     * Compact and makes it the default: a COMPLETED turn does not have to keep
     * justifying itself line by line, so its internal steps fold into one row
     * that says how many there were and what they cost. `foldedTurns` is the
     * per-turn exception, and `compactGroups` is derived on every render (see
     * compactGroupsOf) rather than stored, so it cannot go stale. */
    compact: true, foldedTurns: {}, compactGroups: {}
  };

  var HAS = {
    sticky: !!(window.CSS && CSS.supports && CSS.supports('position', 'sticky')),
    mq: !!window.matchMedia,
    passive: (function () {
      var ok = false;
      try {
        var o = Object.defineProperty({}, 'passive', { get: function () { ok = true; return false; } });
        window.addEventListener('_t', null, o); window.removeEventListener('_t', null, o);
      } catch (e) {}
      return ok;
    })(),
    ro: !!window.ResizeObserver,
    io: !!window.IntersectionObserver
  };

  /* ---------- Highlight (consumes S.q) ---------- */
  function hl(s) {
    if (!S.q) return esc(s);
    var q = S.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return esc(s).replace(new RegExp('(' + q + ')', 'gi'), '<span class="e-hit">$1</span>');
  }

  /* ---------- Stats ---------- */
  function renderStats() {
    var evs = S.session.filter(function (e) { return e.kind === 'ev'; });
    var turns = S.session.filter(function (e) { return e.kind === 'turn'; }).length;
    var calls = evs.filter(function (e) { return e.cls === TOOL_CLS && e.status === 'pending'; }).length;
    var llm = evs.reduce(function (a, e) { return a + ((e.cls === THINK_CLS || e.cls === ATTEMPT_CLS) ? e.dur : 0); }, 0);
    var toolT = evs.reduce(function (a, e) { return a + (e.cls === TOOL_CLS ? e.dur : 0); }, 0);
    // The metering cells read the derived result of derivePeriodUsage
    // (computed by the control layer at load time). No data means em dash —
    // never an estimate (ADR-0038 D11).
    var u = S.usage;
    var html =
      '<div class="e-stat"><b>' + turns + '</b><span>TURNS</span></div>' +
      '<div class="e-stat"><b>' + evs.length + '</b><span>STEPS</span></div>' +
      '<div class="e-stat"><b>' + calls + '</b><span>TOOL CALLS</span></div>' +
      '<div class="e-stat"><b>' + fmtDur(llm) + '</b><span>LLM TIME</span></div>' +
      '<div class="e-stat"><b>' + fmtDur(toolT) + '</b><span>TOOL TIME</span></div>' +
      '<div class="e-stat"><b>' + fmtTok(u && u.total) + '</b><span>TOKENS</span></div>' +
      '<div class="e-stat"><b>' + fmtTok(u && u.cached) + '</b><span>CACHE HIT</span></div>' +
      '<div class="e-stat"><b>' + fmtTok(u && u.input) + '</b><span>INPUT TOK</span></div>';
    /* 变化才写：同数据轮询不碰 DOM（8 个静态单元无需整块重写） */
    var el = $('eStats');
    if (!el) return;
    if (STATS_HTML === html) return;
    STATS_HTML = html;
    el.innerHTML = html;
  }

  /* ---------- Table ---------- */
  /* What compact mode folds, decided by one rule and stated here rather than
   * sprinkled through the renderer:
   *
   *   a step folds when it is DONE and it is not the answer.
   *
   * Everything that asks something of the reader stays: an answer, a judgement,
   * a verdict, a failure, anything still running, and — while a search is on —
   * everything, because a filter that hides its own matches is worse than no
   * filter. Folding that dropped a failure would be the same fault as a status
   * column that only ever says "done". */
  /* What compact must NEVER hide, stated once and used by BOTH halves — the fold
   * selection and the fold skip.
   *
   * They used to disagree, and the disagreement hid the answer: the selection
   * pushed REPLY into `ids` believing "a REPLY is always drawn, so it cannot be
   * inside the disclosure either way", while the skip below removed EVERY row in
   * `ids`. Measured in Chrome 2026-09-24: a reply-only turn — where the answer is
   * the only content row — rendered a header saying "内部步骤已折叠 · 1 internal
   * steps" and nothing else. The reader lost the reply, which is exactly what the
   * rule above forbids ("an answer, a judgement, a verdict, a failure ... stays").
   *
   * A single predicate is the fix for the CLASS of bug, not just this instance:
   * two halves of one rule drifting apart is how a status column comes to say
   * only "done". */
  function neverFolded(cls) {
    return cls === REPLY_CLS || cls === CHECK_CLS || cls === VERDICT_CLS;
  }

  function compactGroupsOf() {
    var out = {};
    /* M1/c1 (ADR-0048 §72): ONE projection call for the session; each group takes ITS
     * turn's state BY ID (never by index). The view no longer accumulates tokens, so
     * the seed bug (`add(0, inapplicable) -> 0`) cannot recur: a segment with no
     * applicable rows carries the projection's A and renders as no-data, not as 0. */
    /* GROUPING COMES FROM THE PROJECTION (ADR-0048 §74.1): the view no longer decides
     * which events form a segment — it FILTERS the projection's list. Selection is
     * downstream of grouping, not part of it (relational algebra / map.filter.reduce),
     * so "the two sets disagree" is unrepresentable: a turn the projection did not
     * produce simply cannot appear, and one it did produce cannot vanish silently. */
    var cellProj = window.CxCellMetering.project(S.session);
    var cellTurnItem = {};
    for (var ci = 0; ci < S.session.length; ci++) {
      if (S.session[ci].kind === 'turn') { cellTurnItem[String(S.session[ci].id)] = S.session[ci]; }
    }
    if (!S.compact) { return out; }
    cellProj.turns.forEach(function (t) {
      var ids = [], dur = 0, failed = 0, anyShown = false;
      t.events.forEach(function (e) {
        /* A failure is never folded: it is the one thing a reader must not have
         * to open a disclosure to find.
         *
         * The status vocabulary here is `ok` / `fail` / `pending`, plus `done` —
         * and the two are NOT interchangeable, which cost a rebuild to learn:
         * `render.statusOf` returns `ok` for the kinds it judges (tool, check,
         * verdict) and `done` for every other kind, and `done` is what the rows
         * actually carry. Reading only `ok` therefore found no completed step at
         * all and folded nothing.
         *
         * Folding is about the steps that are neither the answer nor a request
         * for one. A REPLY does not block folding — it is always drawn, so it
         * cannot be inside the disclosure either way; blocking on it was the
         * second reason nothing folded (`why: ["REPLY"]` on every turn, measured
         * in Chrome). A tool CALL does block, because the reader asked to see
         * requests and the fold must not overrule that. Anything unsettled or
         * unrecognised blocks too: assuming foldability is the direction that
         * hides work. */
        if (e.status === 'fail') { anyShown = true; failed++; }
        else if (e.status === 'pending') { anyShown = true; }
        else if (e.status === 'ok' || e.status === 'done') {
          /* A tool row with status `ok` is the RESPONSE side; the call itself is
           * the `pending` row and is already reserved above, so the requests stay
           * visible whichever way the reader set "Expand all calls". */
          if (e.cls === TOOL_CLS) { anyShown = true; }
          else if (!neverFolded(e.cls)) {
            /* M1 (ADR-0048 §71): the token value comes from the SINGLE projection — the
             * state, not a bare number — so absent/null/present(0) stay distinguishable
             * here. Interface names are read off the implementation's exports. */
            ids.push(e.id);
            /* the duration comes from the PROJECTION, not from a typeof probe on the row
             * (ADR-0048 §125 / M3 — the value leaves the view, and the typeof goes with it). */
            var dcell = window.CxCellMetering.durOf(e);
            if (window.CxCellMetering.isPresent(dcell)) { dur += dcell.v; }
          }
        } else { anyShown = true; }
      });
      if (ids.length && !anyShown) {
        out[t.id] = { ids: ids, tok: t.tok, dur: dur, failed: failed,
                      turn: cellTurnItem[String(t.id)] || t };
      }
    });
    return out;
  }

  /* ── 局部渲染：轨迹表按 key 复用行，不整表重建 ──────────────────────────
   * 此前 `$('eTbody').innerHTML = h` —— 数据每 2 秒到一次，每次清空重造全部行，
   * 展开态/滚动位置/焦点全丢（与账本同病）。照 cockpit.js 账本范式做 keyed 复用。
   * ⚠️ 键不含数组下标（教训：下标随追加平移 ⇒ 全部被当新行重建）；
   * ⚠️ "节点有没有被重建"与"它排在哪里"是两件独立的事 —— 两条都要断言。 */
  var TBL_NODES = {}, TBL_HTML = {}, TBL_EMPTY = false, TBL_LOADING = false, LANE_HTML = {}, STATS_HTML = '';

  function renderTable() {
    var rows = [], COLS = 5;
    S.compactGroups = compactGroupsOf();
    for (var i = 0; i < S.session.length; i++) {
      var it = S.session[i];
      if (it.kind === 'turn') {
        var cnt = 0, tl = 0;
        for (var k = i + 1; k < S.session.length && S.session[k].kind !== 'turn'; k++) { cnt++; tl += S.session[k].dur; }
        var isOpen = !!S.openTurns[it.id];
        rows.push({ key: 't:' + it.id, html: '<tr class="e-turn-hd"><td colspan="' + COLS + '">' +
          '<button type="button" class="e-turn-btn" data-e-turntoggle="' + it.id + '" aria-expanded="' + isOpen + '">' +
          '<span style="display:inline-block;width:14px" aria-hidden="true">' + (isOpen ? '▾' : '▸') + '</span>' +
          '<span>Turn ' + it.index + ' · ' + esc(it.note) + '</span>' +
          '<span class="cnt"> · ' + cnt + ' events · ' + fmtDur(tl) + '</span>' +
          '</button></td></tr>' });
        /* The folded row, drawn where the steps it stands for would have been —
         * directly under its turn header. It borrows the turn header's own
         * control and its `cnt` shoulder so the count is not a second verb to
         * learn, and it never becomes the only way to reach the rows: the
         * disclosure is the same affordance as expanding the turn.
         *
         * It does NOT depend on whether the turn is open — turns arrive open by
         * default (`openTurns` is true for all seven on load), and gating on a
         * closed turn meant compact folded nothing at all (measured: 59 rows,
         * 0 folded). Compact is the presentation of a completed turn, not a state
         * of its disclosure.
         *
         * It DOES follow the turn being CLOSED, because a folded row stands in for
         * rows that are not drawn: with the turn collapsed its stand-in has to go
         * too. Measured: collapsing all turns left 0 event rows and 5 fold rows
         * still on screen — the disclosure was bypassed. */
        var g = S.compactGroups[it.id];
        if (g && isOpen && !S.foldedTurns[it.id] && !S.q) {
          var open = !!S.foldedTurns[it.id];
          rows.push({ key: 'c:' + it.id, html: '<tr class="e-compact-hd"><td colspan="' + COLS + '">' +
            '<button type="button" class="e-turn-btn e-compact-btn" data-e-compacttoggle="' + it.id + '" ' +
            'aria-expanded="' + open + '">' +
            '<span style="display:inline-block;width:14px" aria-hidden="true">' + (open ? '▾' : '▸') + '</span>' +
            '<span>内部步骤已折叠</span>' +
            '<span class="cnt"> · ' + g.ids.length + ' internal steps · ' + fmtDur(g.dur) +
            /* I6 (CI-144 §13.3): 缺失不得比显式未知更宽松。
             * `g.tok ? ... : ''` rendered an UNMEASURED fold and a fold that
             * measured ZERO identically — both produced no statement at all.
             * That is §2's constraint 3 (unknown must have a type-level
             * representation, not a default) and the same shape as K-105.
             * `0` now prints `0`; only "no measurement" says so. */
            (window.CxCellMetering.isPresent(g.tok) ? ' · ' + fmtTok(g.tok.v) + ' tok'
                                      : ' · ' + window.CxCellMetering.foldedCell(g)) +
            (g.failed ? ' · ⚠ ' + g.failed + ' failed' : '') + '</span>' +
            '</button></td></tr>' });
        }
        continue;
      }
      if (!S.openTurns[it.turn]) continue;
      var grp = S.compactGroups[it.turn];
      /* Folded means folded: the step stays inside the disclosure even when the
       * turn itself is open, because compact mode is what the reader asked for.
       * Expanding a single turn (the turn header) is the per-turn exception and
       * it re-reveals these steps through `foldedTurns` — set by clicking the
       * folded row. Two independent disclosures, neither hidden by the other. */
      if (grp && !S.q && !S.foldedTurns[it.turn] && !neverFolded(it.cls)
          && grp.ids.indexOf(it.id) > -1) continue;
      if (it.cls === TOOL_CLS && !S.callsOpen) continue;

      var st = STATUS[it.status] || STATUS.done;
      var isSel = (S.sel === it.id);
      var isRunning = (S.replayIdx >= 0 && i === S.replayIdx);
      var rowCls = 'ev' + (isRunning ? ' e-running' : '') + (it.cls === REPLY_CLS ? ' e-reply' : '');
      var isHit = S.q && (it.summary + ' ' + (it.tool || '') + ' ' + it.cls).toLowerCase().indexOf(S.q.toLowerCase()) > -1;
      rows.push({ key: 'e:' + it.id, html: '<tr class="' + rowCls + (isHit ? ' e-row-hit' : '') + '" data-e-ev="' + it.id + '" tabindex="0"' +
        (isSel ? ' aria-current="true"' : '') + '>' +
        '<td><span class="e-ty ' + it.cls + '">' + it.cls + '</span></td>' +
        '<td class="e-summ"' + (it.cls === REPLY_CLS && it.payload ? ' title="' + esc(String(it.payload).slice(0, 300)) + '"' : '') + '>' +
        (it.cls === REPLY_CLS && it.full
          ? '<span class="e-short">' + hl(it.summary) + '</span><span class="e-full">' + esc(it.full) + '</span>'
          : hl(it.summary)) +
        (it.repeat ? '<span class="e-rep">stuck ×' + it.repeat + '</span>' : '') + '</td>' +
        '<td><span class="e-st ' + st.c + '"><span class="d"></span>' + st.t + '</span></td>' +
        '<td class="e-dur">' + fmtDur(it.dur) + '</td>' +
        '<td class="e-tok">' + window.CxCellMetering.stateText(cellBarAt(i)) + '</td></tr>' });
    }
    /* Nothing to draw. Before this the table simply went blank, which is
     * indistinguishable from "still loading" and gives no way forward
     * (ADR-0044 §1.2 listed it as the missing zero state). Which of the two it
     * is depends on whether a filter is on, and the exit layer says so. */
    var box = $('eTbody');
    if (!rows.length) {
      /* 空态只建一次：此前每次轮询都清空重造同一个占位行（同数据不该重建）。
       * 正在取数时(`TBL_LOADING`)例外：空态要把 loading 换成真正的零态，
       * 否则"正在载入"会永远留在那里 —— 没有人会回来把它换掉。 */
      if (!TBL_EMPTY || TBL_LOADING) {
        Object.keys(TBL_NODES).forEach(function (old) {
          (TBL_NODES[old] || []).forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
          delete TBL_NODES[old]; delete TBL_HTML[old];
        });
        var code = TBL_LOADING
          ? 'trajectory-loading'
          : (S.q ? 'trajectory-no-match' : 'trajectory-no-rows');
        var act = TBL_LOADING
          ? undefined
          : (S.q
            ? { run: function () { S.q = ''; $('eQ').value = ''; renderTable(); } }
            : { label: '看左边的经历列表', run: function () {
                  var side = document.getElementById('s-side');
                  if (side && side.scrollIntoView) { side.scrollIntoView({ block: 'nearest' }); }
                } });
        var tr = document.createElement('tr');
        var td = document.createElement('td');
        td.colSpan = COLS;
        td.appendChild(window.CxWayout.build({ code: code, action: act }));
        tr.appendChild(td);
        box.innerHTML = '';
        box.appendChild(tr);
        TBL_EMPTY = true; TBL_LOADING = false;
      }
      updTbl();
      return;
    }
    if (TBL_EMPTY || TBL_LOADING) { box.innerHTML = ''; TBL_EMPTY = false; TBL_LOADING = false; }
    /* ── 局部渲染：按 key 复用行，不整表重建 ──────────────────────────────
     * 键：ev 行取事件 id，turn 头与折叠头取 turn id，前缀防撞键；键不含下标。
     * 顺序自顶向下（旧在前）⇒ 逐个 appendChild（对已挂载节点是**移动**），
     * 新行自然落位末尾；键相同而 HTML 变了 ⇒ 只重建那一行。 */
    var want = {};
    rows.forEach(function (r) { want[r.key] = true; });
    Object.keys(TBL_NODES).forEach(function (old) {
      if (want[old]) return;
      (TBL_NODES[old] || []).forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
      delete TBL_NODES[old]; delete TBL_HTML[old];
    });
    for (var ri = 0; ri < rows.length; ri++) {
      var r = rows[ri], k = r.key;
      if (TBL_NODES[k] && TBL_HTML[k] === r.html) {
        TBL_NODES[k].forEach(function (n) { box.appendChild(n); });
        continue;
      }
      if (TBL_NODES[k]) {
        TBL_NODES[k].forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
      }
      var tpl = document.createElement('tbody');
      tpl.innerHTML = r.html;
      var nodes = [];
      while (tpl.firstChild) { nodes.push(tpl.firstChild); tpl.removeChild(tpl.firstChild); }
      nodes.forEach(function (n) { box.appendChild(n); });
      TBL_NODES[k] = nodes;
      TBL_HTML[k] = r.html;
    }
    updTbl();
  }

  /* ---------- Three lanes: one shared ruler ---------- */
  /* BARS FOR THE ROW CELL, DERIVED — NOT STORED STALE (ADR-0048 §80.2). The first draft
   * memoised on a plain field, which would survive a session change and serve widths
   * from the previous session. Keyed on the ARRAY IDENTITY, it re-derives exactly when
   * the input changes. (Same rule the compact groups already follow one screen up:
   * "derived on every render rather than stored, so it cannot go stale".) */
  /* NO STORED DERIVED VALUE (ADR-0048 §82). A cache is a SECOND COPY OF TRUTH, and its
   * invalidation is the classic hard problem; every variant of storing this one was
   * wrong in a different way (session identity misses in-place pushes; a render counter
   * never evicts anything, and no bound/TTL is a cache's DEFAULT, not an accident).
   * Legitimate caching needs an IMMUTABLE VALUE as the key, and `S.session` is pushed
   * into in place — so it is not a value, and caching it is illegitimate. project() is
   * cheap: just compute it. */
  function cellBarAt(i) {
    var bars = window.CxCellMetering.project(S.session).bars;
    return bars[i] ? bars[i].value : null;
  }

  function renderLanes() {
    var lanes = {}, evs = [];
    LANES.forEach(function (k) { lanes[k] = []; });
    S.session.forEach(function (e) { if (e.kind === 'ev') evs.push(e); });
    /* STEP 2 (ADR-0048 §113): THE LENGTH CHANNEL'S QUANTITY IS DECLARED HERE, ONCE.
     * `rows` is built once and only `mode` differs — two branches each assembling their own
     * rows would be "one cell, two sources". The declared quantity is DURATION (§110.1);
     * the mode comes from the view's own switch, so allocate never guesses. */
    var laneRows = evs.map(function (e) {
      return { state: window.CxCellMetering.durOf(e) };
    });
    var laneMode = (S.durMode === 'actual') ? 'value' : 'equal';
    var laneAlloc = window.CxCellMetering.allocate(laneRows, { gridCols: 200, mode: laneMode });
    /* THE LEGACY LENGTH PATH IS GONE (ADR-0048 §125 / M3). maxDur/maxTok/raw/PEND_MIN/sum had
     * NO CONSUMER left after step 2 moved the width to the projection's column, so they were
     * dead code that still LOOKED alive — and they carried five of the six registered identity
     * elements (1.2, ||1, (maxTok||1), (maxDur||1), reduce(...,0)||1) plus the pending boost.
     * Deleting dead code is not "getting the count down": the values left the view earlier;
     * this only stops the view from pretending to compute them. The pending axis must come
     * back as a DECLARED state (never as a silent width boost) — that remains open (§113.4). */
    evs.forEach(function (e, idx) {
      /* THE WIDTH IS THE PROJECTION'S COLUMN — no arithmetic, no rounding here. A row whose
       * state is not present carries that state in data-* so `absent` and `present(0)` are
       * DISTINGUISHABLE IN THE DOM (ADR-0048 §112.4); it does not encode the state as 0. */
      var colPct = laneAlloc.cols[idx];
      var laneState = laneRows[idx] && laneRows[idx].state;
      /* EXHAUSTIVE, NOT A TERNARY WITH AN `else` (ADR-0048 §137): the old form mapped any
       * unlisted shape to "absent", so the run mode (`ps`) would have rendered as "not
       * measured" the moment A2 wires it in. Unlisted ⇒ its OWN name, never a silent absorb. */
      var stateName = null;
      if (laneState && laneState.k !== window.CxCellMetering.P(0).k) {
        stateName = laneState.k === window.CxCellMetering.N().k ? 'unmeasured'
                  : laneState.k === window.CxCellMetering.A().k ? 'absent'
                  : 'narrative';        /* k=ps: a fact, not a magnitude, not "absent" */
      }
      var stateAttr = stateName
        ? ' data-cell-state="' + stateName + '"'
          /* NAME COLLISION AVOIDED (ADR-0048 §120.5): this attribute carries the LANE's
           * LENGTH-CHANNEL mode (equal|value). The RUN mode (drive|partner|survive) is a
           * different quantity and must not share the name — one attribute, one quantity. */
          + ' data-cell-lenmode="' + laneMode + '"'
        : '';
      /* the STRICT predicate, not `typeof`: rule ⑫ (§116) — a coercing guard cannot see a null. */
      var wPct = window.CxCellMetering.isFiniteNumber(colPct) ? colPct + '%' : '';
      var hit = S.q && (e.summary + ' ' + (e.tool || '')).toLowerCase().indexOf(S.q.toLowerCase()) > -1;
      var isSel = (S.sel === e.id);
      LANES.forEach(function (k) {
        if (e.lane === k) {
          var blkCls = 'e-blk ' + e.lane + (e.status === 'fail' ? ' fail' : '') +
            (e.status === 'pending' ? ' wait' : '') + (isSel ? ' sel' : '') +
            (S.q && !hit ? ' dim' : '');
          lanes[k].push('<div class="' + blkCls + '" data-e-ev="' + e.id + '" aria-hidden="true" ' +
            'title="step ' + (idx + 1) + ' · ' + esc(e.cls + ' · ' + e.summary) + '" ' +
            'style="flex:0 0 ' + wPct + '"' + stateAttr + '></div>');
        } else {
          lanes[k].push('<div class="e-blk e-blk-empty" aria-hidden="true" style="flex:0 0 ' + wPct + '"></div>');
        }
      });
    });
    /* 变化才写：同数据轮询时一个节点都不碰（与 eStats 同一策略） */
    LANES.forEach(function (k) {
      var el = laneEl(k);
      if (!el) return;
      var html = lanes[k].join('');
      if (LANE_HTML[k] === html) return;
      LANE_HTML[k] = html;
      el.innerHTML = html;
    });
    $('eOvNote').textContent = S.durMode === 'actual'
      ? 'actual time: see which is slowest (widest = longest)' : 'equal width: see what happened (duration ignored)';
  }

  /* ---------- Occlusion self-evidence: one rule for four directions ---------- */
  function initEdges(vp, sc, opt) {
    opt = opt || {};
    function upd() {
      if (!vp || !sc) return;
      vp.dataset.t = (opt.noTop || sc.scrollTop <= 1) ? '0' : '1';
      vp.dataset.b = (sc.scrollTop + sc.clientHeight < sc.scrollHeight - 1) ? '1' : '0';
      vp.dataset.l = (sc.scrollLeft > 1) ? '1' : '0';
      vp.dataset.r = (sc.scrollLeft + sc.clientWidth < sc.scrollWidth - 1) ? '1' : '0';
      if (opt.focusable) sc.tabIndex = (vp.dataset.t === '1' || vp.dataset.b === '1') ? 0 : -1;
    }
    sc.addEventListener('scroll', upd, HAS.passive ? { passive: true } : false);
    if (HAS.ro) new ResizeObserver(upd).observe(sc);
    window.addEventListener('resize', upd);
    upd();
    return upd;
  }
  var updTbl = initEdges($('eTblVp'), $('eTblScroll'), { noTop: HAS.sticky });
  var updInsp = initEdges($('eInspB').parentNode, $('eInspB'), { focusable: true });

  function bindTermEdges() {
    var nodes = document.querySelectorAll('#view-prove-track .e-tpre');
    for (var i = 0; i < nodes.length; i++) {
      var vp = nodes[i];
      if (vp.dataset.bound) continue;
      vp.dataset.bound = '1';
      initEdges(vp, vp.querySelector('pre'));
    }
  }

  /* ---------- Modality renegotiated with the viewport ---------- */
  var narrowMQ = HAS.mq ? matchMedia('(max-width:1179px)') : null;
  function isModal() { return !!(narrowMQ && narrowMQ.matches); }
  function applyModality() {
    $('eInsp').setAttribute('aria-modal', isModal() ? 'true' : 'false');
  }
  if (narrowMQ) {
    if (narrowMQ.addEventListener) narrowMQ.addEventListener('change', applyModality);
    else if (narrowMQ.addListener) narrowMQ.addListener(applyModality);
  }

  /* ---------- Inspector ---------- */
  function openInsp(id) {
    var ev = null;
    S.session.forEach(function (e) { if (e.id === id) ev = e; });
    if (!ev) return;
    var ae = document.activeElement;
    S.lastFocusEv = (ae && ae.dataset && ae.dataset.eEv) ? ae.dataset.eEv : null;
    if (!S.lastFocusEv) {
      var rebuilt = ae && ae.closest && (ae.closest('#eTbody') || ae.closest('.e-lane'));
      S.lastFocusEl = (ae && !rebuilt && ae !== document.body) ? ae : null;
    } else { S.lastFocusEl = null; }
    S.sel = id;

    var st = STATUS[ev.status] || STATUS.done;
    /* THE PERCENTAGE IS THE PROJECTION'S COLUMN, not a division in the view (ADR-0048 §125 / M3).
     * Same declared quantity and same mode as the lanes, so the inspector and the bars cannot
     * disagree about what share this event has. */
    var evsAll = S.session.filter(function (e) { return e.kind === 'ev'; });
    var iEv = -1;
    for (var i0 = 0; i0 < evsAll.length; i0++) { if (evsAll[i0].id === ev.id) { iEv = i0; break; } }
    var inspAlloc = window.CxCellMetering.allocate(
      evsAll.map(function (e) { return { state: window.CxCellMetering.durOf(e) }; }),
      { gridCols: 200, mode: (S.durMode === 'actual') ? 'value' : 'equal' });
    var inspCol = (iEv > -1) ? inspAlloc.cols[iEv] : null;
    var pct = window.CxCellMetering.isFiniteNumber(inspCol) ? inspCol.toFixed(1) : '0';
    var turnIdx = S.turnIndex[ev.turn] || '?';

    $('eInspT').textContent = (ev.tool ? ev.tool + ' · ' : '') + ev.cls;
    $('eInspS').innerHTML = hl(ev.summary);
    var resultHtml = ev.term
      ? '<div class="e-tpre"><pre class="e-term">' + esc(ev.detail) + '</pre>' +
        '<i class="e-eg l" aria-hidden="true"></i><i class="e-eg r" aria-hidden="true"></i></div>'
      : '<pre>' + esc(ev.detail) + '</pre>';
    $('eInspB').innerHTML =
      '<div class="e-sec"><h4>Summary</h4><dl class="e-kv">' +
      '<dt>Type</dt><dd>' + ev.cls + '</dd>' +
      (ev.tool ? '<dt>Tool</dt><dd><code>' + esc(ev.tool) + '</code></dd>' : '') +
      '<dt>Status</dt><dd><span class="e-st ' + st.c + '"><span class="d"></span>' + st.t + '</span></dd>' +
      '<dt>Turn</dt><dd>' + turnIdx + '</dd>' +
      '<dt>Reference</dt><dd><code>' + esc(ev.id) + '</code></dd>' +
      (ev.repeat ? '<dt>Stuck streak</dt><dd style="color:var(--e-warn);font-weight:700">' + ev.repeat + ' consecutive identical calls</dd>' : '') +
      '</dl></div>' +
      '<div class="e-sec"><h4>Payload</h4><pre>' + esc(ev.payload || '—') + '</pre></div>' +
      '<div class="e-sec"><h4>Result</h4>' + resultHtml + '</div>' +
      '<div class="e-sec"><h4>Schema</h4><dl class="e-kv">' +
      '<dt>Kind</dt><dd>' + esc(ev.kindNote || '—') + '</dd>' +
      '<dt>Fields</dt><dd><code>' + esc((ev.fields || []).join(', ') || '—') + '</code></dd>' +
      '</dl></div>' +
      '<div class="e-sec"><h4>Timing</h4><dl class="e-kv">' +
      '<dt>Duration</dt><dd>' + fmtDur(ev.dur) + '</dd>' +
      '<dt>Share</dt><dd>' + pct + '%</dd>' +
      '<dt>Tokens</dt><dd>' + fmtTok(ev.tok) + '</dd>' +
      '<dt>Position</dt><dd>' + ev.ord + '</dd>' +
      '<dt>Time</dt><dd>' + esc(ev.ts || '—') + '</dd>' +
      '</dl></div>';
    applyModality();
    $('eInsp').classList.add('on');
    $('eScrim').classList.add('on');
    renderTable(); renderLanes(); updInsp(); bindTermEdges();
    $('eInspX').focus();
  }
  function closeInsp() {
    if (!S.sel) return;
    S.sel = null;
    $('eInsp').classList.remove('on');
    $('eScrim').classList.remove('on');
    renderTable(); renderLanes();
    var back = null;
    if (S.lastFocusEv) back = document.querySelector('#eTbody tr[data-e-ev="' + S.lastFocusEv + '"]');
    if (!back && S.lastFocusEl && document.contains(S.lastFocusEl)) back = S.lastFocusEl;
    if (back) back.focus();
    S.lastFocusEv = null; S.lastFocusEl = null;
  }
  $('eInsp').addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || !isModal()) return;
    var f = $('eInsp').querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  /* ---------- Replay (the glow only rides along while active) ---------- */
  var replayInView = true;
  function stopReplay() {
    if (S.replayTimer) { clearInterval(S.replayTimer); S.replayTimer = null; }
    S.replayIdx = -1;
    $('eReplayBtn').classList.remove('e-btn-primary');
    $('eReplayBtn').textContent = 'Replay';
    renderTable();
  }
  function startReplay() {
    var evs = [];
    S.session.forEach(function (e, i) { if (e.kind === 'ev') evs.push(i); });
    var i = 0;
    $('eReplayBtn').classList.add('e-btn-primary');
    $('eReplayBtn').innerHTML = '<span class="e-spin" aria-hidden="true"></span>Replaying';
    S.replayTimer = setInterval(function () {
      if (!replayInView || document.hidden) return;
      if (i >= evs.length) { stopReplay(); return; }
      S.replayIdx = evs[i];
      renderTable();
      i++;
    }, 420);
  }
  if (HAS.io) {
    new IntersectionObserver(function (es) { replayInView = es[0].isIntersecting; },
      { threshold: 0.15 }).observe($('eTraj'));
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && S.replayTimer) stopReplay();
  });

  /* ---------- the certificate: the same rows, read as a derivation ----------
   *
   * The trajectory answers "what happened, in order". This answers "what does
   * the conclusion rest on". Same session, second projection — so it lives here
   * rather than in a new asset.
   *
   * What is drawn is decided by `PT.export.certificateState`, not here: the view
   * renders the rule instead of re-deciding it. The rule is one sentence — the
   * conclusion plus every check whose citation does not resolve; everything else
   * folded — and the reason it is a rule and not a layout is that a default of
   * "everything" would make the certificate as expensive to read as the log it
   * exists to replace.
   *
   * Rendered as text, not as SVG edges, on purpose: the depth is three
   * (conclusion → judgement → exhibit) and the width is one line per item, which
   * an indented list carries for free. A node-link canvas would add an engine to
   * draw what indentation already says.
   */
  function certRow(cls, depth, main, meta) {
    var row = document.createElement('div');
    row.className = 'e-cert-row ' + cls;
    row.setAttribute('data-cert-depth', String(depth));
    var m = document.createElement('span');
    m.className = 'e-cert-main';
    m.textContent = main;
    row.appendChild(m);
    if (meta) {
      var k = document.createElement('span');
      k.className = 'e-cert-meta';
      k.textContent = meta;
      row.appendChild(k);
    }
    return row;
  }

  function renderCertificate(session) {
    var st = PT.export.certificateState(PT.export.derivation(session));
    var head = $('eCertHead'), fold = $('eCertFold');
    if (!head || !fold) { return; }
    while (head.firstChild) { head.removeChild(head.firstChild); }
    while (fold.firstChild) { fold.removeChild(fold.firstChild); }

    /* The conclusion comes first whenever there is one, and the number of
     * judgements never decides whether it is drawn.
     *
     * This branch used to key on `totals.checks`, which made one view say two
     * contradictory things: with a period chosen and its verdict recorded, but no
     * judgement rows in the window, the head read `no conclusion to read yet`
     * WHILE the same certificate held the conclusion — measured live, that verdict
     * was `Met`. "How many judgements" and "is there a conclusion" are different
     * facts, and the conclusion is the one the reader came for. So the verdict
     * leads whenever it exists, and the absence of judgements is said BESIDE it
     * rather than instead of it. */
    var v = st.verdict;
    if (v) {
      head.appendChild(certRow('e-cert-verdict', 0, v.status || 'verdict', String(v.id)));
      if (!st.totals.checks) {
        head.appendChild(certRow('e-cert-note', 1,
          'no judgements in this window',
          'the conclusion is recorded; nothing here has been judged yet'));
      }
    } else if (!st.totals.checks) {
      head.appendChild(certRow('e-cert-note', 0,
        'no conclusion to read yet',
        'pick a session on the left; the reading follows its rows'));
    }

    /* What needs the reader: a citation that resolves to nothing. Named, with the
     * id it cites, because that id is what has to be chased. */
    st.head.forEach(function (c) {
      head.appendChild(certRow('e-cert-dangling', 1,
        'unresolved: ' + (c.check || 'check') + ' cites ' + (c.cites || 'nothing'),
        (c.gate || '?') + ' gate · judged by ' + (c.judge || '?')));
    });

    /* What does not: counted, not listed. The count is the honest form of
     * "something is here" without spending the reader's attention on it. */
    if (st.foldedChecks || st.foldedExhibits) {
      fold.appendChild(certRow('e-cert-folded', 1,
        st.foldedChecks + ' judgement' + (st.foldedChecks === 1 ? '' : 's') +
        ' resolved · ' + st.foldedExhibits + ' exhibit' + (st.foldedExhibits === 1 ? '' : 's'),
        'folded — they support the conclusion and ask nothing of you'));
    }
    $('eCert').removeAttribute('hidden');
    $('eTblVp').setAttribute('hidden', '');
  }

  /* The other half of the switch: restore the timeline exactly as it was. */
  function showTimeline() {
    $('eCert').setAttribute('hidden', '');
    $('eTblVp').removeAttribute('hidden');
  }

  /* ---------- Exports (consumed by the ctrl layer) ---------- */
  PT.S = S; PT.HAS = HAS;
  /* "正在取这一段的事件…" is a STATE, so it comes from the one exit-layer resolver
   * like every other one (ADR-0044 §P1b) — and it is cleared by the same keyed
   * pass that owns the table.
   *
   * Measured 2026-09-24: the ctrl layer used to write the loading row straight
   * into `eTbody` with `innerHTML`. The keyed render never knew that node, so it
   * survived every later render and sat above the real rows forever — a state
   * with no exit, which N-012 forbids outright. */
  PT.showLoading = function (jobId) {
    S.loadingJob = jobId;
    TBL_EMPTY = true; TBL_LOADING = true;
    renderTable();
  };
  PT.renderStats = renderStats; PT.renderTable = renderTable; PT.renderLanes = renderLanes;
  PT.renderCertificate = renderCertificate; PT.showTimeline = showTimeline;
  PT.bindTermEdges = bindTermEdges; PT.isModal = isModal; PT.applyModality = applyModality;
  PT.openInsp = openInsp; PT.closeInsp = closeInsp;
  PT.stopReplay = stopReplay; PT.startReplay = startReplay;
})();
