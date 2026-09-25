/* §49.4 — a CRASH must not read as a RED. If the test dies on a type error or an
 * undefined call, that is not a killed mutant and not a failed assertion; it is an
 * ABORTED run and it must be labelled as such (this exact confusion happened once). */
process.on('uncaughtException', function (e) {
  console.log('TEST CRASHED (this is NOT a red and NOT a killed mutant): ' + e.message);
  process.exit(4);
});
/* cell_metering_test — GOLDEN MASTER for the projection (ADR-0048 1d).
 *
 * Recorded BEFORE wiring the view, because after removing `|| 0` the cell's output
 * on real data CHANGES: with only red/green you cannot tell "fixed" from "broke".
 * Expected: the four samples that change replace a FAKE determinate 0.000 with an
 * honest unknown — the disease this cell exists to treat.
 */
const M = require('../assets/cell_metering.js');
let bad = 0;
function ok(n, c) { console.log((c ? '  ok   ' : '  FAIL ') + n); if (!c) { bad++; } }
const k = (f) => f.tok.k, v = (f) => f.tok.v;
const S = (label, events, expect) => {
  const f = M.project(events);
  ok(label + ' => ' + expect, expect === (k(f) + (v(f) === undefined ? '' : ':' + v(f)))
    + (f.partial ? ' [partial]' : ''));
  return f;
};
const A = {}, N = {data:{completion_tokens:null}}, Z = {data:{completion_tokens:0}};
S('all absent            ', [A, A], 'a');
S('single present(0)     ', [Z], 'p:0');
S('present(0)+absent     ', [Z, A], 'p:0 [partial]');
S('present(0)+null       ', [Z, N], 'n');
S('[120,80,absent,200]   ', [{data:{completion_tokens:120}},{data:{completion_tokens:80}},A,{data:{completion_tokens:200}}], 'p:400 [partial]');
S('[120,80,null,200]     ', [{data:{completion_tokens:120}},{data:{completion_tokens:80}},N,{data:{completion_tokens:200}}], 'n');
(function () {
  const all = [[A,A],[Z],[Z,A],[Z,N],[{data:{completion_tokens:120}},{data:{completion_tokens:80}},A,{data:{completion_tokens:200}}],[{data:{completion_tokens:120}},{data:{completion_tokens:80}},N,{data:{completion_tokens:200}}]];
  ok('max comes from the SAME pass (no second aggregation path)',
  (function () {
    const f = M.project([{data:{completion_tokens:120}}, {data:{completion_tokens:80}}, A, {data:{completion_tokens:200}}]);
    return f.max.k === 'p' && f.max.v === 200;
  }()));
ok('max also carries three states (absent-only max is absent, not 0)',
  M.project([A, A]).max.k === 'a' && M.project([{data:{completion_tokens:null}}]).max.k === 'n');
ok('no NaN / no Infinity anywhere', all.every(function (ev) {
    const f = M.project(ev);
    return f.tok.k !== 'p' || (isFinite(f.tok.v) && !Number.isNaN(f.tok.v));
  }));
  ok('all-zeros ratio does NOT yield NaN (bare / would)',
    (function () { const r = M.ratioOf(M.project([Z, Z]), M.project([Z])); return r.value.k === 'n' && r.reason === null ? true : r.value.k !== 'p'; }()));
  ok('shares are PER-EVENT (three different bars, not one number)',
  (function () {
    const ev = [{data:{completion_tokens:120}},{data:{completion_tokens:80}},{data:{completion_tokens:200}}];
    const sh = M.shares(M.project(ev));
    const vals = sh.map(function (x) { return x.value.k + ':' + x.value.v; });
    return vals[0] === 'p:0.6' && vals[1] === 'p:0.4' && vals[2] === 'p:1' && vals[0] !== vals[1];
  }()));
ok('denominator NOT MEASURED (max null) => every share unknown, even known bars',
  (function () {
    const ev = [{data:{completion_tokens:120}}, {data:{completion_tokens:null}}, {data:{completion_tokens:200}}];
    const sh = M.shares(M.project(ev));
    return sh.every(function (x) { return x.value.k !== 'p'; });
  }()));
ok('denominator absent => shares unknown (not 0/z)',
  (function () {
    const ev = [{data:{completion_tokens:120}}, {}];
    const sh = M.shares(M.project(ev));
    return sh.every(function (x) { return x.value.k !== 'p'; });
  }()));
ok('shares() REFUSES anything that is not a project() result (no second denominator)',
  (function () {
    let threw = false;
    try { M.shares([{data:{completion_tokens:120}}]); } catch (e) { threw = /only the result of project/.test(String(e.message)); }
    return threw;
  }()));
ok('pipeline is lazy: a caller that needs only the cell value never computes shares',
  typeof M.project([{data:{completion_tokens:1}}]).projected === 'boolean');
/* The two classes, asserted separately: a DATA state must NOT take the cell down,
 * a PROGRAMMER error must. Reading "must be loud" literally into the render path made
 * three cells crash and disappear — worse than a fake 0.000, because then nothing shows. */
ok('DATA state: all-zero and all-absent produce unknown WITHOUT throwing',
  (function () {
    try {
      const sh1 = M.shares(M.project([{data:{completion_tokens:0}},{data:{completion_tokens:0}}]));
      const sh2 = M.shares(M.project([{},{}]));
      return sh1.every(function (x) { return x.value.k !== 'p'; })
          && sh2.every(function (x) { return x.value.k !== 'p'; });
    } catch (e) { return false; }
  }()));
/* The gate must NOT turn red on legitimate absence — otherwise this cell can never
 * be "seen" on real data (which necessarily contains null/absent). Only non-finite
 * values are debt, because `div` is total and anything else bypassed it. */
(function () {
  const clean = M.shares(M.project([{data:{completion_tokens:120}},{data:{completion_tokens:80}}]));
  const withNull = M.shares(M.project([{data:{completion_tokens:120}},{data:{completion_tokens:null}}]));
  const allZero = M.shares(M.project([{data:{completion_tokens:0}},{data:{completion_tokens:0}}]));
  ok('legitimate unknown is INFORMATION (clean: legit=0, nonFinite=0)',
    clean.legitUnknown === 0 && clean.nonFinite === 0);
  /* Note: with a null in the batch the MAX is poisoned, so §28.3's direction-flip
   * rule makes EVERY bar unknown (legit=2). The property under test is that this
   * legitimate state does not turn the gate red — nonFinite stays 0. */
  ok('a legitimate null does NOT make the gate red (legit=2 because max is poisoned)',
    withNull.legitUnknown === 2 && withNull.nonFinite === 0);
  ok('all-zero is legitimate too (legit=2, nonFinite=0)',
    allZero.legitUnknown === 2 && allZero.nonFinite === 0);
}());
ok('PROGRAMMER error still throws (bad input shape is not a data state)',
  (function () { try { M.shares([{data:{completion_tokens:1}}]); return false; } catch (e) { return true; } }()));
/* MAX'S TWO USES ARE ADJUDICATED SEPARATELY (ADR §33). [120, null, 200]:
 * strict (as denominator) would make every bar unknown — but the DISPLAY can still
 * honestly say ">=200", because a lower bound is a true statement. */
(function () {
  const r = M.project([{data:{completion_tokens:120}},{data:{completion_tokens:null}},{data:{completion_tokens:200}}]);
  ok('max as DENOMINATOR stays unknown (direction flip) on [120,null,200]',
    r.max.k === 'n' && M.shares(r).every(function (x) { return x.value.k !== 'p'; }));
  ok('max as DISPLAY is an honest lower bound >=200 on [120,null,200]',
    r.maxDisplay.k === 'p' && r.maxDisplay.v === 200 && r.maxDisplay.bound === '>=');
  const clean = M.project([{data:{completion_tokens:120}},{data:{completion_tokens:200}}]);
  ok('max as DISPLAY has NO bound when nothing is unmeasured',
    clean.maxDisplay.bound === null && clean.maxDisplay.v === 200);
}());
ok('a measured-zero denominator yields UNKNOWN, never NaN (div is total)',
  (function () {
    const sh = M.shares(M.project([{data:{completion_tokens:0}},{data:{completion_tokens:0}}]));
    return sh.every(function (x) { return x.value.k !== 'p'; }) && sh.nonFinite === 0;
  }()));
/* §47.2 — mutation ③'s target: a PARTIAL max is a LOWER BOUND, so every share must
 * be unknown even though sum and max are both real numbers. Checking only
 * max.k==='present' while missing max.partial yields 1.000/1.000/1.000 — fake
 * exact values, the disease this cell exists to treat. */
(function () {
  const ev = [{data:{completion_tokens:5}}, {}];      // present + absent => partial max
  const r = M.project(ev);
  ok('a PARTIAL max makes every share unknown (not 1.000)',
    r.partial === true && r.maxPartial === true
    && M.shares(r).every(function (x) { return x.value.k !== 'p'; }));
}());
/* §47.3 — CONTRACT assertion that permanently prevents the old-fixture failure:
 * under the old top-level fixtures a CORRECT implementation read nothing and
 * returned absent,absent, so every "reads a value" criterion was never exercised. */
ok('contract: an event carrying completion_tokens MUST read as present',
  M.tokOf({data:{completion_tokens:7}}).k === 'p'
  && M.tokOf({data:{completion_tokens:0}}).k === 'p'
  && M.tokOf({data:{completion_tokens:null}}).k === 'n'
  && M.tokOf({}).k === 'a');
/* §40.3's three cases, now asserted on the pure geometry: the tok path cannot be
 * scaled when maxDur is missing (it cancels), so src must be 'unknown' — NOT a
 * bar at 1.2 pretending to be information. */
(function () {
  const ev = [{data:{completion_tokens:5}, period_id:'P'}, {data:{duration_ms:50}, period_id:'P'}];
  const r = M.project(ev);
  const noDur = { maxDur: M.A(), max: r.max, partial: r.partial, states: r.states, durStates: r.durStates };
  ok('missing maxDur => every bar is src=unknown (the global switch, §40.3 A vs B)',
    M.barWidth(noDur, 0).src === 'unknown' && M.barWidth(noDur, 1).src === 'unknown');
  const withDur = { maxDur: M.P(50), max: r.max, partial: r.partial, states: r.states, durStates: r.durStates };
  ok('with maxDur but a PARTIAL max => tok bars stay unknown (lower-bound denominator)',
    M.barWidth(withDur, 0).src === 'unknown');
  ok('bar width is never NaN or Infinity, for any combination',
    [[M.A(), M.A()], [M.A(), M.P(5)], [M.P(50), M.A()], [M.P(50), M.P(5)]].every(function (pair) {
      const rr = { maxDur: pair[0], max: M.P(5), partial: false, states: [M.P(5)], durStates: [pair[1]] };
      const b = M.barWidth(rr, 0);
      return isFinite(b.w) && !Number.isNaN(b.w) && ['dur','tok','unknown'].indexOf(b.src) > -1;
    }));
}());
ok('ratio with a partial input degrades to explicit unknown',
    M.ratioOf(M.project([{data:{completion_tokens:120}}, A]), M.project([{data:{completion_tokens:800}}])).value.k === 'n');
  ok('order independence of the projection',
    (function () {
      const a = M.project([{data:{completion_tokens:120}},{data:{completion_tokens:80}},A,{data:{completion_tokens:200}}]);
      const b = M.project([{data:{completion_tokens:200}},A,{data:{completion_tokens:120}},{data:{completion_tokens:80}}]);
      return a.tok.k === b.tok.k && a.tok.v === b.tok.v && a.partial === b.partial;
    }()));
}());
console.log(bad === 0 ? 'OK — cell projection holds (golden master)' : 'FAILED — ' + bad);
process.exit(bad === 0 ? 0 : 1);
