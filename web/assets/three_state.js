/* three_state.js — the three-state algebra as PURE FUNCTIONS (ADR-0048 §23-§25).
 *
 * No DOM, no globals, require-able in Node. This is the first deliverable of the
 * tracer bullet, not "preparation": it is a product that can be mutated, so the
 * mutation loop has something to inject into.
 *
 * States: p = present(v) (a real measurement, including 0) · n = null (EXPLICITLY
 * unknown) · a = absent (NOT RECORDED). Rules (ADR-0048 §23.3/§24.4/§25.3):
 *   a contributes nothing; n poisons; all-a is a, NOT present(0)   <- the `|| 0` bug.
 * The completeness flag is carried THROUGH the fold, never recomputed at the end:
 * computing it at the end broke commutativity in the reviewer's own first version.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.CxThreeState = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var P = function (v) { return { k: 'p', v: v }; };
  var N = function () { return { k: 'n' }; };
  var A = function () { return { k: 'a' }; };

  function add(x, y) {
    if (x.k === 'n' || y.k === 'n') { return N(); }          // poison
    if (x.k === 'a' && y.k === 'a') { return A(); }          // NOT P(0)
    if (x.k === 'a') { return P(y.v); }
    if (y.k === 'a') { return P(x.v); }
    return P(x.v + y.v);
  }
  function max(x, y) {
    if (x.k === 'n' || y.k === 'n') { return N(); }
    if (x.k === 'a' && y.k === 'a') { return A(); }
    if (x.k === 'a') { return P(y.v); }
    if (y.k === 'a') { return P(x.v); }
    return P(Math.max(x.v, y.v));
  }
  /* Total function: NEVER NaN, NEVER Infinity (ADR-0048 §24.4). */
  function div(x, y) {
    if (x.k === 'n' || y.k === 'n') { return N(); }
    if (y.k === 'p' && y.v === 0) { return N(); }            // measured zero denom
    if (x.k === 'a' && y.k === 'a') { return A(); }
    if (y.k === 'a') { return A(); }
    if (x.k === 'a') { return A(); }
    return P(x.v / y.v);
  }
  /* fold carries {value, seenP, seenA}; `partial` is DERIVED from the carried
   * flags, so permuting the input cannot change the result. */
  function fold(list, op) {
    var f = op || add;
    var acc = { k: 'a' }, seenP = false, seenA = false;
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (it.k === 'p') { seenP = true; }
      if (it.k === 'a') { seenA = true; }
      acc = f(acc, it);
    }
    return { value: acc, partial: seenP && seenA, count: list.length };
  }
  /* Summation is the ONLY place where a partial result may be shown as a lower
   * bound (ADR-0048 §25.3). A ratio must degrade to explicit unknown instead,
   * because the lower bound FLIPS DIRECTION under division. */
  function lowerBound(folded) {
    if (folded.partial) { return folded.value.k === 'p' ? { k: 'p', v: folded.value.v, bound: '>=' } : folded.value; }
    return folded.value;
  }
  function ratio(a, b) {
    if (a.partial || b.partial) { return { value: N(), reason: 'partial-input' }; }
    return { value: div(a.value, b.value), reason: null };
  }
  return { P: P, N: N, A: A, add: add, max: max, div: div, fold: fold,
           lowerBound: lowerBound, ratio: ratio };
}));
