/* Read-boundary normalisation — Cellrix:ADR-0019 I1 / I2 / I3.
 *
 * Assigns `gseq` ONCE, here, before anything filters: the physical row index of
 * the period as it came off the wire. Everything downstream keys on it —
 * dedupe, ordering, node id — so re-feeding, chunking and back-filling all hand
 * back the same value and nothing moves.
 *
 * `turn` is derived at the same boundary and stays OUT of the node id (I3): it
 * is display grouping, not identity. Putting it in the id is what made
 * back-filling unstable in an earlier attempt — the ordinal shifts when an
 * earlier page is inserted, the node id changes, and every existing node is
 * replaced.
 *
 * Why the boundary and not inside feed(): a turn index computed inside feed()
 * depends on arrival order. Chunk invariance needs it to accumulate across
 * feeds; back-fill needs it to be recomputable. Both at once is impossible from
 * seq + time alone (ADR-0019 D0b, measured).
 *
 * Depends on CxEventFamily for the vocabulary — it must load first.
 */
(function () {
  'use strict';

  var EF = window.CxEventFamily;
  if (!EF) {
    throw new Error('period_normalize.js requires event_family.js to load first');
  }

  var VERSION = '1.0.0';

  /* A period whose rows do not arrive as a contiguous run cannot be given a
   * stable gseq, so the caller is told rather than left to guess. */
  var LAST_TRUNCATION = null;   /* compat: set ONLY for a real truncation (§185) */
  var LAST_WALK = null;         /* the four-state diagnostic of the last walk (§185) */

  function checkContiguous(rows) {
    /* The guard is on the INPUT, and it has one known blind spot: because gseq
     * is the array index, it is contiguous by construction, so this cannot
     * detect wholesale reordering — reordered rows still produce 0..n-1. It
     * catches an empty read, which is the shape a dropped or truncated
     * response takes. Catching reordering needs the producer's own gseq, which
     * is exactly what TBD1 would buy (ADR-0019 I1a). */
    if (!rows || !rows.length) {
      return { ok: false, reason: 'empty', count: 0 };
    }
    for (var i = 0; i < rows.length; i++) {
      if (!rows[i] || typeof rows[i] !== 'object' || !rows[i].type) {
        return { ok: false, reason: 'malformed-row', at: i, count: rows.length };
      }
    }
    return { ok: true, count: rows.length };
  }

  /* Call this ONCE, on the complete stream.
   *
   * gseq is the row's position in the array it is given, so calling this per
   * chunk would restart it at 0 for every chunk and the keys would collide —
   * the very bug this file exists to remove. Chunking happens AFTER this, on
   * the normalised array. This follows from I1: the consumer must hold the
   * complete ordered stream before it splits anything.
   *
   * Rows in, rows out, each carrying gseq (identity) and turn (grouping).
   * Both are non-enumerable so an event's serialised shape stays exactly what
   * the producer wrote — fixtures, digests and callers see no difference. */
  function normalize(rows, meta) {
    var check = checkContiguous(rows);
    if (!check.ok) {
      return { events: [], turnCount: 0, diagnostics: check };
    }

    var turn = 0;
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      /* Counted BEFORE the row is copied, and before any filtering, so a row
       * dropped downstream leaves its gseq unused rather than shifting every
       * later row up by one (I2). */
      if (r.type === EF.TYPES.TURN_START) turn++;
      var e = {};
      for (var k in r) {
        if (Object.prototype.hasOwnProperty.call(r, k)) e[k] = r[k];
      }
      mark(e, 'gseq', i);
      /* lineNo is the position inside the stream this call received. Called on
       * one period that IS the file line number; mergeChain overwrites it with
       * the real one after concatenation. Identity needs it: gseq is the merged
       * position and changes with the starting point, while seq restarts every
       * turn, so neither can serve as identity on its own. */
      mark(e, 'lineNo', i);
      mark(e, 'turn', turn || 1);
      out.push(e);
    }

    return {
      events: out,
      turnCount: turn || 1,
      diagnostics: { ok: true, count: rows.length, gseqFrom: 0, gseqTo: rows.length - 1 }
    };
  }

  function mark(obj, key, value) {
    try {
      Object.defineProperty(obj, key, {
        value: value, enumerable: false, configurable: true, writable: true
      });
    } catch (err) {
      /* a frozen row: fall back to an enumerable field, correctness first */
      obj[key] = value;
    }
  }

  /* L0 — TEMPORARY. Retire when L1 lands (anaphase owns session identity).
   *
   * Merge several periods into ONE stream, in the given order (the caller
   * passes job ids sorted by first_ts).
   *
   * The whole point is that normalisation happens exactly once, here, after the
   * concatenation. Normalising each period separately would restart gseq at 0
   * for every file, the keys would collide, and every period after the first
   * would be refused as a duplicate — the same bug as chunked normalisation,
   * one scale up. Doing it inside this function makes that unreachable rather
   * than merely discouraged.
   *
   * Each event keeps a non-enumerable `sourceJob` so a renderer can say which
   * period a row came from without the field appearing in the data.
   *
   * Returns the same shape as normalize(): { events, turnCount, diagnostics }.
   */
  function mergeChain(eventsByJob, orderedJobIds) {
    var joined = [];
    var sources = [];
    var lineNos = [];
    var ids = orderedJobIds || [];
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var evs = (eventsByJob && eventsByJob[id]) || [];
      for (var k = 0; k < evs.length; k++) {
        joined.push(evs[k]);
        sources.push(id);
        /* The row's position INSIDE its own file. Recorded here because after
         * concatenation it is gone: gseq is the position in the merged stream,
         * which is a different quantity and changes with the starting point.
         * Identity needs the one that does not change, so it has to be captured
         * before the merge. */
        lineNos.push(k);
      }
    }

    var out = normalize(joined);
    for (var j = 0; j < out.events.length; j++) {
      mark(out.events[j], 'sourceJob', sources[j]);
      mark(out.events[j], 'lineNo', lineNos[j]);
    }
    out.jobCount = ids.length;
    return out;
  }

  /* L0 — TEMPORARY, same as mergeChain: retire when L1 lands.
   *
   * Ordered job ids for the chain containing `startId`, OLDEST FIRST.
   *
   * resume_from points backwards (the newest period names its predecessor), so
   * a naive walk from the clicked period yields newest-first and the merged
   * conversation renders in reverse. That failure is silent: everything is
   * accepted, no counter moves, the text is simply backwards.
   *
   * `seen` terminates on a cycle. ORDERING IS STRUCTURAL, NOT TEMPORAL (ADR-0048 §184): the
   * walk goes root-ward along `parent` and is then reversed, so a period always follows the
   * one it continues from. Time is NOT used — measured, a resuming period can carry an
   * EARLIER first_ts than the one it continues, so a timestamp sort would move it in front
   * of its own ancestor. (This comment used to claim "ordering is by first_ts", which is
   * the opposite of the implementation; `order_contract_test` now guards the sentence.)
   */
  /* The URL hash is a SERIALISATION OF ONE SELECTION STATE, not a route.
   *
   * Key=value rather than path-style (`#/prove-track/run-x`): the panel is a single
   * document with client-side view switching, so a path would imply a hierarchy and
   * a router that do not exist. Key=value is also order-independent and tolerates
   * missing keys — the common case being a view with no period chosen yet — which is
   * the same tolerant-degradation reading the rest of this ecosystem uses.
   *
   * Both functions are pure and TOTAL. An unknown key is ignored and a malformed
   * hash yields an empty state rather than throwing: the panel must still render
   * when the address bar contains something it did not write.
   */
  function parseHash(hash) {
    /* `panel` = 主视图内打开的辅助面板（ADR-0022 N-001：主只有一个，其余是侧板）。
     * `sup` = Flows 检定台内选中的供应商（同一份单一选择状态的可寻址序列化）。
     * 两者都是**加法**：未知键照旧被忽略，畸形 hash 照旧返回空态而不抛。 */
    var out = { view: null, period: null, panel: null, sup: null };
    var raw = String(hash == null ? '' : hash);
    if (raw.charAt(0) === '#') raw = raw.slice(1);
    if (!raw) return out;
    var parts = raw.split('&');
    for (var i = 0; i < parts.length; i++) {
      var eq = parts[i].indexOf('=');
      if (eq < 0) continue;
      var k, v;
      try {
        k = decodeURIComponent(parts[i].slice(0, eq));
        v = decodeURIComponent(parts[i].slice(eq + 1));
      } catch (e) {
        continue; /* malformed percent-encoding: skip the pair, keep the rest */
      }
      if (k === 'view' && v) out.view = v;
      else if (k === 'period' && v) out.period = v;
      else if (k === 'panel' && v) out.panel = v;
      else if (k === 'sup' && v) out.sup = v;
    }
    return out;
  }

  /* Empty fields are omitted, so a view with no period produces `#view=chat`
   * rather than `#view=chat&period=`. A fully empty state returns '' — absent,
   * not a bare '#'. */
  function buildHash(state) {
    var st = state || {};
    var parts = [];
    if (st.view) parts.push('view=' + encodeURIComponent(st.view));
    if (st.period) parts.push('period=' + encodeURIComponent(st.period));
    if (st.panel) parts.push('panel=' + encodeURIComponent(st.panel));
    if (st.sup) parts.push('sup=' + encodeURIComponent(st.sup));
    return parts.length ? '#' + parts.join('&') : '';
  }

  function chainJobIds(periods, startId) {
    var byId = {};
    var list = periods || [];
    /* Keyed by PERIOD ID, not by job_id. `job_id` is a content digest: two runs
     * of one input share it, so keying by it silently drops every run but the
     * last one — measured as the panel showing one row for two experiences.
     * `period_id` is allocated per run, which is what makes the chain walkable. */
    for (var i = 0; i < list.length; i++) { byId[list[i].period_id] = list[i]; }

    /* The window is the LINEAGE PATH: root → the period the human opened.
     *
     * It deliberately does NOT walk forward into descendants or siblings. The
     * previous version breadth-first'd the whole subtree from the root, so every
     * later branch landed in the same window — a brand-new experience appeared
     * inside the old one it had resumed from. Measured on the live store: three
     * roots held 10-period subtrees and two parents had two children each, so
     * opening any of them merged periods the human never opened.
     *
     * Ancestors stay included, so "continue from this period" keeps the context
     * it inherits; what it no longer inherits is a future it did not have yet.
     * One period, one window.
     *
     * NO global timestamp sort, either. Measured on a real 10-node chain: the
     * period that resumes from the root can carry an EARLIER first_ts than the
     * root itself, so sorting by time would move it in front of the period it
     * continues from. The ancestry walk already yields the correct order once
     * reversed — root first, then each period after the one it continues.
     */
    /* FOUR ENDINGS, FOUR NAMES (ADR-0048 §185). The previous version declared a truncation but
     * MEASURED, its discriminating power was 1 of 2 bits: a COMPLETE walk also reported a
     * truncation (the root legitimately has no parent), while a CYCLE and a MISSING START both
     * returned null in silence — i.e. the two structural failures were as silent as the defect
     * this observable was added to remove. Rule ⑮: one `null` may not carry two meanings.
     *   root         the walk reached a node with no parent            (the normal ending)
     *   truncated    a parent exists in the data but is outside the window
     *   cycle        a node repeated                                   (no topological order exists)
     *   start-absent the requested start is not in the window at all
     * The state is recomputed on EVERY call (the old module-level value was never reset, so a
     * stale reading could outlive the walk it described). */
    var path = [], cur = startId, guard = {}, walk;
    if (!byId[cur]) {
      walk = { kind: 'start-absent', at: startId, parent: null, pathLength: 0 };
      path = [];
    } else {
      for (;;) {
        if (guard[cur]) { walk = { kind: 'cycle', at: cur, parent: null, pathLength: path.length }; break; }
        guard[cur] = true;
        path.push(cur);
        var par = byId[cur].parent;
        if (!par) { walk = { kind: 'root', at: cur, parent: null, pathLength: path.length }; break; }
        if (!byId[par]) { walk = { kind: 'truncated', at: cur, parent: par, pathLength: path.length }; break; }
        cur = par;
      }
    }
    LAST_WALK = walk;
    /* COMPATIBILITY, NOW CORRECT: this answers ONLY for a real truncation. It used to fire on a
     * complete walk as well, which is why a caller could not tell success from failure. */
    LAST_TRUNCATION = (walk && walk.kind === 'truncated')
      ? { at: walk.at, parent: walk.parent, reason: 'parent-not-in-window' } : null;
    var out = path.reverse();
    return out;
  }

  window.CxNormalize = {
    /* The caller can ask whether the last walk was truncated (and why) — a silent partial
     * lineage was the defect; this is its observable. */
    lastTruncation: function () { return LAST_TRUNCATION; },
    /* PREFERRED: the walk's ending, one of root | truncated | cycle | start-absent. */
    lastWalk: function () { return LAST_WALK; },
    VERSION: VERSION,
    normalize: normalize,
    mergeChain: mergeChain,
    chainJobIds: chainJobIds,
    parseHash: parseHash,
    buildHash: buildHash,
    checkContiguous: checkContiguous
  };
})();
