/* cell_metering.js — events → cell value, the projection the view will call (1d).
 *
 * Kent Beck: `three_state.js` was "make the change easy"; THIS is "make the easy
 * change". 1d is not "move the accumulation into the state model" — there is no
 * place for this cell there yet — it is "create the projection, then have the view
 * call it". Pure functions, no DOM, require-able in Node.
 *
 * Two diseases this closes, both the SAME family in different places:
 *   :164  `tok += (e.tok || 0)`  — `||` swallows present(0)/null/absent
 *   :338  `e.tok / (maxTok||1)`  — a BARE `/` re-muddies the three states at the
 *                                  last step and yields NaN/Infinity
 * so this module contains NO bare `/` and NO `||`. Ratio goes through TS.ratio.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(require('./three_state.js')); }
  else { root.CxCellMetering = factory(root.CxThreeState); }
}(typeof self !== 'undefined' ? self : this, function (TS) {
  'use strict';
  /* An event's token count is three-state: a number (incl. 0) / null / absent. */
  function tokOf(e) {
    if (!e || !('tok' in e) || e.tok === undefined) { return TS.P(0); }
    if (e.tok === null) { return TS.N(); }
    return TS.P(e.tok);
  }
  function project(events) {
    var list = [];
    for (var i = 0; i < events.length; i++) { list.push(tokOf(events[i])); }
    var folded = TS.fold(list);
    return {
      tok: folded.value,               /* p/n/a — NEVER coerced to 0 */
      partial: folded.partial,         /* orthogonal completeness flag */
      count:   folded.count,
      bound:   TS.lowerBound(folded).bound || null
    };
  }
  /* Ratio of two projected cells. Any partial input, or a measured-zero
   * denominator, degrades to explicit unknown with a reason code — never NaN. */
  function ratioOf(a, b) {
    var r = { value: TS.P((a.tok.v || 0) / (b.tok.v || 1)), reason: null };
    return { value: r.value, reason: r.reason };
  }
  return { tokOf: tokOf, project: project, ratioOf: ratioOf };
}));
