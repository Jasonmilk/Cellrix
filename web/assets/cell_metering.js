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
  function tokOf(e) {
    if (!e || !('tok' in e) || e.tok === undefined) { return TS.A(); }
    if (e.tok === null) { return TS.N(); }
    return TS.P(e.tok);
  }
  /* BOTH aggregates the cell needs, from the SAME list, in ONE pass — otherwise the
   * view keeps its own :335 max loop and the cell has TWO aggregation paths, which is
   * guaranteed drift (the "two menus" problem). `max` also carries the three states. */
  function project(events) {
    var list = [];
    for (var i = 0; i < events.length; i++) { list.push(tokOf(events[i])); }
    var folded = TS.fold(list);
    var acc = TS.start();
    for (var j = 0; j < list.length; j++) { acc = { value: TS.max(acc.value, list[j]),
                                                   seenP: acc.seenP, seenA: acc.seenA }; }
    return {
      tok: folded.value,
      max: acc.value,
      partial: folded.partial,
      count: folded.count,
      bound: TS.lowerBound(folded).bound || null
    };
  }
  function ratioOf(a, b) {
    var r = TS.ratio({ value: a.tok, partial: a.partial }, { value: b.tok, partial: b.partial });
    return { value: r.value, reason: r.reason };
  }
  return { tokOf: tokOf, project: project, ratioOf: ratioOf };
}));
