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
      THINK_CLS = EF.KIND_CLASS.reasoning, ATTEMPT_CLS = EF.KIND_CLASS.plan;

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
    $('eStats').innerHTML =
      '<div class="e-stat"><b>' + turns + '</b><span>TURNS</span></div>' +
      '<div class="e-stat"><b>' + evs.length + '</b><span>STEPS</span></div>' +
      '<div class="e-stat"><b>' + calls + '</b><span>TOOL CALLS</span></div>' +
      '<div class="e-stat"><b>' + fmtDur(llm) + '</b><span>LLM TIME</span></div>' +
      '<div class="e-stat"><b>' + fmtDur(toolT) + '</b><span>TOOL TIME</span></div>' +
      '<div class="e-stat"><b>' + fmtTok(u && u.total) + '</b><span>TOKENS</span></div>' +
      '<div class="e-stat"><b>' + fmtTok(u && u.cached) + '</b><span>CACHE HIT</span></div>' +
      '<div class="e-stat"><b>' + fmtTok(u && u.input) + '</b><span>INPUT TOK</span></div>';
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
  function compactGroupsOf() {
    var out = {};
    if (!S.compact) { return out; }
    for (var i = 0; i < S.session.length; i++) {
      var it = S.session[i];
      if (it.kind !== 'turn') { continue; }
      var ids = [], tok = 0, dur = 0, failed = 0, anyShown = false;
      for (var k = i + 1; k < S.session.length && S.session[k].kind !== 'turn'; k++) {
        var e = S.session[k];
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
          else { ids.push(e.id); if (typeof e.dur === 'number') { dur += e.dur; } tok += (e.tok || 0); }
        } else { anyShown = true; }
      }
      if (ids.length && !anyShown) { out[it.id] = { ids: ids, tok: tok, dur: dur, failed: failed, turn: it }; }
    }
    return out;
  }

  function renderTable() {
    var h = '', COLS = 5;
    S.compactGroups = compactGroupsOf();
    for (var i = 0; i < S.session.length; i++) {
      var it = S.session[i];
      if (it.kind === 'turn') {
        var cnt = 0, tl = 0;
        for (var k = i + 1; k < S.session.length && S.session[k].kind !== 'turn'; k++) { cnt++; tl += S.session[k].dur; }
        var isOpen = !!S.openTurns[it.id];
        h += '<tr class="e-turn-hd"><td colspan="' + COLS + '">' +
          '<button type="button" class="e-turn-btn" data-e-turntoggle="' + it.id + '" aria-expanded="' + isOpen + '">' +
          '<span style="display:inline-block;width:14px" aria-hidden="true">' + (isOpen ? '▾' : '▸') + '</span>' +
          '<span>Turn ' + it.index + ' · ' + esc(it.note) + '</span>' +
          '<span class="cnt"> · ' + cnt + ' events · ' + fmtDur(tl) + '</span>' +
          '</button></td></tr>';
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
          h += '<tr class="e-compact-hd"><td colspan="' + COLS + '">' +
            '<button type="button" class="e-turn-btn e-compact-btn" data-e-compacttoggle="' + it.id + '" ' +
            'aria-expanded="' + open + '">' +
            '<span style="display:inline-block;width:14px" aria-hidden="true">' + (open ? '▾' : '▸') + '</span>' +
            '<span>内部步骤已折叠</span>' +
            '<span class="cnt"> · ' + g.ids.length + ' internal steps · ' + fmtDur(g.dur) +
            (g.tok ? ' · ' + fmtTok(g.tok) + ' tok' : '') +
            (g.failed ? ' · ⚠ ' + g.failed + ' failed' : '') + '</span>' +
            '</button></td></tr>';
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
      if (grp && !S.q && !S.foldedTurns[it.turn] && grp.ids.indexOf(it.id) > -1) continue;
      if (it.cls === TOOL_CLS && !S.callsOpen) continue;

      var st = STATUS[it.status] || STATUS.done;
      var isSel = (S.sel === it.id);
      var isRunning = (S.replayIdx >= 0 && i === S.replayIdx);
      var rowCls = 'ev' + (isRunning ? ' e-running' : '') + (it.cls === REPLY_CLS ? ' e-reply' : '');
      var isHit = S.q && (it.summary + ' ' + (it.tool || '') + ' ' + it.cls).toLowerCase().indexOf(S.q.toLowerCase()) > -1;
      h += '<tr class="' + rowCls + (isHit ? ' e-row-hit' : '') + '" data-e-ev="' + it.id + '" tabindex="0"' +
        (isSel ? ' aria-current="true"' : '') + '>' +
        '<td><span class="e-ty ' + it.cls + '">' + it.cls + '</span></td>' +
        '<td class="e-summ"' + (it.cls === REPLY_CLS && it.payload ? ' title="' + esc(String(it.payload).slice(0, 300)) + '"' : '') + '>' +
        (it.cls === REPLY_CLS && it.full
          ? '<span class="e-short">' + hl(it.summary) + '</span><span class="e-full">' + esc(it.full) + '</span>'
          : hl(it.summary)) +
        (it.repeat ? '<span class="e-rep">stuck ×' + it.repeat + '</span>' : '') + '</td>' +
        '<td><span class="e-st ' + st.c + '"><span class="d"></span>' + st.t + '</span></td>' +
        '<td class="e-dur">' + fmtDur(it.dur) + '</td>' +
        '<td class="e-tok">' + fmtTok(it.tok) + '</td></tr>';
    }
    /* Nothing to draw. Before this the table simply went blank, which is
     * indistinguishable from "still loading" and gives no way forward
     * (ADR-0044 §1.2 listed it as the missing zero state). Which of the two it
     * is depends on whether a filter is on, and the exit layer says so. */
    if (!h) {
      var code = S.q ? 'trajectory-no-match' : 'trajectory-no-rows';
      var act = S.q
        ? { run: function () { S.q = ''; $('eQ').value = ''; renderTable(); } }
        : { label: '看左边的经历列表', run: function () {
              var side = document.getElementById('s-side');
              if (side && side.scrollIntoView) { side.scrollIntoView({ block: 'nearest' }); }
            } };
      var tr = document.createElement('tr');
      var td = document.createElement('td');
      td.colSpan = COLS;
      td.appendChild(window.CxWayout.build({ code: code, action: act }));
      tr.appendChild(td);
      $('eTbody').innerHTML = '';
      $('eTbody').appendChild(tr);
      updTbl();
      return;
    }
    $('eTbody').innerHTML = h;
    updTbl();
  }

  /* ---------- Three lanes: one shared ruler ---------- */
  function renderLanes() {
    var lanes = {}, evs = [];
    LANES.forEach(function (k) { lanes[k] = []; });
    S.session.forEach(function (e) { if (e.kind === 'ev') evs.push(e); });
    var maxDur = 0, maxTok = 0;
    evs.forEach(function (e) { if (e.dur > maxDur) maxDur = e.dur; if (e.tok > maxTok) maxTok = e.tok; });
    var raw = evs.map(function (e) {
      if (S.durMode !== 'actual') return 1;
      var v = e.dur > 0 ? e.dur : (e.tok / (maxTok || 1)) * maxDur * 0.5;
      return Math.max(1.2, (v / (maxDur || 1)) * 22);
    });
    /* Pending must stay visible: projected by duration, an unbounded wait would collapse to invisible */
    var PEND_MIN = 0.05, pendIdx = [];
    evs.forEach(function (e, i) { if (e.status === 'pending') pendIdx.push(i); });
    if (pendIdx.length) {
      var restSum = 0, pendSum = 0;
      raw.forEach(function (v, i) { if (pendIdx.indexOf(i) > -1) pendSum += v; else restSum += v; });
      var need = (restSum / (1 - PEND_MIN)) * PEND_MIN;
      if (pendSum > 0 && pendSum < need) {
        var kk = need / pendSum;
        pendIdx.forEach(function (i) { raw[i] *= kk; });
      }
    }
    var sum = raw.reduce(function (a, b) { return a + b; }, 0) || 1;
    evs.forEach(function (e, idx) {
      var wPct = (raw[idx] / sum * 100).toFixed(4) + '%';
      var hit = S.q && (e.summary + ' ' + (e.tool || '')).toLowerCase().indexOf(S.q.toLowerCase()) > -1;
      var isSel = (S.sel === e.id);
      LANES.forEach(function (k) {
        if (e.lane === k) {
          var blkCls = 'e-blk ' + e.lane + (e.status === 'fail' ? ' fail' : '') +
            (e.status === 'pending' ? ' wait' : '') + (isSel ? ' sel' : '') +
            (S.q && !hit ? ' dim' : '');
          lanes[k].push('<div class="' + blkCls + '" data-e-ev="' + e.id + '" aria-hidden="true" ' +
            'title="step ' + (idx + 1) + ' · ' + esc(e.cls + ' · ' + e.summary) + '" ' +
            'style="flex:0 0 ' + wPct + '"></div>');
        } else {
          lanes[k].push('<div class="e-blk e-blk-empty" aria-hidden="true" style="flex:0 0 ' + wPct + '"></div>');
        }
      });
    });
    LANES.forEach(function (k) {
      var el = laneEl(k);
      if (el) { el.innerHTML = lanes[k].join(''); }
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
    var total = 0; S.session.forEach(function (e) { if (e.kind === 'ev') total += e.dur; });
    var pct = total ? ((ev.dur / total) * 100).toFixed(1) : '0';
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
  PT.renderStats = renderStats; PT.renderTable = renderTable; PT.renderLanes = renderLanes;
  PT.renderCertificate = renderCertificate; PT.showTimeline = showTimeline;
  PT.bindTermEdges = bindTermEdges; PT.isModal = isModal; PT.applyModality = applyModality;
  PT.openInsp = openInsp; PT.closeInsp = closeInsp;
  PT.stopReplay = stopReplay; PT.startReplay = startReplay;
})();
