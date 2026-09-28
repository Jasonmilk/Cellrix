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
  /* WHAT A HUMAN RECOGNISES (ADR-0048 §255). Measured on the live payload: every period's `name` is
   * null, so this fell back to "经历 <date> <time>" — and because a conversation's rounds share a
   * timestamp to the minute, EVERY card read the same. The distinguishing fact was already in the
   * payload and unused: `preview`, the user's own first words. So the order is now
   *   name → the user's first words → time (the last resort, which at least stays honest).
   * This is the same rule the sidebar grouping needed: two entries a reader cannot tell apart ARE a
   * duplicate as far as the reader is concerned. */
  function autoName(p) {
    if (p.name) return p.name;
    var said = (p.preview || '').replace(/\s+/g, ' ').trim();
    if (said) { return said.length > 24 ? said.slice(0, 24) + '…' : said; }
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

  /* ── 局部渲染：列表按 period_id 复用卡片，不整块重建 ────────────────────
   * 此前 renderOne 每次 `box.innerHTML = head` 再重造全部卡片 —— 数据一刷新
   * 整个侧栏重排，滚动位置/焦点/正在进行的改名全丢（setNav 注释里的旧 bug：
   * "每点一次卡就重建整个侧栏"）。卡片键 = period_id（行自带 data-job，本就是
   * 稳定身份）；头部是独立键，只在其 HTML（计数）变化时重建。教训同账本：
   * 键不含下标；"节点有没有被重建"与"它排在哪里"是两件事，两条都要断言。 */
  var SIDES = {}; // hostId -> { empty: bool, headHtml: str, rows: { key: {node, html} } }

  function renderSides(ids, periods, empty) {
    HOSTS = (ids || []).filter(function (id) { return !!document.getElementById(id); });
    LAST = { periods: periods, empty: empty };
    rerenderSides();
    /* P0-2d: the DAG tree mounts into its own container; the list above is untouched. */
    if (window.CxPanelTree && window.CxPanelTree.mountSidebar) {
      /* P0-2e: the tree's rows come from the EXISTING single-period path (`/api/events?job_id=`,
       * the same one the timeline uses) — no new endpoint, no second source of truth. */
      window.CxPanelTree.mountSidebar(periods, {
        fetchRows: function (id) {
          return fetch('/api/events?job_id=' + encodeURIComponent(id))
            .then(function (r) { return r.json(); })
            .then(function (j) { return (j && (j.events || j.rows)) || []; });
        },
        /* P0-2f: the rows render locally through the SAME readers the rest of the panel uses. */
        onRows: function (box, rows) { window.CxPanelTree.renderRows(box, rows); },
        /* Option A: a click on the tree is navigation, so it drives the main area through the
         * shell's ONE writer (`Cx.showView` -> `setNav`). The view name is declared here, not
         * invented: it is the id `base.html` gives that container. */
        /* The label rule lives HERE (autoName) and the tree asks for it — one host, not two. */
        /* A LABEL MUST DISTINGUISH (§238/§255/§266). Measured after the label fix: six entries all read
         * "只回答两个字:你好" because one job owned several roots with the same preview — readable, still
         * indistinguishable. So the label carries the facts that differ: the minute and whether that round
         * produced words. */
        labelFor: function (p) {
          var w = stamp(p.first_ts);
          var has = (typeof p.reply === 'string' && p.reply.trim() !== '');
          return autoName(p) + ' · ' + w.time + (w.secs ? ':' + w.secs : '')
            + (has ? ' · 有回复' : ' · 本轮无产出');
        },
        onSelect: function (id) {
          /* THE CLICK SEMANTICS ARE PART OF THE CONTRACT (ADR-0048 §264). Retiring the legacy cards kept
           * identity, drivability and the marker — and silently dropped what a click DOES: load that
           * period into the conversation, announce it, and focus the input. The tree's click had been
           * wired to "switch to the prove-track view", so after the retirement the owner could neither
           * read nor continue a conversation from the sidebar ("无用, 也无法对话"). A replacement must
           * inherit the BEHAVIOUR, not only the markup — the fourth part of the same contract. */
          var p = (periods || []).filter(function (x) { return x && x.period_id === id; })[0] || {};
          if (window.Cx && typeof window.Cx.setNav === 'function') {
            window.Cx.setNav({ period: id, meta: { job_id: p.job_id, period_id: id, name: p.name, preview: p.preview } });
          }
          try { if (typeof loadPeriodToChat === 'function') { loadPeriodToChat(id); } } catch (e) { /* never block the click */ }
          try {
            var nm = (typeof autoName === 'function') ? autoName(p) : id;
            setBanner('续接经历「' + esc(nm) + '」<span class="tid">' + esc(String(id).slice(-6)) + '</span> —— 下一句话延续这段对话');
          } catch (e) { /* banner is a courtesy, not the contract */ }
          try { var t = document.getElementById('chat-text'); if (t) { t.focus(); } } catch (e) { /* idem */ }
        },
        /* The prove-track view keeps its own affordance, so it no longer steals the primary click. */
        onProve: function (id) {
          if (window.Cx && typeof window.Cx.setNav === 'function') {
            window.Cx.setNav({ view: 'prove-track', period: id });
          }
        }
      });
    }
  }

  function rerenderSides() {
    if (!LAST) return;
    /* REVERTED (§243.3): standing this down removed the rows that CARRY THE SELECTION CONTRACT
     * (`data-job`, used to drive the prove-track view) — measured live as "sidebar rows available to
     * drive prove-track [0 rows]". The tree must inherit that contract BEFORE this path can retire. */
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

  /* 行结构恒定（铁轨）：标题 .nm + 时间 .t + 正文 .p，重命名只换标题文本 */
  function rowHtml(p, lineage) {
    /* `st` is this asset's module state object (st.sesSeq / st.histSeq) —
     * shadowing it here with a timestamp broke every later read in this
     * function. Measured: the sidebar rendered zero rows and the panel
     * reported "经历列表拉取失败". Name the local after what it is. */
    var when = stamp(p.first_ts);
    var disp = when.date + ' ' + when.time;
    var nm = autoName(p);
    /* EACH FACT ONCE (ADR-0048 §256). `autoName` now returns the user's own words, so the preview line
     * repeated the title verbatim — measured in the fixture: the same sentence appeared TWICE in one
     * card, which is the duplication the owner kept reporting. The preview line stays only when the
     * title is something else (a name the user gave the period). */
    var said = (p.preview || '').replace(/\s+/g, ' ').trim();
    var saidLabel = said.length > 24 ? said.slice(0, 24) + '…' : said;
    var preview = (p.preview && nm !== saidLabel)
      ? '<div class="p">' + esc(p.preview) + '</div>' : '';
    // 回答预览：period.reply（assistant/reply 交付物）——列表不再盲。
    /* THREE STATES, NOT TWO (§237): an EMPTY reply used to render nothing, so 18 of 52 cards were
     * wordless with no explanation. The state is named now, and it carries the model fact when the
     * model was not reported — which is exactly the shape the owner reported as an error. */
    var rs = (window.CxPanelTree && window.CxPanelTree.replyState)
      ? window.CxPanelTree.replyState(p.reply, p.model) : null;
    var reply = '';
    if (rs && rs.kind === 'present') {
      reply = '<div class="p rp">' + esc(p.reply) + '</div>';
    } else if (rs) {
      reply = '<div class="p rp" data-reply-state="' + rs.kind + '">' + esc(rs.label) + '</div>';
    }
    var mdl = p.model ? '<span class="mdl">' + esc(p.model) + '</span>' : '';
    /* No continuation marker: there is no continuation tier. */
    var tag = '';
    /* NAME THE FLATNESS (ADR-0048 §257). Measured: 50 of 61 periods have NO parent, so a conversation
     * of n rounds renders as n cards that differ only by time — and the reader calls that "duplicates".
     * The honest reading is that the LINEAGE WAS NOT RECORDED, which is a different fact from "this
     * conversation has only one round". It is shown per conversation (n >= 2 and nothing linked), with
     * its count, so the reader can tell the two apart. New periods DO carry lineage (§251/§252), so this
     * label disappears by itself as fresh experiences accumulate. */
    var flat = (lineage && lineage.n >= 2 && lineage.linked === 0)
      ? '<div class="p flat" data-flat="unlinked">未记录续接链 · ' + lineage.n + ' 轮平铺</div>' : '';
    return '<div class="nm">' + tag + esc(nm) + '</div>' +
      /* THE COUNT HAS THREE STATES TOO (§255): a missing count printed the literal `undefined 事件`
       * (seen in a fixture), which reads as a fact. Absent is `· 未计量`, the same discipline the
       * metering readers use — an absent number must never be rendered as a word. */
      '<div class="t">' + esc(disp) + ' · '
        + (p.count == null ? '未计量' : p.count + ' 事件')
        /* THE ID IS A SUFFIX, NOT A HEADLINE (§256): twelve characters of a period id led the line and
         * made every card look alike; six trailing characters still separate two periods of one job. */
        + ' · <span class="tid">' + esc(p.period_id.slice(-6)) + '</span>' + mdl +
      '<span class="act"><button type="button" class="btn-icon sm" data-ren="' + esc(p.period_id) + '" title="重命名">✎</button></span></div>' +
      preview + reply + flat;
  }

  function bindRow(div, p) {
    div.onclick = function () {
      /* 一种语义（N-001）：把这段载进对话。证轨侧板若开着，它跟着 period 走——
       * 那是 shell 的 period 通知在做的事，不是这里的分支。 */
      Cx.setNav({ period: p.period_id, meta: { job_id: p.job_id, period_id: p.period_id, name: p.name, preview: p.preview } });
      moveSelection();          /* 就地搬选中态：列表不动，位置不丢 */
      loadPeriodToChat(p.period_id);
      setBanner('续接经历「' + esc(autoName(p)) + '」<span class="tid">' + esc(p.period_id.slice(-6)) + '</span> —— 下一句话延续这段对话');
      document.getElementById('chat-text').focus();
    };
    var rn = div.querySelector('[data-ren]');
    if (rn) rn.onclick = function (ev) {
      ev.stopPropagation();
      beginRename(div, p.period_id, p.name || '');
    };
  }

  function renderOne(id, periods, empty) {
    var box = document.getElementById(id);
    var cache = SIDES[id] || (SIDES[id] = { empty: false, headHtml: null, rows: {} });
    /* `empty` is an exit-layer STATE, not an HTML string: the sentence and the
     * action come from one place (ADR-0044). It used to be markup assembled at
     * the call site, which is how the same zero state came to have two
     * derivations (here and chat.html's static markup). 只在该状态**变化**时渲染
     * 一次：轮询不重建一个没变的空态。 */
    if (!periods.length) {
      if (cache.empty) return;
      cache.empty = true;
      cache.headHtml = null; cache.rows = {};
      window.CxWayout.render(box, empty);
      return;
    }
    if (cache.empty) {
      cache.empty = false;
      cache.headHtml = null; cache.rows = {};
      box.innerHTML = '';
    }
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
    /* 头部：计数变化才重建（按钮随之重绑），同数据轮询不碰 DOM */
    var rootCount = periods.length;
    /* Derived, never typed: how many conversations have several rounds and NO recorded lineage. This is
     * the aggregate form of the per-card label below, and it answers "why are there so many cards". */
    var linByJob = {};
    periods.forEach(function (pp) {
      var k = pp.job_id || pp.period_id;
      if (!linByJob[k]) { linByJob[k] = { n: 0, linked: 0 }; }
      linByJob[k].n++;
      if (pp.parent) { linByJob[k].linked++; }
    });
    var flatJobs = Object.keys(linByJob).filter(function (k) {
      return linByJob[k].n >= 2 && linByJob[k].linked === 0;
    }).length;
    var headHtml = '<div class="ses-head"><span>' + rootCount + ' 条记录 · 最新在前'
      + (flatJobs ? ' · ' + flatJobs + ' 段未记录续接链' : '') + '</span>' +
      '<button type="button" class="btn btn-sm btn-ghost">+ 新对话</button>' +
      '</div>';
    if (cache.headHtml !== headHtml) {
      cache.headHtml = headHtml;
      box.innerHTML = headHtml;
      var nb = box.querySelector('.ses-head button');
      if (nb) nb.onclick = function (ev) { ev.stopPropagation(); newChat(); };
    }
    /* 列表：按 period_id 复用卡片，不整块重建（键不含下标；新行落位末尾） */
    var want = {};
    periods.forEach(function (p) { want[p.period_id] = true; });
    Object.keys(cache.rows).forEach(function (k) {
      if (want[k]) return;
      var row = cache.rows[k];
      if (row.node && row.node.parentNode) row.node.parentNode.removeChild(row.node);
      delete cache.rows[k];
    });
    periods.forEach(function (p) {
      var k = p.period_id;
      var html = rowHtml(p, linByJob[p.job_id || p.period_id]);
      var row = cache.rows[k];
      if (row) {
        /* 键在 ⇒ 复用节点：HTML 变了才重写 + 重绑，否则只移动到位 */
        if (row.html !== html) { row.node.innerHTML = html; row.html = html; bindRow(row.node, p); }
        box.appendChild(row.node);
        return;
      }
      var div = document.createElement('div');
      /* N-004（钻石）：当前 period 在两个容器里都要可见地标示。旧式写法在证轨模式下恒假。 */
      div.className = 'ses-item';
      div.setAttribute('data-ts', p.first_ts || '');
      /* 行要自带身份，选中态才搬得动——否则只能重建整个列表来换高亮。 */
      div.setAttribute('data-job', p.period_id);
      div.innerHTML = html;
      bindRow(div, p);
      cache.rows[k] = { node: div, html: html };
      box.appendChild(div);
    });
    moveSelection();   /* 选中态就地搬：列表不动，位置不丢 */
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
          //
          // **三态，不是两态**：此前写作 `c.passed === false ? 'FAIL' : 'PASS'`
          // ⇒ 字段**缺席**时落到 `PASS`。那是"没测量"被渲染成"通过"，
          // 与 K-088（未知码渲绿）同形，只是搬到证轨这一侧。
          // `passed` 为真 ⇒ PASS；为假 ⇒ FAIL；**缺席 ⇒ 未测**。
          var c = e.data || {};
          var pass = c.passed === true ? 'PASS' : (c.passed === false ? 'FAIL' : '未测');
          var tag = '检查 · ' + (c.check || '?') + ' · ' + pass;
          var rowCls = c.passed === true ? 'chk-pass' : (c.passed === false ? 'chk-fail' : 'chk-unknown');
          Cx.foldRow(tag, (c.reason || '') + (c.actual ? '\nactual=' + c.actual : ''), rowCls);
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
        /* The label leads and the id is a SUFFIX OF A FEW CHARACTERS: a 20-character id as the visible
         * text made every option look like every other one (§255). */
        return '<div class="resume-opt" data-job="' + esc(p.period_id) + '">' + esc(autoName(p))
          + ' <span class="dim">' + esc(p.period_id.slice(-6)) + '</span></div>';
      }).join('') || '<div class="empty">尚无经历</div>';
      list.style.display = '';
      list.querySelectorAll('.resume-opt').forEach(function (el) {
        el.onclick = function () {
          var job = el.getAttribute('data-job');
          list.style.display = 'none';
          Cx.setNav({ period: job });
          setBanner('续接经历<span class="tid">' + esc(String(job).slice(-6)) + '</span> —— 下一句话延续这段对话');
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
