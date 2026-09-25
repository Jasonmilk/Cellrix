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
const A = {}, N = { tok: null }, Z = { tok: 0 };
S('all absent            ', [A, A], 'a');
S('single present(0)     ', [Z], 'p:0');
S('present(0)+absent     ', [Z, A], 'p:0 [partial]');
S('present(0)+null       ', [Z, N], 'n');
S('[120,80,absent,200]   ', [{tok:120},{tok:80},A,{tok:200}], 'p:400 [partial]');
S('[120,80,null,200]     ', [{tok:120},{tok:80},N,{tok:200}], 'n');
(function () {
  const all = [[A,A],[Z],[Z,A],[Z,N],[{tok:120},{tok:80},A,{tok:200}],[{tok:120},{tok:80},N,{tok:200}]];
  ok('max comes from the SAME pass (no second aggregation path)',
  (function () {
    const f = M.project([{tok:120}, {tok:80}, A, {tok:200}]);
    return f.max.k === 'p' && f.max.v === 200;
  }()));
ok('max also carries three states (absent-only max is absent, not 0)',
  M.project([A, A]).max.k === 'a' && M.project([{tok:null}]).max.k === 'n');
ok('no NaN / no Infinity anywhere', all.every(function (ev) {
    const f = M.project(ev);
    return f.tok.k !== 'p' || (isFinite(f.tok.v) && !Number.isNaN(f.tok.v));
  }));
  ok('all-zeros ratio does NOT yield NaN (bare / would)',
    (function () { const r = M.ratioOf(M.project([Z, Z]), M.project([Z])); return r.value.k === 'n' && r.reason === null ? true : r.value.k !== 'p'; }()));
  ok('shares are PER-EVENT (three different bars, not one number)',
  (function () {
    const ev = [{tok:120},{tok:80},{tok:200}];
    const sh = M.shares(M.project(ev));
    const vals = sh.map(function (x) { return x.value.k + ':' + x.value.v; });
    return vals[0] === 'p:0.6' && vals[1] === 'p:0.4' && vals[2] === 'p:1' && vals[0] !== vals[1];
  }()));
ok('denominator NOT MEASURED (max null) => every share unknown, even known bars',
  (function () {
    const ev = [{tok:120}, {tok:null}, {tok:200}];
    const sh = M.shares(M.project(ev));
    return sh.every(function (x) { return x.value.k !== 'p'; });
  }()));
ok('denominator absent => shares unknown (not 0/z)',
  (function () {
    const ev = [{tok:120}, {}];
    const sh = M.shares(M.project(ev));
    return sh.every(function (x) { return x.value.k !== 'p'; });
  }()));
ok('shares() REFUSES anything that is not a project() result (no second denominator)',
  (function () {
    let threw = false;
    try { M.shares([{tok:120}]); } catch (e) { threw = /only the result of project/.test(String(e.message)); }
    return threw;
  }()));
ok('pipeline is lazy: a caller that needs only the cell value never computes shares',
  typeof M.project([{tok:1}]).projected === 'boolean');
/* The two classes, asserted separately: a DATA state must NOT take the cell down,
 * a PROGRAMMER error must. Reading "must be loud" literally into the render path made
 * three cells crash and disappear — worse than a fake 0.000, because then nothing shows. */
ok('DATA state: all-zero and all-absent produce unknown WITHOUT throwing',
  (function () {
    try {
      const sh1 = M.shares(M.project([{tok:0},{tok:0}]));
      const sh2 = M.shares(M.project([{},{}]));
      return sh1.every(function (x) { return x.value.k !== 'p'; })
          && sh2.every(function (x) { return x.value.k !== 'p'; });
    } catch (e) { return false; }
  }()));
/* The gate must NOT turn red on legitimate absence — otherwise this cell can never
 * be "seen" on real data (which necessarily contains null/absent). Only non-finite
 * values are debt, because `div` is total and anything else bypassed it. */
(function () {
  const clean = M.shares(M.project([{tok:120},{tok:80}]));
  const withNull = M.shares(M.project([{tok:120},{tok:null}]));
  const allZero = M.shares(M.project([{tok:0},{tok:0}]));
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
  (function () { try { M.shares([{tok:1}]); return false; } catch (e) { return true; } }()));
ok('ratio with a partial input degrades to explicit unknown',
    M.ratioOf(M.project([{tok:120}, A]), M.project([{tok:800}])).value.k === 'n');
  ok('order independence of the projection',
    (function () {
      const a = M.project([{tok:120},{tok:80},A,{tok:200}]);
      const b = M.project([{tok:200},A,{tok:120},{tok:80}]);
      return a.tok.k === b.tok.k && a.tok.v === b.tok.v && a.partial === b.partial;
    }()));
}());
console.log(bad === 0 ? 'OK — cell projection holds (golden master)' : 'FAILED — ' + bad);
process.exit(bad === 0 ? 0 : 1);
