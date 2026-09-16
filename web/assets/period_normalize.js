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
   * `seen` terminates on a cycle. Ordering is by first_ts with a job-id
   * tiebreak, so the same data always yields the same order.
   */
  function chainJobIds(periods, startId) {
    var byId = {}, children = {}, list = periods || [];
    for (var i = 0; i < list.length; i++) { byId[list[i].job_id] = list[i]; }
    for (var j = 0; j < list.length; j++) {
      var p = list[j];
      if (p.parent && byId[p.parent]) {
        (children[p.parent] = children[p.parent] || []).push(p.job_id);
      }
    }

    /* Backwards to the root: the oldest period is the one nothing points from. */
    var root = startId, guard = {};
    while (byId[root] && byId[root].parent && byId[byId[root].parent] && !guard[root]) {
      guard[root] = true;
      root = byId[root].parent;
    }

    /* Forwards from the root, breadth-first so a branch does not bury a sibling. */
    var out = [], queue = [root], seen = {};
    while (queue.length) {
      var id = queue.shift();
      if (seen[id] || !byId[id]) { continue; }
      seen[id] = true;
      out.push(id);
      var kids = children[id] || [];
      for (var k = 0; k < kids.length; k++) { queue.push(kids[k]); }
    }

    /* NO global timestamp sort. Measured on a real 10-node chain: the period
     * that resumes from the root can carry an EARLIER first_ts than the root
     * itself, so sorting by time moves it in front of the period it continues
     * from — the chain comes out in an order that contradicts resume_from.
     *
     * The walk order is already correct: it starts at the root and visits
     * children after their parent. Siblings are ordered by the API's own
     * ordering, which is newest-first, so reverse each sibling group to read
     * oldest-first within a branch. */
    for (var s = 0; s < out.length; s++) {
      var kids2 = children[out[s]];
      if (kids2 && kids2.length > 1) { kids2.reverse(); }
    }
    return out;
  }

  window.CxNormalize = {
    VERSION: VERSION,
    normalize: normalize,
    mergeChain: mergeChain,
    chainJobIds: chainJobIds,
    checkContiguous: checkContiguous
  };
})();
