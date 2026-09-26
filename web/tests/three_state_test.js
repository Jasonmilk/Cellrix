/* three_state_test — observes the algebra at the points where the states are
 * ACTUALLY distinguishable (ADR-0048 §24/§25 + the reviewer's mutation finding).
 *
 * CRITICAL: do NOT observe via the sum. 0 is the additive identity, so on the
 * "sum" observation point present(0) and absent are algebraically identical and
 * EVERY mutant survives — a criterion that looks complete and catches nothing.
 * Observe via the completeness FLAG and the COUNT instead.
 */

/* ── EQUIVALENT MUTANT, recorded and counted (not chased) ────────────────────
 * Mutation: compute `partial` by scanning the list at the END instead of carrying
 * the flag through the fold. It SURVIVES these tests, and that is NOT a coverage
 * gap: with a BATCH `fold(list)` API the two are extensionally equal, so the
 * mutant is equivalent. It only becomes distinguishable under a STREAMING /
 * incremental API (where the flag must survive across calls), which this cell does
 * not have. Per ADR-0048 §24.2 the order-independence assertion stays; per the
 * reviewer's third finding, survival is recorded here rather than treated as a
 * defect to chase. If an incremental API is ever added, this mutant must die.
 */
const TS = require('../assets/three_state.js');
const P = TS.P, N = TS.N, A = TS.A;
let bad = 0;
function ok(name, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + name); if (!cond) { bad++; } }
const eq = (x, y) => x.k === y.k && x.v === y.v;

ok('all-absent is absent, NOT present(0)  [the || 0 bug]', eq(TS.fold([A(), A()]).value, A()));
ok('absent contributes nothing', eq(TS.fold([P(5), A()]).value, P(5)));
/* ADR §133: a null does NOT poison an aggregation — the measured part survives and the
 * result becomes a LOWER BOUND (ISO/IEC 9075: aggregates ignore NULL; interval enclosure
 * 5 + u ∈ [5, +∞) for u ≥ 0). Only 'nothing measured anywhere' stays unknown. */
ok('null does NOT poison: the measured part survives', eq(TS.fold([P(5), N()]).value, P(5)));
ok('[N,N] IS unknown: nothing measured anywhere (the one case that stays unknown)',
  eq(TS.fold([N(), N()]).value, N()));
ok('[A,A] is absent, not unknown (applicability and measurement are different facts)',
  eq(TS.fold([A(), A()]).value, A()));
ok('closure: every result is p/n/a', [P(0), P(1), N(), A()].every(function (x) {
  return [P(0), P(1), N(), A()].every(function (y) {
    return ['p', 'n', 'a'].indexOf(TS.add(x, y).k) > -1;
  });
}));
(function () {
  let comm = true, assoc = true;
  const xs = [P(0), P(2), N(), A()];
  for (const x of xs) { for (const y of xs) {
    if (!eq(TS.add(x, y), TS.add(y, x))) { comm = false; }
    for (const z of xs) { if (!eq(TS.add(TS.add(x, y), z), TS.add(x, TS.add(y, z)))) { assoc = false; } }
  } }
  ok('commutativity', comm); ok('associativity', assoc);
}());
ok('division never yields NaN/Infinity', [P(0), P(5), N(), A()].every(function (x) {
  return [P(0), P(2), N(), A()].every(function (y) {
    const r = TS.div(x, y);
    return r.k !== 'p' || (isFinite(r.v) && !Number.isNaN(r.v));
  });
}));
(function () {
  const a = TS.fold([P(1), N(), P(2)]);
  const b = TS.fold([P(2), P(1), N()]);
  /* PROPERTY KEPT, OVERRULED VALUE DROPPED (§133): the flag must travel WITH the value and
   * be order-independent; `partial === false` was asserting the overruled poisoning rule. */
  ok('flag propagates with the value, order-independently',
    a.partial === b.partial && eq(a.value, b.value) && eq(a.value, P(3)));
}());
(function () {  /* order independence, all permutations */
  const perm = [[P(120), P(80), N(), P(200)], [N(), P(200), P(120), P(80)],
                [P(80), N(), P(200), P(120)], [P(200), P(120), P(80), N()]];
  const base = TS.fold(perm[0]);
  ok('order independence (value AND flag)',
    perm.every(function (r) { const f = TS.fold(r); return eq(f.value, base.value) && f.partial === base.partial; }));
}());
(function () {  /* the identity trap: sum is equal by design, flag/count is not */
  const onlyZero = TS.fold([P(0), P(0)]);
  const zeroPlusAbsent = TS.fold([P(0), A()]);
  ok('present(0)+present(0) differs from present(0)+absent AT THE OBSERVATION POINT',
    eq(onlyZero.value, zeroPlusAbsent.value) && onlyZero.partial !== zeroPlusAbsent.partial);
}());
/* The observation point again: a NULL poisons (no bound to give), an ABSENT makes
 * it partial (a lower bound IS truthful). Using N() here tested nothing. */
(function () {
  const withAbsent = TS.lowerBound(TS.fold([P(120), P(80), A(), P(200)]));
  ok('absent => partial => explicit lower bound >=400',
    withAbsent.k === 'p' && withAbsent.v === 400 && withAbsent.bound === '>=');
  const withNull = TS.lowerBound(TS.fold([P(120), P(80), N(), P(200)]));
  /* THE SAME COGNITIVE SITUATION, THE SAME ANSWER (§133): absent and null both mean 'this row
   * was not measured', so both must yield the IDENTICAL lower bound — the point of the fix
   * was that [P,N,P] and [P,A,P] must not disagree. */
  ok('null => partial => explicit lower bound >=400 (identical to the absent case)',
    withNull.k === 'p' && withNull.v === 400 && withNull.bound === '>=');
  ok('absent and null give the SAME bound (no per-state divergence)',
    withNull.k === withAbsent.k && withNull.v === withAbsent.v && withNull.bound === withAbsent.bound);
}());
/* The point where "carry the flag" and "scan for any absent" actually DIFFER:
 * partial requires BOTH an absent AND a present. Scanning for "any absent" makes an
 * all-absent fold call itself partial. (An earlier attempt to add these silently
 * inserted NOTHING because its anchor no longer existed — the claim that the mutant
 * was killed was therefore false until this assertion existed.) */
ok('partial requires BOTH: an all-absent fold is NOT partial',
  TS.fold([A(), A()]).partial === false);
ok('partial requires BOTH: present-only is NOT partial',
  TS.fold([P(1), P(2)]).partial === false);
ok('ratio degrades to null when any input is partial',
  TS.ratio(TS.fold([P(120), A()]), TS.fold([P(800)])).value.k === 'n');
console.log(bad === 0 ? 'OK — three-state algebra holds' : 'FAILED — ' + bad + ' assertion(s)');
process.exit(bad === 0 ? 0 : 1);
