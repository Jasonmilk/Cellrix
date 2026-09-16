/* Node construction — Cellrix:ADR-0018 batch 1.
 *
 * The layer between the contract and the tape. `interpret` (in event_family)
 * turns a protocol name into a semantic kind and a payload; this turns a raw
 * event stream into the Node stream a target projects from.
 *
 *   kind      semantic, selectable, not re-interpretable
 *   payload   interpreted through the contract
 *   node      identity: sourceJob#lineNo — stable across reads
 *   ord       stream position — not identity
 *   lineNo    position inside the source file, kept for export
 *   turn      display grouping only
 *   ts        event time
 *
 * Split out of assembly.js when that file crossed its 400-line red line. By
 * responsibility, not by function kind: nothing here touches tape state, and
 * assembly.js's state machine reaches it only through this namespace.
 *
 * Depends on CxEventFamily. Must load after it and before assembly.js.
 */
(function () {
  'use strict';

  var EF = window.CxEventFamily;
  if (!EF) {
    throw new Error('node_shape.js requires event_family.js to load first');
  }

  function deriveCoordinates(events, meta) {
    var jobId = (meta && meta.job_id) || 'run';
    var out = [];
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      /* turn is display grouping, derived at the read boundary when present. */
      var turn = (typeof e.turn === 'number')
        ? e.turn
        : countsUpTo(events, i, EF.TYPES.TURN_START);
      var interp = EF.interpret(e.type, e.data);

      /* Identity anchors INSIDE the source file; `ord` is the position in this
       * stream. Welding them together (jobId#gseq) made one event read
       * differently depending on where the read began — the determinism
       * violation. `sourceJob`/`lineNo` survive the merge; gseq does not.
       *
       * CAVEAT (a period can be rewritten in place): re-sending the same input
       * derives the same job id and TRUNCATES the file, so `B#3` can come to
       * mean a different event. Identity is therefore valid WITHIN one read of
       * one digest — when the digest changes, rebuild rather than patch by id. */
      var src = e.sourceJob || jobId;
      var line = (typeof e.lineNo === 'number') ? e.lineNo : e.seq;
      out.push({
        kind: interp ? interp.kind : null,
        payload: interp ? interp.payload : null,
        /* `node` is the key a consumer compares and puts in an attribute; it is
         * a pure function of the two parts below, which are kept apart because
         * a GROUPING and an EXPORT need the part, not the key. Without `source`
         * a turn header in a merged chain could not say which period it came
         * from, and an exported row could not cite the file it came from —
         * both would have to split the key back apart on `#`. */
        node: src + '#' + line,
        source: src,
        ord: i,
        lineNo: line,
        turn: 't' + turn,
        ts: e.time || null
      });
    }
    return out;
  }
  var OPENING_TURN = 1;
  function countsUpTo(events, upto, type) {
    var n = 0;
    for (var i = 0; i <= upto; i++) {
      if (events[i].type === type) n++;
    }
    return n === 0 ? OPENING_TURN : n;
  }

  window.CxNodeShape = {
    deriveCoordinates: deriveCoordinates,
    countsUpTo: countsUpTo,
    OPENING_TURN: OPENING_TURN
  };
})();
