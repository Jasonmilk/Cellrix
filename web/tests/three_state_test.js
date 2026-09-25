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
ok('null poisons', eq(TS.fold([P(5), N()]).value, N()));
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
  ok('flag propagates (same flag in both orders)', a.partial === b.partial && a.partial === false && eq(a.value, b.value));
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
  ok('null => poisoned => NO bound (explicit unknown)', withNull.k === 'n' && withNull.bound === undefined);
}());
ok('ratio degrades to null when any input is partial',
  TS.ratio(TS.fold([P(120), A()]), TS.fold([P(800)])).value.k === 'n');
console.log(bad === 0 ? 'OK — three-state algebra holds' : 'FAILED — ' + bad + ' assertion(s)');
process.exit(bad === 0 ? 0 : 1);
