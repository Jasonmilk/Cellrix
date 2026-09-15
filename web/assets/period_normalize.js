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

  window.CxNormalize = {
    VERSION: VERSION,
    normalize: normalize,
    checkContiguous: checkContiguous
  };
})();
