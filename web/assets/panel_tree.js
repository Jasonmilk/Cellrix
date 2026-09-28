/* panel_tree — DAG NAVIGATION, ON DEMAND (ADR-0048 §227).
 *
 * The goal it serves: the panel must let a reader SEE the experience DAG, click a node, and read
 * that node's facts locally — instead of a monolithic dashboard (the "泳道/网格" shape this cell
 * started with). DSH's trajectory is the reference; what we add is the proof-track's own facts:
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

  root.CxPanelTree = {
    MODES: MODES,
    modeFacts: modeFacts,
    buildTree: buildTree,
    ancestorClosure: ancestorClosure,
    selection: selection
  };
})(window);
