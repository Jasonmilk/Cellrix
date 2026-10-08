/* panel_tree — DAG NAVIGATION, ON DEMAND (ADR-0048 §227).
 *
 * The goal it serves: the panel must let a reader SEE the experience DAG, click a node, and read
 * that node's facts locally — instead of a monolithic dashboard (the lane/grid shape this cell
 * started with). The reference trajectory UI is the model; what we add is the proof-track's facts:
 * three-state metering, per-step model/token, walk's four end states, and DECLARED ABSENCE.
 *
 * Three rules this module is built on, all of them earned in this cell:
 *   ① ORDERING IS STRUCTURAL, NOT TEMPORAL — the tree is built from `parent`, never from timestamps;
 *   ② ONE FACT, ONE HOST — the edges ARE the non-null parents (a criterion asserts the equality);
 *   ③ ABSENCE MUST BE DECLARED — an unknown/absent run mode is a NAMED state, never an empty string.
 */
(function (root) {
  'use strict';

  /* ── the three run modes, as the runtime declares them (config.rs `pub enum Mode`) ──
   * ① Drive   — Anaphase only: Mind ABSENT (harness style, no experience written)
   * ② Partner — memory-bearing partner (default; requires Helix-Mind)
   * ③ Survive — Mind autonomous; **the enum is reserved**: declared, not implemented
   * Unknown or absent ⇒ NAMED as undeclared (§215/§216 discipline: absence is not a blank). */
  /* THE KEYS ARE THE WIRE VALUES, NOT THE ENUM NAMES (ADR-0048 §340). Measured before this change: the
   * payload vocabulary (`driving`/`partner`/`survival`, `config::mode_wire`) and these keys (`Drive`/…)
   * were different, so a declared mode read as "undeclared" — a field that claims to be declared while the
   * reader cannot find it. The labels stay human; the KEYS are the protocol. */
  var MODES = {
    driving: { label: 'Anaphase Only（harness）', mind: 'absent', writesExperience: false, implemented: true },
    partner: { label: '伙伴（带记忆）', mind: 'required', writesExperience: true, implemented: true },
    survival: { label: '生存（Mind 自治）', mind: 'required', writesExperience: true, implemented: false }
  };

  function modeFacts(mode) {
    if (mode && Object.prototype.hasOwnProperty.call(MODES, mode)) {
      var m = MODES[mode];
      return { kind: 'declared', value: mode, label: m.label, mind: m.mind,
        writesExperience: m.writesExperience, implemented: m.implemented,
        note: m.implemented ? null : '已声明、未实现（enum reserved）' };
    }
    /* Undeclared is a state with a name — not an empty string and not a default. */
    return { kind: 'undeclared', value: null, label: '模式未声明', mind: 'unknown',
      writesExperience: null, implemented: null,
      note: 'the period carries no run mode; do not read this as mode ①' };
  }

  /* ── the tree ── */
  function buildTree(periods) {
    var byId = {}, order = [], edges = [];
    (periods || []).forEach(function (p) {
      if (!p || !p.period_id) { return; }
      byId[p.period_id] = { id: p.period_id, parent: p.parent || null, row: p, children: [] };
      order.push(p.period_id);
    });
    order.forEach(function (id) {
      var n = byId[id];
      if (n.parent && byId[n.parent]) {
        byId[n.parent].children.push(id);
        edges.push([n.parent, id]);
      } else if (n.parent) {
        /* A parent that is not in the list is not a root: it is a TRUNCATED walk. Declared. */
        n.truncated = n.parent;
        edges.push([n.parent, id]);
      }
    });
    var roots = order.filter(function (id) { return !byId[id].parent; });
    /* THE CONVERSATION IS THE LINEAGE ROOT (ADR-0048 §297). `job_id` is a CONTENT DIGEST — the reader
     * documents it as "NOT usable as a list key" (query.rs:113) — yet the panel grouped by it, so two
     * conversations that opened with the same words fused into one (measured: 11 roots under one job).
     * ONE NAME, ONE FACT: conversation_id := the root of this node's parent chain. A root's own id is
     * its conversation id; a continuation inherits it. Derived from the IMMUTABLE lineage, never from
     * content, and never a second id space. */
    var memo = {};
    function rootOf(id) {
      if (memo[id]) { return memo[id]; }
      var guard = 0, cur = id, seen = {};
      while (cur && byId[cur] && byId[cur].parent && !seen[cur] && guard++ < 10000) { seen[cur] = true; cur = byId[cur].parent; }
      var root = cur || id;
      for (var k in seen) { memo[k] = root; }
      memo[id] = root;
      return root;
    }
    order.forEach(function (id) { byId[id].root = rootOf(id); });
    return { byId: byId, order: order, edges: edges, roots: roots, rootOf: rootOf };
  }

  /* ── the ancestor closure = "how did this experience come to be" (git-log, not git-log --all) ── */
  function ancestorClosure(tree, id) {
    var out = [], seen = {}, cur = id, guard = 0;
    while (cur && tree.byId[cur] && !seen[cur] && guard++ < 10000) {
      seen[cur] = true; out.push(cur);
      cur = tree.byId[cur].parent;
    }
    /* Root-first: the reader meets the origin before the leaf. */
    out.reverse();
    var truncated = (tree.byId[id] && tree.byId[id].truncated) || null;
    var cycle = out.length && tree.byId[out[0]] && seen[tree.byId[out[0]].parent] ? true : false;
    return { path: out, truncated: truncated, cycle: cycle };
  }

  /* ── what a selected node shows, locally: itself + its context + its children. Nothing global. ── */
  function selection(tree, id) {
    var n = tree.byId[id];
    if (!n) { return { kind: 'missing', id: id, note: 'no such period in this view' }; }
    return {
      kind: 'node',
      id: id,
      parent: n.parent,
      children: n.children.slice(),
      context: ancestorClosure(tree, id),
      /* The period's own facts are pulled by the caller ONLY when this node is selected —
       * that is the "on demand" half; this function never walks the whole graph. */
      rows: null
    };
  }

  /* ── RENDER (Shneiderman's mantra, §227): overview → zoom/filter → details on demand ──
   * `render` builds ONLY the overview (one row per period) plus a detail host. The period's rows
   * are fetched by the caller's `fetchRows` and ONLY when a node is selected — never for the whole
   * tree. That is the difference between this and the monolithic dashboard the cell started with:
   * there, details-on-demand was rendered first.
   * UI text keeps the product's language; identifiers and comments stay English (owner's rule). */
  function render(host, periods, opts) {
    opts = opts || {};
    var tree = buildTree(periods);
    var sel = opts.selected || null;
    if (!host || !host.ownerDocument) { return { tree: tree, select: function () {} }; }
    var doc = host.ownerDocument;
    host.textContent = '';
    var groupsById = {};
    groupByConversation(periods).forEach(function (g) { groupsById[g.conversation_id] = g; });
    var list = doc.createElement('div');
    list.className = 'pt-tree';
    list.setAttribute('role', 'tree');
    var detail = doc.createElement('div');
    detail.className = 'pt-detail';

    function selectOne(id) {
      sel = id;
      var s = selection(tree, id);
      detail.textContent = '';
      if (s.kind !== 'node') {
        var miss = doc.createElement('div');
        miss.className = 'pt-missing';
        miss.textContent = s.note;
        detail.appendChild(miss);
        return s;
      }
      var ctx = doc.createElement('div');
      ctx.className = 'pt-context';
      ctx.setAttribute('data-path', s.context.path.join('>'));
      ctx.textContent = s.context.path.join(' > ');
      detail.appendChild(ctx);
      var badge = doc.createElement('span');
      badge.className = 'pt-mode';
      badge.setAttribute('data-mode-kind', modeFacts(tree.byId[id].row && tree.byId[id].row.mode).kind);
      var f = modeFacts(tree.byId[id].row && tree.byId[id].row.mode);
      badge.textContent = f.label + (f.note ? ' · ' + f.note : '');
      detail.appendChild(badge);
      if (typeof opts.fetchRows === 'function') {
        /* ON DEMAND: exactly one call, for the selected period only.
         * The real loader is `/api/events?id=<period_id>` and therefore ASYNC — so the three states are
         * named rather than collapsed: `pending` while it travels, a COUNT when it lands, and
         * `error` when it fails. A silent blank would be the same defect this cell keeps meeting:
         * "no rows" and "the fetch failed" must not read alike. */
        var box = doc.createElement('div');
        box.className = 'pt-rows';
        box.setAttribute('data-count', 'pending');
        detail.appendChild(box);
        var got = opts.fetchRows(id);
        if (got && typeof got.then === 'function') {
          got.then(function (rows) {
            box.setAttribute('data-count', String((rows && rows.length) || 0));
            if (typeof opts.onRows === 'function') { opts.onRows(box, rows, id); }
          }, function (err) {
            box.setAttribute('data-count', 'error');
            box.setAttribute('data-error', String(err && err.message ? err.message : err));
          });
        } else {
          box.setAttribute('data-count', String((got && got.length) || 0));
          if (typeof opts.onRows === 'function') { opts.onRows(box, got, id); }
        }
      }
      Array.prototype.forEach.call(doc.querySelectorAll('.ses-item'), function (el) {
        el.setAttribute('aria-selected', el.getAttribute('data-period') === id ? 'true' : 'false');
        /* THE APP'S MARKER IS `aria-current` (§248): the live contract asks for exactly ONE row with
         * `aria-current="true"` — "the selection is discernible without colour" (N-019) and "the chosen
         * period is marked in the sidebar" (N-004). The tree only spoke `aria-selected`, so retiring the
         * legacy path left three live criteria red with `[0 marked]`. Both are set now: the app's name and
         * this module's own. */
        /* THE MARKER IS A PAIR: the legacy card carried BOTH the `sel` class and `aria-current="true"`,
         * and the live criteria count that pair. */
        /* THE MARKER IS A PAIR: the live criteria count `.ses-item` carrying `sel`, and N-019 reads
         * `aria-current`. The sweep is DOCUMENT-WIDE so exactly one row can win. */
        if (el.getAttribute('data-period') === id) {
          el.setAttribute('aria-current', 'true');
          if (el.className.indexOf('sel') < 0) { el.className = el.className + ' sel'; }
        } else {
          el.removeAttribute('aria-current');
          el.className = el.className.replace(/\s*sel\b/, '');
        }
      });
      return s;
    }

    var lastGroup = null;
    /* ENTRY SET IS A PARAMETER, NOT A NEW DEFAULT (ADR-0048 §240.3). Measured: the payload holds 52
     * periods of which **44 are roots** and only 8 are continuations, while one job carries 34 of
     * them — so a flat list makes 34 near-identical cards. `parent == null` is the TOPOLOGICAL entry
     * set; `job_id` is provenance — a CONTENT DIGEST, identical across conversations that open with the
     * same words, so it can never be the group key. The key is DECLARED and derived: `conversation_id`
     * = this row's LINEAGE ROOT (ADR-0048 §297). */

    var visible = opts.rootsOnly === true ? tree.roots.slice() : tree.order.slice();
    /* WHEN THE ROOTS ARE THE LIST, GROUP HEADERS ARE A LEFTOVER (ADR-0048 §242): measured on the live
     * payload, the roots-only list emitted 9 headers for 13 jobs, because the tree's order is not
     * grouped by job and one job splits into several runs. A header that does not correspond to a
     * conversation is noise — and the ROOT already IS the conversation's entry, so nothing is lost.
     * With the full DAG (`rootsOnly:false`) the headers still separate conversations. */
    var showGroups = opts.rootsOnly !== true;
    /* HEADERS ONLY WHERE THERE IS SOMETHING TO GROUP (ADR-0048 §301). Measured on the live payload:
     * **49 headers + 50 rows expressed 50 conversations** — every ONE-ROUND conversation printed twice (a
     * header saying "1 period · 1 with reply" and then its only row). That duplication is what the owner
     * reported as "messy": the chain design is "one root = one conversation", so a one-round conversation's
     * ROW is its entry and a header above it says nothing new. A header earns its line only when it groups
     * TWO OR MORE rows of the same conversation. */
    var convCount = {};
    visible.forEach(function (id) {
      var n0 = tree.byId[id];
      var c0 = (n0.row && n0.row.conversation_id) || n0.root || (n0.row && n0.row.period_id) || null;
      if (c0) { convCount[c0] = (convCount[c0] || 0) + 1; }
    });
    visible.forEach(function (id) {
      var n = tree.byId[id];
      /* GROUP HEADER when the conversation changes: 13 first-level entries over 52 children (§238). */
      /* THE DECLARED FACT WINS (§298): the reader now projects `conversation_id` (the lineage root,
       * `null` when the window truncated the chain). The local derivation stays as the fallback for
       * payloads that predate the field — and a LIVE criterion asserts the two agree, so drift is red
       * rather than silently resolved. Never `job_id`: a digest is provenance, not a key. */
      var conv = (n.row && n.row.conversation_id) || n.root || (n.row && n.row.period_id) || null;
      if (showGroups && conv && conv !== lastGroup && (convCount[conv] || 0) >= 2) {
        var g = groupsById[conv];
        var head = doc.createElement('div');
        head.className = 'pt-group';
        head.setAttribute('data-conversation', conv);
        head.setAttribute('data-count', String((g && g.count) || 0));
        head.textContent = (g && g.label) || conv;
        list.appendChild(head);
      }
      if (conv) { lastGroup = conv; }   /* the conversation was visited even when it needed no header */
      var row = doc.createElement('button');
      row.type = 'button';
      /* THE CONTRACT IS INHERITED, NOT INVENTED (ADR-0048 §247). Measured: the rest of the app drives
       * this sidebar through `#s-side .ses-item` (all_views_test.js:488) with `data-job` = period_id,
       * so a replacement that only carries its OWN names (`.pt-node`, `data-period`) satisfies me and
       * *removes the app's only way to pick a period* — measured live as "sidebar rows available to
       * drive prove-track [0 rows]". A row is therefore THREE things at once:
       *   `.pt-node`   — this module's own name (its criteria keep working),
       *   `.ses-item`  — the app's contract (selection highlighting + the drive path),
       *   `data-job`   — the identity, exactly as the legacy card carried it. */
      row.className = 'pt-node ses-item';
      row.setAttribute('data-period', id);
      if (n.depth != null) { row.style.paddingLeft = (8 + n.depth * 14) + 'px'; }
      row.setAttribute('data-job', id);   /* the contract's identity: period_id, as the legacy card had it */
      if (conv) { row.setAttribute('data-conversation', conv); }
      /* The fact that separates "one conversation" from "34 near-identical cards" — without drawing
       * the 34. */
      var subtree = 0;
      (function count(nid) { subtree++; tree.byId[nid].children.forEach(count); })(id);
      row.setAttribute('data-descendants', String(subtree));
      row.setAttribute('data-depth', String(ancestorClosure(tree, id).path.length - 1));
      if (n.truncated) { row.setAttribute('data-truncated', n.truncated); }
      /* THE LABEL RULE HAS ONE HOST (§266). This line used to fall back to the raw period id, and since
       * every period's `name` is null the sidebar listed identifiers — measured on the live page:
       * rows reading `run-233a86e49afbc98c-p006abab075000001`. That is the owner's " (Chinese UI text lives in strings, not comments)
       * cannot recognise. The panel already owns the rule (`autoName`: name → the user's own words →
       * time), so the tree ASKS for it instead of inventing a second one. The `name || id` fallback stays
       * for callers that pass no oracle. */
      row.textContent = (typeof opts.labelFor === 'function')
        ? opts.labelFor(n.row || {})
        : ((n.row && n.row.name) ? n.row.name : id);
      /* WHICH ROUND AM I LOOKING AT (ADR-0048 §269). `chainJobIds` returns the LINEAGE PATH
       * (root -> the opened period) and deliberately does not walk forward, so opening the ROOT shows
       * one round while opening the LATEST round shows the whole conversation. Measured: click root => 1,
       * click middle => 2, click leaf => 4 of 4. That is correct behaviour that reads as "the chain is
       * broken" unless the rows say which is which. Two named facts, no new mechanism. */
      var isStart = !n.parent;
      var isLatest = !(n.children && n.children.length);
      if (isStart) { row.setAttribute('data-role', 'start'); }
      if (isLatest) { row.setAttribute('data-role', isStart ? 'start-and-latest' : 'latest'); }
      if (isLatest) {
        var tag = doc.createElement('span');
        tag.className = 'pt-tag';
        tag.textContent = isStart ? ' · 起点(仅此一轮)' : ' · 最新(点它看整段)';
        row.appendChild(tag);
      }
      /* ── ADR-0049 只读投影（人类 2026-10-09）─────────────────────────────────
       * 活动区 / 沉淀区 / 被驳回支线。**碳硅同构（Cellrix:ADR-0021）**：每个可见元素
       * 必须可被 AI 寻址 —— 所以每块都带 `data-role`，流水账**逐行**带
       * `data-action|when|who`。纯装饰对 ta 不存在，那就不该画。
       * **render 纯**：只读 `n.row` 的字段，**不碰 Date.now()/Math.random()** ——
       * 同一 state 渲染两次必须逐字节相同，否则 AI 指不稳镜子里那一块。 */
      var pr = n.row || {};
      var stEl = doc.createElement('span');
      stEl.className = 'pt-st';
      stEl.setAttribute('data-role', 'converge-status');
      stEl.setAttribute('data-status', pr.status || 'derived');
      stEl.textContent = pr.status || '按龄期';
      row.appendChild(stEl);
      if (pr.gist) {
        var gEl = doc.createElement('div');
        gEl.className = 'pt-gist';
        gEl.setAttribute('data-role', 'gist');
        gEl.textContent = pr.gist;
        row.appendChild(gEl);
      }
      if (pr.rejection_log && pr.rejection_log.length) {
        /* **整本流水账**，不是当前状态 —— 反悔不是擦除；面板只显示当前状态
         * 就等于**替用户把历史擦了**（人类 2026-10-09）。 */
        var ul = doc.createElement('ul');
        ul.className = 'pt-rej';
        ul.setAttribute('data-role', 'rejection-ledger');
        ul.setAttribute('data-current', pr.rejected ? 'rejected' : 'revoked');
        for (var li = 0; li < pr.rejection_log.length; li++) {
          var q = String(pr.rejection_log[li]).split(' | ');
          var item = doc.createElement('li');
          item.setAttribute('data-action', q[2] || '');
          item.setAttribute('data-when', q[0] || '');
          item.setAttribute('data-who', q[1] || '');
          item.textContent = (q[2] || '') + '（' + (q[0] || '') + ' / ' + (q[1] || '') + '）'
            + q.slice(3).join(' | ');
          ul.appendChild(item);
        }
        row.appendChild(ul);
      }
      row.addEventListener('click', function () {
        selectOne(id);
        /* The prove-track view has its own gesture so the PRIMARY click can stay "continue this
         * conversation" (§264). A double-click is additive: it cannot break the single-click contract. */
        if (typeof opts.onProve === 'function') {
          row.addEventListener('dblclick', function (ev) { if (ev) { ev.preventDefault(); } opts.onProve(id); });
        }
        /* NAVIGATION DRIVES THE MAIN VIEW (option A): a CLICK is the user's intent, so it is the
         * only place that calls `onSelect`. The default selection deliberately does not — opening
         * the panel must respect the view the markup marks as current. */
        if (typeof opts.onSelect === 'function') { opts.onSelect(id); }
      });
      list.appendChild(row);
    });
    /* SINGLE-ROUND CONVERSATIONS ARE ONE CLASS, NOT N ROWS (ADR-0048 §302). Measured in the owner's own
     * view: ~45 visible rows were the SAME one-round conversation (same opening words, "start, single
     * round") repeated, so the sidebar read as noise instead of as conversations. They are NOT deleted and NOT
     * hidden facts: they are folded under ONE header that DECLARES how many there are, collapsed by
     * default and one click away. Multi-round conversations keep their own entries and headers (§301). */
    var convOf = function (id) {
      var n0 = tree.byId[id] || {};
      return (n0.row && n0.row.conversation_id) || n0.root || (n0.row && n0.row.period_id) || null;
    };
    var singleIds = visible.filter(function (id) { return (convCount[convOf(id)] || 0) === 1; });
    if (singleIds.length >= 2) {
      var singleBox = doc.createElement('div');
      singleBox.className = 'pt-singles';
      singleBox.setAttribute('hidden', '');
      singleBox.setAttribute('data-single-rounds', String(singleIds.length));
      var singleHead = doc.createElement('button');
      singleHead.type = 'button';
      singleHead.className = 'pt-group pt-single-head';
      singleHead.setAttribute('data-single-rounds-toggle', '');
      var label = function (open) { return '\u5355\u8f6e\u4f1a\u8bdd \u00b7 ' + singleIds.length + ' \u6bb5' + (open ? '\uff08\u70b9\u51fb\u6536\u8d77\uff09' : '\uff08\u70b9\u51fb\u5c55\u5f00\uff09'); };
      singleHead.textContent = label(false);
      singleHead.onclick = function () {
        if (singleBox.hasAttribute('hidden')) {
          singleBox.removeAttribute('hidden');
          singleHead.textContent = label(true);
        } else {
          singleBox.setAttribute('hidden', '');
          singleHead.textContent = label(false);
        }
      };
      singleIds.forEach(function (id) {
        var r = list.querySelector('[data-period="' + id + '"]');
        if (r) { singleBox.appendChild(r); }
      });
      list.appendChild(singleHead);
      list.appendChild(singleBox);
    }
    host.appendChild(list);
    host.appendChild(detail);
    if (sel) { selectOne(sel); }
    return { tree: tree, select: selectOne };
  }

  /* ── STEP ROWS: the period's facts, rendered locally (P0-2f) ──
   * Every value comes from the SINGLE readers the rest of the panel uses (`tokOf` / `durOf` /
   * `foldedCell` / `semOf`), so this view performs NO arithmetic and holds no second copy of a fact.
   * The three-state distinction is preserved on the wire as `data-state`: `p` measured, `n`
   * unmeasured, `a` absent — and the criterion asserts the three TEXTS are pairwise different, so
   * any `|| 0` that collapses them is caught rather than merely discouraged.
   * The model column exists only when the event declares one: an absent model is not an empty cell
   * pretending to be data. */
  function renderRows(box, events) {
    if (!box || !box.ownerDocument) { return null; }
    var doc = box.ownerDocument;
    var M = root.CxCellMetering;
    /* ALIVE, NOT REBUILT (owner's requirement): a refresh must touch only what changed.
     * The first version cleared `box.textContent` and rebuilt every row — which loses focus, scroll
     * position and any transient UI state, and is exactly the "wholesale re-render" the existing
     * experience list already paid for (its own comment records the scroll-jump bug). So rows are
     * RECONCILED BY POSITION: existing nodes are reused and updated in place, surplus rows are
     * removed from the end, new ones are appended. DOM identity is the observable property, and the
     * criterion asserts it (a stashed sentinel must survive a refresh). */
    var list = box.querySelector('.pt-steps');
    if (!list) {
      list = doc.createElement('div');
      list.className = 'pt-steps';
      box.appendChild(list);
    }
    var rows = events || [];
    while (list.children.length > rows.length) { list.removeChild(list.lastChild); }
    var cell = function (row, cls, tag) {
      var el = row.querySelector('.' + cls);
      if (!el) { el = doc.createElement(tag || 'span'); el.className = cls; row.appendChild(el); }
      return el;
    };
    var stateOf = function (v) { return v && v.k ? String(v.k) : 'a'; };
    var textOf = function (v) {
      if (!v) { return ''; }
      if (M && M.foldedCell) { return M.foldedCell({ tok: v }); }
      return v.k === 'p' ? String(v.v) : (v.k === 'n' ? '· \u672a\u8ba1\u91cf' : '· \u65e0\u6570\u636e');
    };
    for (var i = 0; i < rows.length; i++) {
      var e = rows[i];
      var row = list.children[i];
      if (!row) {
        row = doc.createElement('div');
        row.className = 'pt-step';
        list.appendChild(row);
      }
      row.setAttribute('data-step', String(i + 1));
      var sem = cell(row, 'pt-sem');
      sem.textContent = (M && M.semOf) ? M.semOf(e) : '';
      var tok = cell(row, 'pt-tok');
      var t = (M && M.tokOf) ? M.tokOf(e) : null;
      /* THREE STATES, NOT TWO (ADR-0048 §335; §52 / Codd's fourth state). A dimension that a type NEVER
       * carries is INAPPLICABLE — not "unmeasured" and not "no data". The decision uses the FAMILY's own
       * declaration (`PAYLOAD_MAP[type].completionTokens`), so no second list of types exists here: measured
       * behaviour was that the reply row read as "no data", which says "the record is missing" when the
       * column simply does not apply to that type. */
      var family = (typeof window !== 'undefined' && window.CxEventFamily) || null;
      var familyMap = (family && family.PAYLOAD_MAP && family.PAYLOAD_MAP[e && e.type]) || null;
      /* ONLY A DECLARED TYPE MAY BE CALLED INAPPLICABLE. If the family is absent, or does not know this type,
       * the honest reading is the old one (`no data`), not a claim about applicability we cannot support —
       * "we do not know" and "it does not apply" are different facts, and guessing between them is what this
       * project keeps fixing. Measured: without this guard a harness that had not loaded the family turned
       * every absent token into `—`. */
      var familyKnowsType = !!(family && family.PAYLOAD_MAP
        && Object.prototype.hasOwnProperty.call(family.PAYLOAD_MAP, e && e.type));
      var carriesTokens = !!(familyMap && familyMap.completionTokens);
      var measured = !!t && (t.k === 'p' || t.k === 'n');
      var inapplicable = !measured && familyKnowsType && !carriesTokens;
      tok.setAttribute('data-state', inapplicable ? 'na' : stateOf(t));
      tok.textContent = inapplicable ? '\u2014' : textOf(t);
      var dur = cell(row, 'pt-dur');
      var d = (M && M.durOf) ? M.durOf(e) : null;
      dur.setAttribute('data-state', stateOf(d));
      dur.textContent = (d && d.k === 'p') ? String(d.v) + 'ms' : (d && d.k === 'n' ? '\u672a\u8ba1\u91cf' : '');
      var model = e && e.data && e.data.model;
      var md = row.querySelector('.pt-model');
      if (model) {
        if (!md) { md = doc.createElement('span'); md.className = 'pt-model'; row.appendChild(md); }
        md.textContent = String(model);
      } else if (md) {
        /* A model that stops being declared must stop being shown — absence is not a stale value. */
        row.removeChild(md);
      }
    }
    return list;
  }

  /* ── SIDEBAR MOUNT (P0-2d): additive by construction ──
   * The host (`#s-side`) is owned by the experience list, which re-renders it wholesale and by
   * design knows nothing about this view. So the tree lives in its OWN child container, replaced
   * idempotently: the list's markup, its tests and its selection logic stay untouched.
   * `fetchRows` stays the caller's decision — until the panel has a single-period loader wired, the
   * mount takes it as an option and, when absent, renders the overview only (declared, not faked). */
  /* THE REPLY HAS THREE STATES, NOT TWO (ADR-0048 §237).
   * Measured on the live payload: 52 cards, of which 18 carry an EMPTY reply string, 0 are missing,
   * and 34 have text. The sidebar rendered an empty reply as NOTHING, so a third of the list was
   * silently wordless. An empty string and an absent field are different facts: the first says "the
   * turn produced nothing", the second says "we never had a reply here". Naming them is the same
   * discipline as the "not measured" / "no data" distinction.
   */
  /* ── CONVERSATIONS, THEN THEIR PERIODS (ADR-0048 §238) ──
   * Measured on the live payload: 52 periods but only 13 jobs, and ONE job carries 34 of them. The
   * sidebar showed all 52 flat, so a reader could not pair "13 conversations" with "52 cards" — and
   * read it as duplication. Grouping is not cosmetics: the world is 1 conversation : N periods, and a
   * list that flattens that relation loses the relation.
   * Each group carries a DISTINGUISHING FACT (its size and how many turns produced words), because
   * two entries a reader cannot tell apart ARE a duplicate as far as the reader is concerned. */
  function groupByConversation(periods) {
    var order = [], by = {};
    /* The conversation key is derived here too, from `parent` alone — the function must not need the
     * tree, and it must never look at `job_id` (see §297). */
    var parentOf = {};
    (periods || []).forEach(function (p) { if (p && p.period_id) { parentOf[p.period_id] = p.parent || null; } });
    function rootOfKey(id) {
      var guard = 0, cur = id, seen = {};
      while (cur && parentOf[cur] && !seen[cur] && guard++ < 10000) { seen[cur] = true; cur = parentOf[cur]; }
      return cur || id;
    }
    (periods || []).forEach(function (p) {
      if (!p) { return; }
      /* KEYED BY THE LINEAGE ROOT (§297), computed from `parent` alone — so two conversations with the
       * same opening words stay two conversations instead of fusing on a shared content digest. */
      var key = p.conversation_id || (p.period_id ? rootOfKey(p.period_id) : null);
      if (!key) { return; }
      if (!by[key]) {
        by[key] = { conversation_id: key, periods: [], first_ts: p.first_ts || null, last_ts: p.last_ts || null, replied: 0 };
        order.push(key);
      }
      var g = by[key];
      g.periods.push(p);
      if (p.first_ts && (!g.first_ts || p.first_ts < g.first_ts)) { g.first_ts = p.first_ts; }
      if (p.last_ts && (!g.last_ts || p.last_ts > g.last_ts)) { g.last_ts = p.last_ts; }
      if (typeof p.reply === 'string' && p.reply.trim() !== '') { g.replied++; }
    });
    return order.map(function (k) {
      var g = by[k];
      g.count = g.periods.length;
      g.label = g.count + (g.count === 1 ? ' period' : ' periods') + ' \u00b7 ' + g.replied + ' with reply';
      return g;
    });
  }

  function replyState(reply, model) {
    /* ONE VOCABULARY FOR "EMPTY" AND "ABSENT" (ADR-0048 §352): the words come from the family, so this
     * renderer and `bodyState` cannot drift into naming the same fact differently on one screen. */
    var words = (typeof window !== 'undefined' && window.CxEventFamily && window.CxEventFamily.BODY_WORDS)
      || { empty: '有但为空', absent: '未记录' };
    if (typeof reply === 'string' && reply.trim() !== '') {
      return { kind: 'present', label: null };
    }
    if (typeof reply === 'string') {
      return { kind: 'empty', label: words.empty + (model ? '' : '（模型未报）') };
    }
    return { kind: 'absent', label: words.absent };
  }

  function mountSidebar(periods, opts) {
    opts = opts || {};
    var hostId = opts.hostId || 's-side';
    var host = (typeof document !== 'undefined') && document.getElementById(hostId);
    if (!host) { return null; }
    /* ONE default detail, not none and not all (P0-2g): the payload is newest-first, so opening the
     * panel selects the newest experience exactly once. `overview first` still holds — the tree is
     * drawn in full — while `details-on-demand` is honoured by fetching ONE period rather than N. */
    if (!opts.selected && periods && periods.length && periods[0] && periods[0].period_id) {
      /* THE DEFAULT SELECTION MUST BE A RENDERED ROW (ADR-0048 §249). The payload is newest-first, and
       * the newest period can be a CONTINUATION — while the entry set here is the ROOTS. Selecting it
       * then marked NOTHING, and the detail described a node the list did not contain:
       * measured live as `the highlight still lands on exactly one row [0 marked]` (three criteria).
       * So the default walks UP the parent chain to the row that is actually on screen. */
      var want = periods[0].period_id;
      if (opts.rootsOnly !== false) {
        var t = buildTree(periods);
        var guard = 0;
        while (t.byId[want] && t.byId[want].parent && t.byId[t.byId[want].parent] && guard++ < 256) {
          want = t.byId[want].parent;
        }
      }
      opts = Object.assign({}, opts, { selected: want });
    }
    /* ONE SURFACE (§240.2): the sidebar already had a flat card list, and mounting a tree INTO the
     * same host left BOTH visible — the owner's "still duplicated and messy". The legacy children are
     * hidden here; the tree takes the surface. Deleting them outright is a separate step. */
    /* ONE SURFACE, AND EVERY ROUND IS IN IT (ADR-0048 §268). The earlier retirement failed because it
     * removed rows while the tree listed only the ROOTS — reachability fell 100% -> 55%. The sidebar now
     * mounts with `rootsOnly:false`, so the tree covers every period; only THEN are the legacy rows
     * removed. Removal (not hiding) is required: a hidden `.ses-item` still counts as a marked row when
     * `session_list.js` runs before this file loads. */
    Array.prototype.forEach.call(Array.prototype.slice.call(host.children), function (el) {
      if (!el.hasAttribute('data-panel-tree')) { el.remove(); }
    });
    var box = host.querySelector('[data-panel-tree]');
    if (!box) {
      box = document.createElement('div');
      box.className = 'pt-mount';
      box.setAttribute('data-panel-tree', '1');
    }
    /* THE ONE ENTRY THAT NEEDS NO SELECTION (ADR-0048 §337). Measured: with nothing selected the banner — and
     * its ✗ — are absent, so starting a new conversation had NO entry point anywhere. The button is mounted
     * AFTER the tree marker, carries its own marker (so the host's wholesale re-render cannot orphan it via
     * the retirement filter), and calls the SAME action the banner calls (`newChat`): one host for the act. */
    if (!host.querySelector('[data-panel-new]')) {
      /* `doc` is NOT in this scope (it lives in `renderRows`): using it here threw a ReferenceError and the
       * whole sidebar rendered its EMPTY state — the criterion's named skip is what kept that visible instead
       * of turning it into a mysterious red. Take the document from the host that is being mounted into. */
      var doc = host.ownerDocument || document;
      var newBox = doc.createElement('div');
      newBox.className = 'pt-new';
      newBox.setAttribute('data-panel-new', '1');
      var newBtn = doc.createElement('button');
      newBtn.type = 'button';
      newBtn.className = 'btn sm';
      newBtn.setAttribute('data-new-chat', '1');
      newBtn.textContent = '+ 新对话';
      newBtn.onclick = function (ev) {
        ev.stopPropagation();
        var sessions = (typeof window !== 'undefined' && (window.CxSessions || window.Cx)) || null;
        if (sessions && typeof sessions.newChat === 'function') { sessions.newChat(); }
      };
      newBox.appendChild(newBtn);
      host.appendChild(newBox);
      host.appendChild(box);
    }
    /* The sidebar asks for the ROOTS explicitly (44 of 52 measured) — its entry set, declared. */
    /* EVERY ROUND IS AN ENTRY (ADR-0048 §268): the sidebar used to pass `rootsOnly !== false`, i.e.
     * roots only, which is why retiring the cards dropped reachability 100% -> 55%. The default is now
     * ALL periods (the tree indents by depth, so the chain is visible); a caller can still ask for
     * `rootsOnly: true` explicitly. */
    var view = render(box, periods, Object.assign({}, opts, { rootsOnly: opts.rootsOnly === true }));
    return view;
  }

  root.CxPanelTree = {
    MODES: MODES,
    modeFacts: modeFacts,
    buildTree: buildTree,
    ancestorClosure: ancestorClosure,
    selection: selection,
    render: render,
    mountSidebar: mountSidebar,
    renderRows: renderRows,
    replyState: replyState,
    groupByConversation: groupByConversation
  };
})(window);
