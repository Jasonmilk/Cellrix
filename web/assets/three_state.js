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
  /* P IS THE ALGEBRA'S ONLY ENTRY POINT, so its domain is a PRECONDITION of every invariant
   * downstream (ADR-0048 §135). `+` on a string is CONCATENATION, not addition: with
   * P('5') the monoid loses even commutativity ('5'+7 = '57', 7+'5 = '75'), and a total of
   * "120" is a FALSE statement — the same class as the [-5,null,7] => "2 >=" fixed in §134.
   * A non-finite number breaks §24.4 verbatim ('NEVER NaN, NEVER Infinity'). This is a
   * PROGRAMMER error (rule ⑩: mandatory means throw, no default); a DATA value that is not
   * a finite number is handled upstream by readChain as INAPPLICABLE, not here. */
  var P = function (v) {
    if (typeof v !== 'number' || !isFinite(v)) {
      throw new Error('P(): a measured quantity must be a FINITE NUMBER, got '
        + (typeof v) + ' ' + String(v) + ' (ADR-0048 §135: the domain is a precondition).');
    }
    return { k: 'p', v: v };
  };
  /* A PRESENT VALUE THAT IS NOT AN ARITHMETIC QUANTITY (ADR-0048 §135): the run mode is a
   * narrative fact ('drive'), not a magnitude. It gets its OWN constructor so that the two
   * can never be confused: `P` stays a finite-number domain (so `add` can rely on it), and a
   * Pstr fed into `add` still throws loudly (make illegal states unrepresentable). */
  var Pstr = function (v) { return { k: 'p', v: v }; };
  var N = function () { return { k: 'n' }; };
  var A = function () { return { k: 'a' }; };

  /* UNMEASURED DOES NOT POISON A SUM (ADR-0048 §131). The old rule `n || n => N()` DISCARDED
   * the measured part: fold([P5, P7, N]) returned "unmeasured" while fold([P5, P7, A]) returned
   * the honest "12 >=". Same partial knowledge, two answers, one of them throwing away what was
   * measured. The measured part survives; what the N contributes is a LOWER BOUND, which is
   * carried by `seenN` + `lowerBound` — exactly how the max side was already fixed
   * ("Judging it on the strict (poisoned) max was a real bug", cell_metering.js).
   * A sum is the ONE aggregation where a lower bound is legitimate; division still poisons,
   * because a lower bound FLIPS DIRECTION under division (§25.3). */
  function add(x, y) {
    if (x.k === 'a' && y.k === 'a') { return A(); }          // NOT P(0)
    if (x.k === 'a') { return y; }                           // incl. N(): a lone N stays N
    if (y.k === 'a') { return x; }
    if (x.k === 'n' && y.k === 'n') { return N(); }          // nothing measured anywhere
    if (x.k === 'n') { return P(y.v); }                      // the measured part survives
    if (y.k === 'n') { return P(x.v); }
    var sum = x.v + y.v;
    /* §24.4 IS A PREDICATE ON THE OUTPUT TOO (ADR-0048 §135): finite inputs can OVERFLOW
     * (1e308 + 1e308 = Infinity). Returning N() is the honest answer — the value is outside
     * the representable domain, so no number may be stated (measured: my own §135 assertion
     * caught this, the guard alone did not). */
    return isFinite(sum) ? P(sum) : N();
  }
  function max(x, y) {
    /* SAME INVARIANT, SAME RULE (the two channels must not disagree). */
    if (x.k === 'a' && y.k === 'a') { return A(); }
    if (x.k === 'a') { return y; }
    if (y.k === 'a') { return x; }
    if (x.k === 'n' && y.k === 'n') { return N(); }
    if (x.k === 'n') { return P(y.v); }
    if (y.k === 'n') { return P(x.v); }
    return P(Math.max(x.v, y.v));   /* max never overflows (no new magnitude) */
  }
  /* Total function: NEVER NaN, NEVER Infinity (ADR-0048 §24.4). */
  function div(x, y) {
    if (x.k === 'n' || y.k === 'n') { return N(); }
    if (y.k === 'p' && y.v === 0) { return N(); }            // measured zero denom
    if (x.k === 'a' && y.k === 'a') { return A(); }
    if (y.k === 'a') { return A(); }
    if (x.k === 'a') { return A(); }
    var q = x.v / y.v;
    return isFinite(q) ? P(q) : N();   /* §24.4 on the output: no NaN, no Infinity */
  }
  /* INCREMENTAL STEP: the accumulator carries the flags, so a per-event loop
   * (which is exactly what 1d does) preserves them. Without this, a mutant that
   * recomputes `partial` at the end is EXTENSIONALLY EQUAL over a batch fold —
   * the exemption I granted was scoped to that observation surface alone, which is
   * not a legitimate exemption: `add`/`step` are the public surface the caller uses. */
  function step(acc, item) {
    return { value: add(acc.value, item),
             seenP: acc.seenP || item.k === 'p',
             seenA: acc.seenA || item.k === 'a',
             seenN: acc.seenN || item.k === 'n' };   /* `seenN` was MISSING: without it the
                                                     * lower bound could never fire on a null. */
  }
  function start() { return { value: A(), seenP: false, seenA: false, seenN: false }; }
  /* fold is a thin loop over `step`; `partial` is read off the CARRIED flags. */
  function fold(list) {
    var acc = start();
    for (var i = 0; i < list.length; i++) { acc = step(acc, list[i]); }
    /* PARTIAL = measured + (absent OR unmeasured): both kinds of "not measured here"
     * make the total a lower bound rather than a total. */
    return { value: acc.value, partial: acc.seenP && (acc.seenA || acc.seenN),
             count: list.length };
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
  return { P: P, Pstr: Pstr, N: N, A: A, add: add, max: max, div: div, fold: fold,
           start: start, step: step,
           lowerBound: lowerBound, ratio: ratio };
}));
