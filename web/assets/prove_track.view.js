/* ============================================================
  Cellrix 证轨视图层（ADR-0016 D1）— 状态 + 渲染 + 交互件
  状态 S / 能力探测 HAS 归本层独占；数据层保持零状态（D6）。
  跨资产经 window.CxProveTrack 命名空间通信（ADR-0016 D2）。
  ============================================================ */
(function () {
  'use strict';
  var PT = window.CxProveTrack = window.CxProveTrack || {};
  var $ = PT.$, esc = PT.esc, STATUS = PT.STATUS,
      fmtDur = PT.fmtDur, fmtTok = PT.fmtTok, resultIsTerm = PT.resultIsTerm;

  /* ---------- 状态 ---------- */
  var S = {
    session: [], turnIds: [], turnIndex: {},
    durMode: 'equal', openTurns: {}, callsOpen: true, q: '',
    sel: null, replayIdx: -1, replayTimer: null,
    lastFocusEv: null, lastFocusEl: null, meta: null
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

  /* ---------- 高亮（消费 S.q） ---------- */
  function hl(s) {
    if (!S.q) return esc(s);
    var q = S.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return esc(s).replace(new RegExp('(' + q + ')', 'gi'), '<span class="e-hit">$1</span>');
  }

  /* ---------- 统计 ---------- */
  function renderStats() {
    var evs = S.session.filter(function (e) { return e.kind === 'ev'; });
    var turns = S.session.filter(function (e) { return e.kind === 'turn'; }).length;
    var calls = evs.filter(function (e) { return e.type === 'TOOL' && e.status === 'pending'; }).length;
    var llm = evs.reduce(function (a, e) { return a + ((e.type === 'THINK' || e.type === 'ATTEMPT') ? e.dur : 0); }, 0);
    var toolT = evs.reduce(function (a, e) { return a + (e.type === 'TOOL' ? e.dur : 0); }, 0);
    $('eStats').innerHTML =
      '<div class="e-stat"><b>' + turns + '</b><span>TURNS</span></div>' +
      '<div class="e-stat"><b>' + evs.length + '</b><span>STEPS</span></div>' +
      '<div class="e-stat"><b>' + calls + '</b><span>TOOL CALLS</span></div>' +
      '<div class="e-stat"><b>' + fmtDur(llm) + '</b><span>LLM 耗时</span></div>' +
      '<div class="e-stat"><b>' + fmtDur(toolT) + '</b><span>工具耗时</span></div>' +
      '<div class="e-stat"><b>—</b><span>TOKENS</span></div>' +
      '<div class="e-stat"><b>—</b><span>缓存命中</span></div>' +
      '<div class="e-stat"><b>—</b><span>TOK/S</span></div>';
  }

  /* ---------- 表格 ---------- */
  function renderTable() {
    var h = '', COLS = 5;
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
          '<span class="cnt"> · ' + cnt + ' 事件 · ' + fmtDur(tl) + '</span>' +
          '</button></td></tr>';
        continue;
      }
      if (!S.openTurns[it.turn]) continue;
      if (it.type === 'TOOL' && !S.callsOpen) continue;

      var st = STATUS[it.status] || STATUS.done;
      var isSel = (S.sel === it.id);
      var isRunning = (S.replayIdx >= 0 && i === S.replayIdx);
      var cls = 'ev' + (isRunning ? ' e-running' : '') + (it.type === 'REPLY' ? ' e-reply' : '');
      var isHit = S.q && (it.summary + ' ' + (it.tool || '') + ' ' + it.type).toLowerCase().indexOf(S.q.toLowerCase()) > -1;
      h += '<tr class="' + cls + (isHit ? ' e-row-hit' : '') + '" data-e-ev="' + it.id + '" tabindex="0"' +
        (isSel ? ' aria-current="true"' : '') + '>' +
        '<td><span class="e-ty ' + it.type + '">' + it.type + '</span></td>' +
        '<td class="e-summ"' + (it.type === 'REPLY' && it.payload ? ' title="' + esc(String(it.payload).slice(0, 300)) + '"' : '') + '>' +
        (it.type === 'REPLY' && it.full
          ? '<span class="e-short">' + hl(it.summary) + '</span><span class="e-full">' + esc(it.full) + '</span>'
          : hl(it.summary)) +
        (it.repeat ? '<span class="e-rep">卡住 ×' + it.repeat + '</span>' : '') + '</td>' +
        '<td><span class="e-st ' + st.c + '"><span class="d"></span>' + st.t + '</span></td>' +
        '<td class="e-dur">' + fmtDur(it.dur) + '</td>' +
        '<td class="e-tok">' + fmtTok(it.tok) + '</td></tr>';
    }
    $('eTbody').innerHTML = h;
    updTbl();
  }

  /* ---------- 三轨：共用一根标尺 ---------- */
  function renderLanes() {
    var lanes = { input: [], model: [], tool: [] }, evs = [];
    S.session.forEach(function (e) { if (e.kind === 'ev') evs.push(e); });
    var maxDur = 0, maxTok = 0;
    evs.forEach(function (e) { if (e.dur > maxDur) maxDur = e.dur; if (e.tok > maxTok) maxTok = e.tok; });
    var raw = evs.map(function (e) {
      if (S.durMode !== 'actual') return 1;
      var v = e.dur > 0 ? e.dur : (e.tok / (maxTok || 1)) * maxDur * 0.5;
      return Math.max(1.2, (v / (maxDur || 1)) * 22);
    });
    /* 待应答保底可见：无限等待按耗时投射会被压成不可见 */
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
      ['input', 'model', 'tool'].forEach(function (k) {
        if (e.track === k) {
          var cls = 'e-blk ' + e.track + (e.status === 'fail' ? ' fail' : '') +
            (e.status === 'pending' ? ' wait' : '') + (isSel ? ' sel' : '') +
            (S.q && !hit ? ' dim' : '');
          lanes[k].push('<div class="' + cls + '" data-e-ev="' + e.id + '" aria-hidden="true" ' +
            'title="第 ' + (idx + 1) + ' 步 · ' + esc(e.type + ' · ' + e.summary) + '" ' +
            'style="flex:0 0 ' + wPct + '"></div>');
        } else {
          lanes[k].push('<div class="e-blk e-blk-empty" aria-hidden="true" style="flex:0 0 ' + wPct + '"></div>');
        }
      });
    });
    $('eLaneInput').innerHTML = lanes.input.join('');
    $('eLaneModel').innerHTML = lanes.model.join('');
    $('eLaneTool').innerHTML = lanes.tool.join('');
    $('eOvNote').textContent = S.durMode === 'actual'
      ? '实际耗时：看哪个最慢（最宽 = 最久）' : '等宽：看发生了什么（忽略时长）';
  }

  /* ---------- 遮挡自证：四方向统一 ---------- */
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

  /* ---------- 模态性随视口重协商 ---------- */
  var narrowMQ = HAS.mq ? matchMedia('(max-width:1179px)') : null;
  function isModal() { return !!(narrowMQ && narrowMQ.matches); }
  function applyModality() {
    $('eInsp').setAttribute('aria-modal', isModal() ? 'true' : 'false');
  }
  if (narrowMQ) {
    if (narrowMQ.addEventListener) narrowMQ.addEventListener('change', applyModality);
    else if (narrowMQ.addListener) narrowMQ.addListener(applyModality);
  }

  /* ---------- 检查器 ---------- */
  function openInsp(id) {
    var ev = null;
    S.session.forEach(function (e) { if (e.id === id) ev = e; });
    if (!ev) return;
    var ae = document.activeElement;
    S.lastFocusEv = (ae && ae.dataset && ae.dataset.ev) ? ae.dataset.ev : null;
    if (!S.lastFocusEv) {
      var rebuilt = ae && ae.closest && (ae.closest('#eTbody') || ae.closest('.e-lane'));
      S.lastFocusEl = (ae && !rebuilt && ae !== document.body) ? ae : null;
    } else { S.lastFocusEl = null; }
    S.sel = id;

    var st = STATUS[ev.status] || STATUS.done;
    var total = 0; S.session.forEach(function (e) { if (e.kind === 'ev') total += e.dur; });
    var pct = total ? ((ev.dur / total) * 100).toFixed(1) : '0';
    var turnIdx = S.turnIndex[ev.turn] || '?';

    $('eInspT').textContent = (ev.tool ? ev.tool + ' · ' : '') + ev.type;
    $('eInspS').innerHTML = hl(ev.summary);
    var resultHtml = resultIsTerm(ev)
      ? '<div class="e-tpre"><pre class="e-term">' + esc(ev.result) + '</pre>' +
        '<i class="e-eg l" aria-hidden="true"></i><i class="e-eg r" aria-hidden="true"></i></div>'
      : '<pre>' + esc(ev.result) + '</pre>';
    $('eInspB').innerHTML =
      '<div class="e-sec"><h4>Summary</h4><dl class="e-kv">' +
      '<dt>类型</dt><dd>' + ev.type + '</dd>' +
      (ev.tool ? '<dt>工具</dt><dd><code>' + esc(ev.tool) + '</code></dd>' : '') +
      '<dt>状态</dt><dd><span class="e-st ' + st.c + '"><span class="d"></span>' + st.t + '</span></dd>' +
      '<dt>所属轮次</dt><dd>Turn ' + turnIdx + '</dd>' +
      (ev.repeat ? '<dt>连续卡住</dt><dd style="color:var(--e-warn);font-weight:700">第 ' + ev.repeat + ' 次同类调用</dd>' : '') +
      '</dl></div>' +
      '<div class="e-sec"><h4>Payload</h4><pre>' + esc(ev.payload || '—') + '</pre></div>' +
      '<div class="e-sec"><h4>Result</h4>' + resultHtml + '</div>' +
      '<div class="e-sec"><h4>Schema</h4><pre>' + esc(ev.schema || '—') + '</pre></div>' +
      '<div class="e-sec"><h4>Timing</h4><dl class="e-kv">' +
      '<dt>耗时</dt><dd>' + fmtDur(ev.dur) + '</dd>' +
      '<dt>占全程</dt><dd>' + pct + '%</dd>' +
      '<dt>Tokens</dt><dd>' + fmtTok(ev.tok) + '</dd>' +
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

  /* ---------- 重放（微光只在活跃期搭车） ---------- */
  var replayInView = true;
  function stopReplay() {
    if (S.replayTimer) { clearInterval(S.replayTimer); S.replayTimer = null; }
    S.replayIdx = -1;
    $('eReplayBtn').classList.remove('e-btn-primary');
    $('eReplayBtn').textContent = '重放轨迹';
    renderTable();
  }
  function startReplay() {
    var evs = [];
    S.session.forEach(function (e, i) { if (e.kind === 'ev') evs.push(i); });
    var i = 0;
    $('eReplayBtn').classList.add('e-btn-primary');
    $('eReplayBtn').innerHTML = '<span class="e-spin" aria-hidden="true"></span>重放中';
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

  /* ---------- 对外导出（供 ctrl 层消费） ---------- */
  PT.S = S; PT.HAS = HAS;
  PT.renderStats = renderStats; PT.renderTable = renderTable; PT.renderLanes = renderLanes;
  PT.bindTermEdges = bindTermEdges; PT.isModal = isModal; PT.applyModality = applyModality;
  PT.openInsp = openInsp; PT.closeInsp = closeInsp;
  PT.stopReplay = stopReplay; PT.startReplay = startReplay;
})();
