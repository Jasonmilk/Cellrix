/* 经历列表与「由列表可达的动作」（ADR-0044 P1b 的解耦）。
 *
 * 从 session.html 搬出来的：列表行渲染本身，以及只有从列表才够得着的动作
 * （改名、把一段经历载进对话、新对话、续接下拉）。留下的 session.html 只做
 * 取数与空态决策，并注册两个视图的 enter hook。
 *
 * 为什么按这个缝切：`renderSide` 向外调四件事（setBanner / newChat /
 * loadPeriodToChat / beginRename），而 `stamp`/`autoName` 又被内外双方调用。
 * 只搬 renderSide 会让两个资产**互相依赖**——那比不拆更糟。按职责切则是单向的：
 * session.html → session_list.js，反向没有调用。两边都通过 Cx.state 与
 * Cx.setNav 说话，那是共享状态，不是资产依赖。
 */
(function () {
  'use strict';
  var Cx = window.Cx || {};
  var st = Cx.state || {};

  function nav() { return (window.Cx && window.Cx.state && window.Cx.state.nav) || {}; }
  function esc(s) { return Cx.esc ? Cx.esc(s) : String(s); }

  function stamp(iso) {
    var s = String(iso || '');
    var d = new Date(s);
    if (!s || isNaN(d.getTime())) {
      return { date: s.slice(5, 10), time: s.slice(11, 16), secs: s.slice(17, 19) };
    }
    var two = function (n) { return (n < 10 ? '0' : '') + n; };
    return {
      date: two(d.getMonth() + 1) + '-' + two(d.getDate()),
      time: two(d.getHours()) + ':' + two(d.getMinutes()),
      secs: two(d.getSeconds())
    };
  }

  /* The auto name must be UNIQUE, or two different experiences read as one card
   * repeated. It used to stop at the minute, and measured on the live store that
   * collided for 58 of 141 periods — the worst single minute held four unrelated
   * conversations — which is exactly how "this card appears more than once" was
   * reported. Seconds are the cheapest discriminator that stays human-readable;
   * the job-id fragment stays in the row for the case where even a second
   * collides (rapid scripted writes). */
  function autoName(p) {
    if (p.name) return p.name;
    var when = stamp(p.first_ts);
    return '经历 ' + when.date + ' ' + when.time + (when.secs ? ':' + when.secs : '');
  }

  /* ── 经历列表：一份组件、一个宿主、**一种点击语义**（ADR-0022 N-001 / N-015）──
   *
   * 它经历过三态，值得记下来：
   *   1. `chatMode` 参数让同一次点击在两个容器里**行为不同**，而证轨那侧的选中高亮
   *      因此恒为 false —— 直接违反 N-004（钻石：当前 period 必须可见地标示）；
   *   2. 改成侧栏顶部的「对话 | 证轨」显式模式开关（P3a），两个容器行为一致了；
   *   3. **N-001 之后模式开关本身多余**：辅助面成了右栏侧板、由它自己的开关打开，
   *      于是"点一张卡"只剩一个答案 —— 把这段载进对话。留着开关就是同一件事的
   *      第二个入口（N-015 不允许）。所以它退场了。
   *
   * 现在点卡永远：写 period → 载进对话；而证轨侧板若开着，它会跟着 period 走
   * （证轨在 shell 的 onPeriod 上登记了自己）。 */
  var HOSTS = [], LAST = null;

  function renderSides(ids, periods, empty) {
    HOSTS = (ids || []).filter(function (id) { return !!document.getElementById(id); });
    LAST = { periods: periods, empty: empty };
    rerenderSides();
  }

  function rerenderSides() {
    if (!LAST) return;
    HOSTS.forEach(function (id) {
      if (document.getElementById(id)) renderOne(id, LAST.periods, LAST.empty);
    });
  }

  /* 只搬选中态，**不重建列表**。
   *
   * 实测：点一张卡会打两次 /api/sessions、把侧栏 innerHTML 整个换掉——真实浏览器里
   * 列表因此滚回顶部，刚点的那张被甩出视野（"不知道点了哪张卡了"）。**选择变化不该
   * 重建你正在选择的那个集合**：任何有列表的界面都是这条形状。
   *
   * 同时留一条非颜色通道（aria-current）：选中目前只体现为颜色，而 N-019 要求状态
   * 变化不靠颜色也能辨。 */
  function moveSelection() {
    var want = nav().period || null;
    HOSTS.forEach(function (id) {
      var box = document.getElementById(id);
      if (!box) return;
      var all = box.getElementsByTagName('div');
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (!el.getAttribute) continue;
        var job = el.getAttribute('data-job');
        if (!job) continue;
        var on = (job === want);
        var has = el.className.split(' ').indexOf('sel') >= 0;
        if (on === has) continue;
        el.className = on ? (el.className + ' sel') : el.className.replace(/\s*sel\b/, '');
        if (on) { el.setAttribute('aria-current', 'true'); } else { el.removeAttribute('aria-current'); }
      }
    });
  }

  function renderOne(id, periods, empty) {
    var box = document.getElementById(id);
    /* `empty` is an exit-layer STATE, not an HTML string: the sentence and the
     * action come from one place (ADR-0044). It used to be markup assembled at
     * the call site, which is how the same zero state came to have two
     * derivations (here and chat.html's static markup). */
    if (!periods.length) { window.CxWayout.render(box, empty); return; }
    /* HISTORY, REVISED 2026-09-17. A previous revision removed grouping and
     * concluded "The model was wrong, not the code." That diagnosis was WRONG,
     * and it is recorded here rather than silently deleted.
     *
     * Grouping had failed because its INPUT was corrupt: 83 of 139 periods had
     * no usable parent — 71 empty plus 12 carrying prose or an arbitrary caller
     * string, because the writer fell back to the human-readable continuation
     * summary when no job id was supplied (anaphase `run_cycle.rs`). The writer
     * is fixed and the reader now refuses anything that is not a period id
     * (`session_events.rs::is_period_id`), so lineage is trustworthy for NEW
     * periods while the old rows stay as written (append-only).
     *
     * Therefore grouping by lineage is still the intended model, deferred only
     * until trustworthy data accumulates again — not rejected. It is NOT what
     * failed before: a TREE render did ("a second half of the tree never
     * reached the DOM"), whereas the intended unit is a THREAD (root -> leaf
     * path), which cannot have a second half by construction.
     *
     * Kept flat for now, newest first (the order the API returns): a period is
     * one card, and clicking it continues from there. The next step turns cards
     * into threads, reusing the existing `chainJobIds` traversal. */
    /* Flat, newest first — no grouping, no traversal yet. */
    var chain = periods.slice();
    var rootCount = periods.length;
    var head = '<div class="ses-head"><span>' + rootCount + ' 条记录 · 最新在前</span>' +
      '<button type="button" class="btn btn-sm btn-ghost">+ 新对话</button>' +
      '</div>';
    box.innerHTML = head;
    var nb = box.querySelector('.ses-head button');
    if (nb) nb.onclick = function (ev) { ev.stopPropagation(); newChat(); };
    chain.forEach(function (p) {
      var div = document.createElement('div');
      /* N-004（钻石）：当前 period 在两个容器里都要可见地标示。旧式写法在证轨模式下恒假。 */
      var sel = nav().period === p.job_id;
      div.className = 'ses-item' + (sel ? ' sel' : '');
      div.setAttribute('data-ts', p.first_ts || '');
      /* 行要自带身份，选中态才搬得动——否则只能重建整个列表来换高亮。 */
      div.setAttribute('data-job', p.job_id);
      if (sel) div.setAttribute('aria-current', 'true');
      /* `st` is this asset's module state object (st.sesSeq / st.histSeq) —
       * shadowing it here with a timestamp broke every later read in this
       * function. Measured: the sidebar rendered zero rows and the panel
       * reported "经历列表拉取失败". Name the local after what it is. */
      var when = stamp(p.first_ts);
      var disp = when.date + ' ' + when.time;
      // 行结构恒定（铁轨）：标题 .nm + 时间 .t + 正文 .p，重命名只换标题文本
      var nm = autoName(p);
      var preview = p.preview ? '<div class="p">' + esc(p.preview) + '</div>' : '';
      // 回答预览：period.reply（assistant/reply 交付物）——列表不再盲。
      var reply = p.reply ? '<div class="p rp">' + esc(p.reply) + '</div>' : '';
      var mdl = p.model ? '<span class="mdl">' + esc(p.model) + '</span>' : '';
      /* No continuation marker: there is no continuation tier. */
      var tag = '';
      div.innerHTML =
        '<div class="nm">' + tag + esc(nm) + '</div>' +
        '<div class="t">' + esc(disp) + ' · ' + p.count + ' 事件 · <span class="tid">' + esc(p.job_id.slice(0, 12)) + '</span>' + mdl +
        '<span class="act"><button type="button" class="btn-icon sm" data-ren="' + esc(p.job_id) + '" title="重命名">✎</button></span></div>' +
        preview + reply;
      div.onclick = function () {
        /* 一种语义（N-001）：把这段载进对话。证轨侧板若开着，它跟着 period 走——
         * 那是 shell 的 period 通知在做的事，不是这里的分支。 */
        Cx.setNav({ period: p.job_id, meta: { job_id: p.job_id, name: p.name, preview: p.preview } });
        moveSelection();          /* 就地搬选中态：列表不动，位置不丢 */
        loadPeriodToChat(p.job_id);
        setBanner('续接经历 <span class="tid">' + esc(p.job_id) + '</span> —— 下一句话延续这段对话');
        document.getElementById('chat-text').focus();
      };
      var rn = div.querySelector('[data-ren]');
      if (rn) rn.onclick = function (ev) {
        ev.stopPropagation();
        beginRename(div, p.job_id, p.name || '');
      };
      box.appendChild(div);
    });
  }

  // Inline rename — 零跳变（水之波光：行结构铁轨，编辑只换标题文本）：
  // 输入框 1:1 占据 .nm（同盒模型），✓/✗ 替换行尾 ✎（同尺寸），
  // 保存成功就地更新文本（不 loadSessions，无骨架闪烁/重排）；
  // 失败恢复原文 + toast，不跳转（触境：因果完成，反馈稳定可预期）。
  function beginRename(item, jobId, current) {
    if (item.querySelector('.ses-edit')) return;
    var nm = item.querySelector('.nm');
    var t = item.querySelector('.t');
    var act = t && t.querySelector('.act');
    var original = nm ? nm.textContent : '';
    var edit = document.createElement('div');
    edit.className = 'ses-edit';
    edit.innerHTML = '<input class="inp" value="' + esc(current) + '" placeholder="自动名：经历 + 时间" maxlength="80">';
    if (nm) { nm.textContent = ''; nm.appendChild(edit); }
    item.classList.add('editing');
    var ren = act && act.querySelector('[data-ren]');
    if (ren) ren.style.display = 'none';
    var save = null, cancel = null;
    if (act) {
      save = document.createElement('button');
      save.type = 'button'; save.className = 'btn-icon sm'; save.title = '保存'; save.textContent = '✓';
      cancel = document.createElement('button');
      cancel.type = 'button'; cancel.className = 'btn-icon sm'; cancel.title = '取消'; cancel.textContent = '✗';
      act.appendChild(save);
      act.appendChild(cancel);
    }
    var inp = edit.querySelector('.inp');
    inp.focus(); inp.select();
    function done(restore) {
      if (nm) nm.textContent = restore !== undefined ? restore : original;
      edit.remove();
      if (ren) ren.style.display = '';
      if (save) save.remove();
      if (cancel) cancel.remove();
      item.classList.remove('editing');
    }
    cancel.onclick = function (ev) { ev.stopPropagation(); done(); };
    /* 失败**不收起编辑态**：原先失败即 done()（恢复原名、撤掉输入框），于是人刚
     * 输入的名字连同重试的机会一起没了，只剩一个 5 秒的 toast。现在保留输入，并在
     * 编辑行里就地把出路摆出来（ADR-0044 D5）。 */
    function renameFailed(err) {
      var host = edit.querySelector('.wo-fail');
      if (!host) {
        host = document.createElement('div');
        host.className = 'wo-fail';
        edit.appendChild(host);
      }
      window.CxWayout.render(host, {
        code: 'rename-failed',
        detail: String(err && err.message || err || 'unknown'),
        action: { run: function () { if (save) { save.disabled = false; save.click(); } } }
      });
    }
    save.onclick = function (ev) {
      ev.stopPropagation();
      var name = inp.value.trim();
      var btn = save;
      if (btn) btn.disabled = true;
      fetch('/api/sessions/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, name: name })
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (j.ok) {
          done(name || autoName({ first_ts: String(item.getAttribute('data-ts') || '') }));
          Cx.showToast(name ? '已重命名' : '已恢复自动名');   /* 成功是瞬时通知，toast 正合适 */
        } else {
          if (btn) btn.disabled = false;
          renameFailed({ message: j.error || 'unknown' });
        }
      }).catch(function (e) {
        if (btn) btn.disabled = false;
        renameFailed(e);
      });
    };
    inp.onkeydown = function (ev) {
      if (ev.key === 'Enter') { ev.stopPropagation(); if (save) save.click(); }
      if (ev.key === 'Escape') { ev.stopPropagation(); if (cancel) cancel.click(); }
    };
  }

  // Load a past experience's history into the chat space (explicit resume):
  // user turns and answers render as messages, then the next sentence
  // continues the period (resume_from on the backend). seq-guarded: a slow
  // earlier fetch must not overwrite a session the user switched to.
  function loadPeriodToChat(jobId) {
    var seq = ++st.histSeq;
    var box = document.getElementById('chat-msgs');
    box.innerHTML = '<div class="period-head">—— 正在加载 ' + esc(jobId.slice(0, 12)) + ' 的历史 ——</div>';
    /* ONE read, two projections (ADR-0018 T4). The shell merges the chain
     * through the assembly and hands ONE window to the tape; this view renders
     * the events off that window, and the trajectory reads the same window as
     * nodes. Building the window here as well — and handing it on — is what
     * made the shell a second place that decided what a session was.
     *
     * L0 (temporary, retired when anaphase provides session_id) lives with the
     * read, in script.html's loadWindow.
     */
    Cx.loadWindow(jobId).then(function (win) {
      if (seq !== st.histSeq) return;
      var events = win.events;
      if (!events.length) {
        /* 事件全被拒收不是「暂无数据」：是数据来了、一条都没被认出来。出路是
         * 让人自己去看原始事件，而不是猜。 */
        window.CxWayout.render(box, {
          code: 'events-all-rejected',
          action: { run: function () {
            if (window.open) { window.open('/api/events?job_id=' + encodeURIComponent(jobId), '_blank'); }
          } }
        });
        return;
      }

      box.innerHTML = '';
      var pendingTool = null;
      var sawReply = false; // assistant/reply is the deliverable; turn/end
                            // only backfills periods written before it existed
      var d = document.createElement('div');
      d.className = 'period-head';
      d.textContent = '—— 经历 ' + jobId + ' 的历史 ——'
        + (win.jobs.length > 1 ? '（含 ' + win.jobs.length + ' 段）' : '');
      box.appendChild(d);
      events.forEach(function (e) {
        if (e.type === 'user/message') { Cx.addMsg('user', e.data.text || '', false); }
        else if (e.type === 'assistant/think') { Cx.foldRow('思考', e.data.text || ''); }
        else if (e.type === 'assistant/attempt') {
          // DSH-style timeline: the plan row shows the READABLE plan
          // ("调用 weather · city=New York"), never the raw JSON — the raw
          // payload stays in the expanded state.
          var p = Cx.parsePlan(e.data.text || '');
          Cx.foldRow('计划', p.raw ? p.label + '\n' + p.raw : p.label);
        }
        else if (e.type === 'tool/call') {
          // tool/call + tool/result pair into ONE fold row (no duplicate
          // helix messages): buffer the call, render on the matching result.
          pendingTool = { tool: e.data.tool || '', args: e.data.args || '' };
        }
        else if (e.type === 'tool/result') {
          var t = pendingTool || { tool: e.data.tool || '', args: '' };
          pendingTool = null;
          var label = '工具 · ' + t.tool + (e.data.ok === false ? ' · 失败' : '');
          var text = (t.args ? '调用 ' + JSON.stringify(t.args) + '\n' : '') + (e.data.outcome || '');
          Cx.foldRow(label, text);
        }
        else if (e.type === 'check/status') {
          // One timeline row per criterion: label carries the verdict so the
          // flow reads "exec_ok PASS" / "answer.delivered PASS" at a glance;
          // the reason opens on click.
          var c = e.data || {};
          var tag = '检查 · ' + (c.check || '?') + ' · ' + (c.passed === false ? 'FAIL' : 'PASS');
          Cx.foldRow(tag, (c.reason || '') + (c.actual ? '\nactual=' + c.actual : ''), c.passed === false ? 'chk-fail' : 'chk-pass');
        }
        else if (e.type === 'verdict/status') {
          var v = e.data || {};
          Cx.foldRow('结论 · ' + (v.status || '?'), v.reason || '');
        }
        else if (e.type === 'assistant/reply') { sawReply = true; Cx.addReplyMsg(e.data.text || '', e.data.model || ''); }
        else if (e.type === 'assistant/usage') {
          // Metering, not conversation. Token counts belong to the prove-track
          // status bar, never to a message row (ADR-0026 D4). Named explicitly
          // so a reader can tell "deliberately not rendered" from "forgotten" —
          // this type only started reaching the sidebar on 2026-09-15, when the
          // vocabulary stopped rejecting it.
        }
        else if (e.type === 'turn/end') {
          // Legacy fallback only: periods written before assistant/reply
          // carried the answer on turn/end alone. Never duplicate.
          if (!sawReply && e.data && e.data.reply) Cx.addReplyMsg(e.data.reply, e.data.model || '');
        }
      });
      box.scrollTop = box.scrollHeight;
      /* The trajectory is another projection of this same tape: it is told
       * WHICH period was chosen, not handed the events. Passing the stream
       * along as well is the second way in that let the two drift apart. */
      if (Cx.selectPeriod) { Cx.selectPeriod(jobId); }
    }).catch(function (e) {
      if (seq !== st.histSeq) return;
      /* 就地给出路：重试就是把这一段再载一次。 */
      window.CxWayout.render(box, {
        code: 'history-fetch-failed',
        detail: String(e && e.message || e),
        action: { run: function () { loadPeriodToChat(jobId); } }
      });
    });
  }

  // Fresh conversation: drop the resume anchor, clear the space, restore
  // the honest empty state. The next message opens a NEW period.
  function newChat() {
    Cx.setNav({ period: null });
    st.histSeq++; // 丢弃任何在途的历史加载
    var box = document.getElementById('chat-msgs');
    box.innerHTML = '<div class="empty"><div class="orb" aria-hidden="true">⌁</div><b>尚未开始的对话</b><p>说句话吧——这是给 Helix 的一段新经历。</p></div>';
    setBanner(null);
    document.getElementById('chat-text').focus();
  }

  function setBanner(html) {
    var b = document.getElementById('cont-banner');
    if (!b) return;
    if (html === null) { b.style.display = 'none'; b.innerHTML = ''; return; }
    b.style.display = '';
    b.innerHTML = html +
      '<button type="button" class="btn-icon sm" data-drop title="结束续接（开始新对话）">✗</button>';
    var drop = b.querySelector('[data-drop]');
    if (drop) drop.onclick = function () { newChat(); };
  }

  // Resume-from-experience dropdown: sits in the chat-input's bottom-right,
  // listing the latest periods to continue (explicit, never implicit).
  function toggleResume() {
    var list = document.getElementById('resume-list');
    if (list.style.display !== 'none') { list.style.display = 'none'; return; }
    fetch('/api/sessions').then(function (r) { return r.json(); }).then(function (j) {
      var periods = (j.periods || []).slice(0, 8);
      list.innerHTML = periods.map(function (p) {
        return '<div class="resume-opt" data-job="' + esc(p.job_id) + '">' + esc(autoName(p)) + ' <span class="dim">' + esc(p.job_id.slice(0, 20)) + '</span></div>';
      }).join('') || '<div class="empty">尚无经历</div>';
      list.style.display = '';
      list.querySelectorAll('.resume-opt').forEach(function (el) {
        el.onclick = function () {
          var job = el.getAttribute('data-job');
          list.style.display = 'none';
          Cx.setNav({ period: job });
          setBanner('续接经历 <span class="tid">' + esc(job) + '</span> —— 下一句话延续这段对话');
          loadPeriodToChat(job);
          document.getElementById('chat-text').focus();
        };
      });
    }).catch(function (e) {
      /* 就地给出路：重试 = 收起再展开这个下拉，它自己会重新取一次。 */
      list.style.display = '';
      window.CxWayout.render(list, {
        code: 'sessions-fetch-failed',
        detail: String(e && e.message || e),
        action: { run: function () { list.style.display = 'none'; toggleResume(); } }
      });
    });
  }

  window.CxSessionList = {
    esc: esc,
    renderSides: renderSides,
    moveSelection: moveSelection,
    toggleResume: toggleResume,
    newChat: newChat
  };
})();
