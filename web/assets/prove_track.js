/* ============================================================
  Cellrix 证轨控制层（ADR-0016 D1/D3）— 入口
  事件绑定 / 涟漪反馈 / 对外接口 __proveTrackLoad|Clear
  加载序硬约束：本文件必须晚于 data / view，且早于 script.html（D3）。
  对外接口名保持不变，script.html 与 main.rs 调用点零改动。
  ============================================================ */
(function () {
  'use strict';
  var PT = window.CxProveTrack || {};
  var $ = PT.$, esc = PT.esc, S = PT.S, HAS = PT.HAS,
      buildSession = PT.buildSession, computeRepeats = PT.computeRepeats,
      renderStats = PT.renderStats, renderTable = PT.renderTable, renderLanes = PT.renderLanes,
      openInsp = PT.openInsp, closeInsp = PT.closeInsp, isModal = PT.isModal,
      applyModality = PT.applyModality, stopReplay = PT.stopReplay, startReplay = PT.startReplay;

  /* ---------- 事件绑定 ---------- */
  document.addEventListener('click', function (e) {
    var blk = e.target.closest && e.target.closest('.e-blk[data-e-ev]');
    var row = e.target.closest && e.target.closest('tr.ev[data-e-ev]');
    var tg = e.target.closest && e.target.closest('[data-e-turntoggle]');
    if (blk) { openInsp(blk.dataset.ev); return; }
    if (row) {
      // REPLY = the deliverable: click toggles the full answer inline
      // (DSH: the answer is the body, detail is one tap away). Other rows
      // open the inspector as before.
      if (row.classList.contains('e-reply')) {
        row.classList.toggle('open');
        if (row.classList.contains('open')) row.scrollIntoView({ block: 'nearest' });
        return;
      }
      openInsp(row.dataset.ev); return;
    }
    if (tg) {
      var id = tg.dataset.turntoggle;
      S.openTurns[id] = !S.openTurns[id];
      renderTable(); syncTurnBtn();
    }
  });
  document.addEventListener('keydown', function (e) {
    if (document.getElementById('view-prove-track').style.display === 'none') return;
    var blk = e.target.closest && e.target.closest('.e-blk[data-e-ev]');
    var row = e.target.closest && e.target.closest('tr.ev[data-e-ev]');
    if ((blk || row) && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault(); openInsp((blk || row).dataset.ev); return;
    }
    if (e.key === 'Escape' && S.sel) closeInsp();
  });

  function syncTurnBtn() {
    var allOpen = S.turnIds.every(function (id) { return S.openTurns[id]; });
    $('eTurnBtn').setAttribute('aria-pressed', String(allOpen));
    $('eTurnBtn').textContent = allOpen ? '全部折叠轮次' : '全部展开轮次';
  }
  $('eInspX').addEventListener('click', closeInsp);
  $('eScrim').addEventListener('click', function () { if (isModal()) closeInsp(); });
  $('eDurBtn').addEventListener('click', function () {
    S.durMode = S.durMode === 'equal' ? 'actual' : 'equal';
    $('eDurLbl').textContent = S.durMode === 'actual' ? '实际耗时' : '等宽';
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
    this.textContent = S.callsOpen ? '全部展开调用' : '全部折叠调用';
    renderTable();
  });
  $('eReplayBtn').addEventListener('click', function () {
    (S.replayIdx >= 0 || S.replayTimer) ? stopReplay() : startReplay();
  });
  $('eQ').addEventListener('input', function () {
    S.q = this.value.trim(); renderTable(); renderLanes();
  });
  $('eQClr').addEventListener('click', function () {
    $('eQ').value = ''; S.q = ''; renderTable(); renderLanes(); $('eQ').focus();
  });

  /* ---------- 涟漪（果从因的位置长出） ---------- */
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

  /* ---------- 对外接口（main.rs selectPeriod 调用） ---------- */
  window.__proveTrackClear = function () {
    stopReplay();
    if (S.sel) closeInsp();
    S.session = []; S.turnIds = []; S.turnIndex = {};
    S.q = ''; $('eQ').value = '';
    $('eTraj').style.display = 'none';
    $('eEmpty').style.display = '';
    $('eTbody').innerHTML = '';
    $('eStats').innerHTML = '';
    renderLanes();
  };
  window.__proveTrackLoad = function (jobId, meta) {
    stopReplay();
    if (S.sel) closeInsp();
    S.meta = meta || null;
    $('eEmpty').style.display = 'none';
    $('eTraj').style.display = '';
    $('eTbody').innerHTML = '<tr class="e-turn-hd"><td colspan="5" style="color:var(--e-dim)">加载 ' + esc(jobId) + '…</td></tr>';
    fetch('/api/events?job_id=' + encodeURIComponent(jobId)).then(function (r) { return r.json(); }).then(function (j) {
      if (j.missing || !j.events || !j.events.length) {
        $('eTraj').style.display = 'none';
        $('eEmpty').style.display = '';
        $('eEmpty').textContent = '该轮无事件流（' + jobId + '）——见底部 audit JSON 链';
        return;
      }
      S.session = buildSession(j.events, meta);
      S.turnIds = [];
      S.session.forEach(function (e) { if (e.kind === 'turn') { S.turnIds.push(e.id); S.turnIndex[e.id] = e.index; } });
      S.turnIds.forEach(function (id) { S.openTurns[id] = true; });
      S.sel = null; S.q = ''; $('eQ').value = '';
      computeRepeats(S.session);
      renderTable(); renderLanes(); syncTurnBtn(); renderStats(); applyModality();
    }).catch(function (e) {
      $('eTraj').style.display = 'none';
      $('eEmpty').style.display = '';
      $('eEmpty').textContent = '加载失败: ' + e.message;
    });
  };

  PT.syncTurnBtn = syncTurnBtn;
})();
