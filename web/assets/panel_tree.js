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
  var MODES = {
    Drive: { label: 'Anaphase Only（harness）', mind: 'absent', writesExperience: false, implemented: true },
    Partner: { label: '伙伴（带记忆）', mind: 'required', writesExperience: true, implemented: true },
    Survive: { label: '生存（Mind 自治）', mind: 'required', writesExperience: true, implemented: false }
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
    return { byId: byId, order: order, edges: edges, roots: roots };
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
         * The real loader is `/api/events?job_id=<id>` and therefore ASYNC — so the three states are
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
      Array.prototype.forEach.call(list.children, function (el) {
        el.setAttribute('aria-selected', el.getAttribute('data-period') === id ? 'true' : 'false');
      });
      return s;
    }

    tree.order.forEach(function (id) {
      var n = tree.byId[id];
      var row = doc.createElement('button');
      row.type = 'button';
      row.className = 'pt-node';
      row.setAttribute('data-period', id);
      row.setAttribute('data-depth', String(ancestorClosure(tree, id).path.length - 1));
      if (n.truncated) { row.setAttribute('data-truncated', n.truncated); }
      row.textContent = (n.row && n.row.name) ? n.row.name : id;
      row.addEventListener('click', function () {
        selectOne(id);
        /* NAVIGATION DRIVES THE MAIN VIEW (option A): a CLICK is the user's intent, so it is the
         * only place that calls `onSelect`. The default selection deliberately does not — opening
         * the panel must respect the view the markup marks as current. */
        if (typeof opts.onSelect === 'function') { opts.onSelect(id); }
      });
      list.appendChild(row);
    });
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
      tok.setAttribute('data-state', stateOf(t));
      tok.textContent = textOf(t);
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
  function mountSidebar(periods, opts) {
    opts = opts || {};
    var hostId = opts.hostId || 's-side';
    var host = (typeof document !== 'undefined') && document.getElementById(hostId);
    if (!host) { return null; }
    /* ONE default detail, not none and not all (P0-2g): the payload is newest-first, so opening the
     * panel selects the newest experience exactly once. `overview first` still holds — the tree is
     * drawn in full — while `details-on-demand` is honoured by fetching ONE period rather than N. */
    if (!opts.selected && periods && periods.length && periods[0] && periods[0].period_id) {
      opts = Object.assign({}, opts, { selected: periods[0].period_id });
    }
    var box = host.querySelector('[data-panel-tree]');
    if (!box) {
      box = document.createElement('div');
      box.className = 'pt-mount';
      box.setAttribute('data-panel-tree', '1');
      host.appendChild(box);
    }
    var view = render(box, periods, opts);
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
    renderRows: renderRows
  };
})(window);
