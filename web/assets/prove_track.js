/* ============================================================
  Cellrix ProveTrack control layer (ADR-0016 D1/D3) — entry point
  Event binding / ripple feedback / public interface __proveTrackLoad|Clear
  Hard load-order constraint: this file must come after data / render / node /
  view and before script.html (D3).
  The public interface names are unchanged, so the call sites in script.html and
  main.rs need no edit.

  The trajectory has NO data source of its own. It is a target of the tape: the
  shell feeds one window (ADR-0018: one tape, many targets) and this file reads
  `nodes` off the snapshot. A second way in — fetching a period here — was the
  thing that made the trajectory a different story from the conversation.
  ============================================================ */
(function () {
  'use strict';
  var PT = window.CxProveTrack || {};
  var D = PT.data, N = PT.node,
      $ = D.$, esc = D.esc, S = PT.S, HAS = PT.HAS,
      buildSession = N.buildSession, computeRepeats = N.computeRepeats,
      derivePeriodUsage = N.derivePeriodUsage,
      renderStats = PT.renderStats, renderTable = PT.renderTable, renderLanes = PT.renderLanes,
      renderCertificate = PT.renderCertificate, showTimeline = PT.showTimeline,
      openInsp = PT.openInsp, closeInsp = PT.closeInsp, isModal = PT.isModal,
      applyModality = PT.applyModality, stopReplay = PT.stopReplay, startReplay = PT.startReplay;

  var TARGET = 'prove-track';

  /* ---------- Event binding ---------- */
  /* dataset key mapping: data-e-ev -> eEv, data-e-turntoggle -> eTurntoggle
     (HTML dataset drops the data- prefix and camel-cases the rest). */
  document.addEventListener('click', function (e) {
    var blk = e.target.closest && e.target.closest('.e-blk[data-e-ev]');
    var row = e.target.closest && e.target.closest('tr.ev[data-e-ev]');
    var tg = e.target.closest && e.target.closest('[data-e-turntoggle]');
    if (blk) { openInsp(blk.dataset.eEv); return; }
    if (row) {
      // REPLY = the deliverable: click toggles the full answer inline
      // (the answer is the body; detail is one tap away). Other rows open
      // the inspector as before.
      if (row.classList.contains('e-reply')) {
        row.classList.toggle('open');
        if (row.classList.contains('open')) row.scrollIntoView({ block: 'nearest' });
        return;
      }
      openInsp(row.dataset.eEv); return;
    }
    if (tg) {
      var id = tg.dataset.eTurntoggle;
      S.openTurns[id] = !S.openTurns[id];
      renderTable(); syncTurnBtn();
      return;
    }
    var ct = e.target.closest && e.target.closest('[data-e-compacttoggle]');
    if (ct) {
      var cid = ct.dataset.eCompacttoggle;
      S.foldedTurns[cid] = !S.foldedTurns[cid];
      renderTable();
    }
  });
  document.addEventListener('keydown', function (e) {
    if (document.getElementById('view-prove-track').style.display === 'none') return;
    var blk = e.target.closest && e.target.closest('.e-blk[data-e-ev]');
    var row = e.target.closest && e.target.closest('tr.ev[data-e-ev]');
    if ((blk || row) && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault(); openInsp((blk || row).dataset.eEv); return;
    }
    if (e.key === 'Escape' && S.sel) closeInsp();
  });

  function syncTurnBtn() {
    var allOpen = S.turnIds.every(function (id) { return S.openTurns[id]; });
    $('eTurnBtn').setAttribute('aria-pressed', String(allOpen));
    $('eTurnBtn').textContent = allOpen ? 'Collapse all turns' : 'Expand all turns';
  }
  /* 紧凑开关的同步。默认按下（折叠），所以 aria-pressed=true 时它做的是"放开"。 */
  function syncCompactBtn() {
    var b = $('eCompactBtn'); if (!b) { return; }
    b.setAttribute('aria-pressed', String(S.compact));
    b.textContent = S.compact ? '紧凑' : '完整';
  }
  $('eCompactBtn').addEventListener('click', function () {
    S.compact = !S.compact;
    syncCompactBtn();
    renderTable();
  });
  $('eInspX').addEventListener('click', closeInsp);
  $('eScrim').addEventListener('click', function () { if (isModal()) closeInsp(); });
  $('eDurBtn').addEventListener('click', function () {
    S.durMode = S.durMode === 'equal' ? 'actual' : 'equal';
    $('eDurLbl').textContent = S.durMode === 'actual' ? 'Actual time' : 'Equal width';
    this.setAttribute('aria-pressed', String(S.durMode === 'actual'));
    renderLanes();
  });
  $('eTurnBtn').addEventListener('click', function () {
    var allOpen = S.turnIds.every(function (id) { return S.openTurns[id]; });
    var target = !allOpen;
    S.turnIds.forEach(function (id) { S.openTurns[id] = target; });
    renderTable(); syncTurnBtn();
  });
  $('eCallBtn').addEventListener('click', function () {
    S.callsOpen = !S.callsOpen;
    this.setAttribute('aria-pressed', String(S.callsOpen));
    this.textContent = S.callsOpen ? 'Expand all calls' : 'Collapse all calls';
    renderTable();
  });
  /* 概览的收/放。默认收起（见 markup 里的那次实测），因此这里负责的是"放出来"。
   * 收起时它不占高度——表格因此拿回约 216px。 */
  $('eOvBtn').addEventListener('click', function () {
    var ov = $('eOv');
    var show = ov.hasAttribute('hidden');
    if (show) { ov.removeAttribute('hidden'); } else { ov.setAttribute('hidden', ''); }
    this.setAttribute('aria-pressed', String(show));
    this.className = 'e-btn e-btn-sm' + (show ? ' e-btn-primary' : '');
  });
  /* 推导 / 流向 的切换。
   *
   * 同一批行，两种读法：流向回答"按时间发生了什么"，推导回答"结论站在什么上"。
   * 默认仍是流向 —— 新增一个视角不该改变已有习惯（这也是它没有做成第二个页签的原因：
   * 页签会暗示它是另一份文档，而它只是同一份卷宗的目录页）。
   *
   * 折叠规则不在这里：`PT.export.certificateState` 决定默认显示什么，这里只负责切换。
   * 视图重复决定一次折叠，就是第二处会漂移的定义。 */
  $('eCertBtn').addEventListener('click', function () {
    var toCert = $('eCert').hasAttribute('hidden');
    if (toCert) { renderCertificate(S.session); } else { showTimeline(); }
    this.setAttribute('aria-pressed', String(toCert));
    this.className = 'e-btn e-btn-sm' + (toCert ? ' e-btn-primary' : '');
  });
  $('eReplayBtn').addEventListener('click', function () {
    (S.replayIdx >= 0 || S.replayTimer) ? stopReplay() : startReplay();
  });
  /* Export is PULL (ADR-0018 batch 5). It serialises the rows the view has
   * already rendered — S.session — so what a reviewer opens is what the screen
   * showed, and it registers no target: nothing is serialised when a token
   * refreshes. The lock is structural: there is no second data path to lock. */
  $('eExportBtn').addEventListener('click', function () {
    var md = PT.export.markdown(S.session, S.meta, S.usage);
    var blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'provetrack-' + ((S.meta && S.meta.job_id) || 'window') + '.md';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  });
  $('eQ').addEventListener('input', function () {
    S.q = this.value.trim(); renderTable(); renderLanes();
  });
  $('eQClr').addEventListener('click', function () {
    $('eQ').value = ''; S.q = ''; renderTable(); renderLanes(); $('eQ').focus();
  });

  /* ---------- Ripple (the effect grows where the cause is) ---------- */
  document.addEventListener('pointerdown', function (e) {
    var el = e.target.closest && e.target.closest('[data-e-ripple]');
    if (!el) return;
    var reduce = HAS.mq ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    var s = document.createElement('span');
    if (reduce.matches) { s.className = 'e-ripple-static'; }
    else {
      var r = el.getBoundingClientRect(), size = Math.max(r.width, r.height);
      s.className = 'e-ripple';
      s.style.width = s.style.height = size + 'px';
      s.style.left = (e.clientX - r.left) + 'px';
      s.style.top = (e.clientY - r.top) + 'px';
    }
    el.appendChild(s);
    s.addEventListener('animationend', function () { s.remove(); });
  });

  /* ---------- Consumption: the snapshot's nodes -> SESSION ---------- */
  function consume(nodes) {
    S.session = buildSession(nodes);
    S.usage = derivePeriodUsage(nodes);
    S.turnIds = [];
    S.turnIndex = {};
    S.session.forEach(function (e) {
      if (e.kind === 'turn') { S.turnIds.push(e.id); S.turnIndex[e.id] = S.turnIds.length - 1; }
    });
    S.turnIds.forEach(function (id) { S.openTurns[id] = true; });
    /* A re-render invalidates the selection; it does NOT clear the search box.
     * A target is re-pushed whenever its view reopens, and silently discarding
     * what the user typed would be the tape's business reaching into theirs. */
    S.sel = null;
    computeRepeats(S.session);
    renderTable(); renderLanes(); syncTurnBtn(); renderStats(); applyModality();
  }

  function onSnapshot(snap) {
    if (!snap || !snap.nodes) { return; }
    consume(snap.nodes);
  }

  /* The factory the shell registers. Registering does no work; the instance is
   * built on activation and dropped on deactivation, so a closed trajectory
   * costs nothing (ADR-0018 D5). */
  PT.target = function () { return { name: TARGET, onSnapshot: onSnapshot }; };

  /* ---------- Public interface (called by main.rs selectPeriod) ---------- */
  /* The hint and the trajectory it explains travel together.
   *
   * They are siblings in the markup, so every load/clear/error has to move both.
   * Measured before this: the hint carried TWO `style` attributes, the HTML
   * parser keeps the first and drops the second, so `display:none` was lost and
   * the empty state told the reader to "click any row" when there was no table
   * at all. Pairing them in one place is what makes that impossible to
   * reintroduce at only one of the three sites. */
  function showTrajectory(on) {
    var traj = $('eTraj'), hint = $('eHint');
    if (traj) traj.style.display = on ? '' : 'none';
    if (hint) hint.style.display = on ? '' : 'none';
  }

  window.__proveTrackClear = function () {
    stopReplay();
    if (S.sel) closeInsp();
    S.session = []; S.turnIds = []; S.turnIndex = {}; S.usage = null;
    S.q = ''; $('eQ').value = '';
    showTrajectory(false);
    $('eEmpty').style.display = '';
    $('eTbody').innerHTML = '';
    $('eStats').innerHTML = '';
    renderLanes();
  };
  /* Prepare the trajectory for a period. The data arrives through the tape —
   * the shell owns it — so this only clears state and states honestly that a
   * window is being fetched. Without the tape there is no trajectory to show,
   * and saying so beats showing an empty one. */
  window.__proveTrackLoad = function (jobId, meta) {
    stopReplay();
    if (S.sel) closeInsp();
    S.meta = meta || null;
    /* A new window is a new view: the filter and the selection from the last one
     * do not belong to it. */
    S.q = ''; $('eQ').value = ''; S.sel = null;
    if (!jobId) return;
    $('eEmpty').style.display = 'none';
    showTrajectory(true);
    $('eTbody').innerHTML = '<tr class="e-turn-hd"><td colspan="5" style="color:var(--e-dim)">Loading ' +
      esc(jobId) + '…</td></tr>';
  };

  /* ---------- The view's own lifecycle hook -------------------------------
   * The shell never names a view it does not own, so this view declares when it
   * wants to be driven. Registered on DOMContentLoaded because this asset loads
   * BEFORE the shell that provides Cx.onEnter.
   *
   * Opening the trajectory by itself has to produce a window too. "Independent
   * open" must not be a second, empty code path: the enter hook asks the shell
   * for the same read every other projection gets.
   */
  function shell() { return window.Cx && window.Cx.tape && window.Cx.loadWindow; }

  function onEnter() {
    if (!shell()) { return; }
    var Cx = window.Cx;
    var want = Cx.state.nav.period || null;
    var t = Cx.tape();
    /* 载体先亮出来，**在**下面那条"复用带子"的快分支之前。
     *
     * 以前只有"数据要新取"那条路才会点亮容器，于是只要带子上已经握着这一段
     * ——从对话视图载过一次、或第二次进本视图——就会走快分支直接 return：
     * 表格里 7 行都在，而 #eTraj 是 `display:none`、宽 0 高 0，**界面看上去
     * 什么都没有**。实测（真 Chrome，1440×813）：切到证轨视图时正是这个状态。
     *
     * 「数据在不在」与「载体亮不亮」是两件事。真正没东西可看时，下面的
     * catch 会走 showTrajectory(false) 并给出出路——那才是"没有"的表示法。 */
    showTrajectory(true);
    $('eEmpty').style.display = 'none';
    /* The window on the tape is reused when it is the one we were asked for;
     * otherwise a read is needed. An empty tape is never "reused" — that is how
     * an empty trajectory would look identical to a loaded one. */
    var holds = t.watermark() !== null && (want === null || Cx.tapeJob() === want);
    if (holds) { t.activate(TARGET); t.flush(); return; }
    window.__proveTrackLoad(want, window.__proveTrackMeta || null);
    Cx.loadWindow(want).then(function () {
      t.activate(TARGET);
      t.flush();
    }).catch(function (e) {
      showTrajectory(false);
      $('eEmpty').style.display = '';
      /* 就地给出路：重试 = 再走一次这个函数（它读的还是 nav.period）。 */
      window.CxWayout.renderInline($('eEmpty'), {
        code: 'trajectory-load-failed',
        detail: String(e && e.message || e),
        action: { run: function () { onEnter(); } }
      });
    });
  }

  function onLeave() {
    if (!shell() || !window.CxAssembly) { return; }
    /* Not active means not built (ADR-0018 D5): a closed trajectory costs
     * nothing, and cannot be a hidden element that quietly keeps rendering. */
    window.Cx.tape().deactivate(TARGET);
  }

  function bindLifecycle() {
    window.Cx.onEnter(TARGET, onEnter);
    window.Cx.onLeave(TARGET, onLeave);
    /* period 变化（在同一视图里点了另一段经历）也要重载窗口。以前靠"每次 setNav
     * 都重跑 enter hook"顺带做到，但那条路会让**列表**每点一次卡就重建一遍。
     * 两者分开之后，证轨在这里显式登记自己要跟着 period 走。 */
    if (window.Cx.onPeriod) { window.Cx.onPeriod(TARGET, onEnter); }
  }
  if (!window.CxAssembly) {
    /* Nothing to project from: leave the view in its honest empty state. */
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindLifecycle);
  } else {
    bindLifecycle();
  }

  PT.syncTurnBtn = syncTurnBtn;
})();
