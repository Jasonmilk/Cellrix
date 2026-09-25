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
    var acc = TS.start(), seenPMax = false, seenAMax = false;
    for (var j = 0; j < list.length; j++) {
      if (list[j].k === 'p') { seenPMax = true; }
      if (list[j].k === 'a') { seenAMax = true; }
      acc = { value: TS.max(acc.value, list[j]), seenP: seenPMax, seenA: seenAMax };
    }
    return {
      tok: folded.value,
      max: acc.value,
      maxPartial: seenAMax && seenPMax,
      partial: folded.partial,
      count: folded.count,
      bound: TS.lowerBound(folded).bound || null
    };
  }
  function ratioOf(a, b) {
    var r = TS.ratio({ value: a.tok, partial: a.partial }, { value: b.tok, partial: b.partial });
    return { value: r.value, reason: r.reason };
  }
  /* PER-EVENT SHARES — `:338` is a share BAR, not a whole-cell ratio: [120,80,200]
   * shows 0.600/0.400/1.000, three different numbers. Replacing it with
   * ratioOf(sum, max) would make every bar identical — a USER-VISIBLE SEMANTIC
   * CHANGE, not a bug fix. So each event goes through the three states on its own,
   * against the same denominator.
   *
   * And the denominator carries the direction-flip rule: if the MAX was not
   * measured (absent/null) or is only a lower bound (partial), then even a known
   * bar's share is unknown — the denominator being a bound flips the direction. */
  /* ONE aggregation path: `shares` derives the denominator ITSELF, so a caller
   * cannot pass the sum where the max belongs (that bug happened once already). */
  function shares(events) {
    var p = project(events);
    var denomPartial = p.maxPartial;
    var denom = p.max;
    var out = [];
    for (var i = 0; i < events.length; i++) {
      var num = tokOf(events[i]);
      if (denomPartial || denom.k !== 'p') {
        out.push({ value: denom.k === 'a' ? TS.A() : TS.N(), reason: 'denominator-not-measured' });
      } else if (denom.v === 0) {
        out.push({ value: TS.N(), reason: 'denominator-zero' });
      } else if (num.k !== 'p') {
        out.push({ value: num.k === 'a' ? TS.A() : TS.N(), reason: 'numerator-not-measured' });
      } else {
        out.push({ value: TS.div(num, denom), reason: null });
      }
    }
    return out;
  }
  return { tokOf: tokOf, project: project, ratioOf: ratioOf, shares: shares };
}));
