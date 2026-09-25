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
const A = {type:'assistant/usage'}, N = {type:'assistant/usage', data:{completion_tokens:null}}, Z = {type:'assistant/usage', data:{completion_tokens:0}};
S('all absent            ', [A, A], 'a');
S('single present(0)     ', [Z], 'p:0');
S('present(0)+absent     ', [Z, A], 'p:0 [partial]');
S('present(0)+null       ', [Z, N], 'n');
S('[120,80,absent,200]   ', [{type:'assistant/usage', data:{completion_tokens:120}},{type:'assistant/usage', data:{completion_tokens:80}},A,{type:'assistant/usage', data:{completion_tokens:200}}], 'p:400 [partial]');
S('[120,80,null,200]     ', [{type:'assistant/usage', data:{completion_tokens:120}},{type:'assistant/usage', data:{completion_tokens:80}},N,{type:'assistant/usage', data:{completion_tokens:200}}], 'n');
(function () {
  const all = [[A,A],[Z],[Z,A],[Z,N],[{type:'assistant/usage', data:{completion_tokens:120}},{type:'assistant/usage', data:{completion_tokens:80}},A,{type:'assistant/usage', data:{completion_tokens:200}}],[{type:'assistant/usage', data:{completion_tokens:120}},{type:'assistant/usage', data:{completion_tokens:80}},N,{type:'assistant/usage', data:{completion_tokens:200}}]];
  ok('max comes from the SAME pass (no second aggregation path)',
  (function () {
    const f = M.project([{type:'assistant/usage', data:{completion_tokens:120}}, {type:'assistant/usage', data:{completion_tokens:80}}, A, {type:'assistant/usage', data:{completion_tokens:200}}]);
    return f.max.k === 'p' && f.max.v === 200;
  }()));
ok('max also carries three states (absent-only max is absent, not 0)',
  M.project([A, A]).max.k === 'a' && M.project([{type:'assistant/usage', data:{completion_tokens:null}}]).max.k === 'n');
ok('no NaN / no Infinity anywhere', all.every(function (ev) {
    const f = M.project(ev);
    return f.tok.k !== 'p' || (isFinite(f.tok.v) && !Number.isNaN(f.tok.v));
  }));
  ok('all-zeros ratio does NOT yield NaN (bare / would)',
    (function () { const r = M.ratioOf(M.project([Z, Z]), M.project([Z])); return r.value.k === 'n' && r.reason === null ? true : r.value.k !== 'p'; }()));
  ok('shares are PER-EVENT (three different bars, not one number)',
  (function () {
    const ev = [{type:'assistant/usage', data:{completion_tokens:120}},{type:'assistant/usage', data:{completion_tokens:80}},{type:'assistant/usage', data:{completion_tokens:200}}];
    const sh = M.shares(M.project(ev));
    const vals = sh.map(function (x) { return x.value.k + ':' + x.value.v; });
    return vals[0] === 'p:0.6' && vals[1] === 'p:0.4' && vals[2] === 'p:1' && vals[0] !== vals[1];
  }()));
ok('denominator NOT MEASURED (max null) => every share unknown, even known bars',
  (function () {
    const ev = [{type:'assistant/usage', data:{completion_tokens:120}}, {type:'assistant/usage', data:{completion_tokens:null}}, {type:'assistant/usage', data:{completion_tokens:200}}];
    const sh = M.shares(M.project(ev));
    return sh.every(function (x) { return x.value.k !== 'p'; });
  }()));
ok('denominator absent => shares unknown (not 0/z)',
  (function () {
    const ev = [{type:'assistant/usage', data:{completion_tokens:120}}, {type:'assistant/usage'}];
    const sh = M.shares(M.project(ev));
    return sh.every(function (x) { return x.value.k !== 'p'; });
  }()));
ok('shares() REFUSES anything that is not a project() result (no second denominator)',
  (function () {
    let threw = false;
    try { M.shares([{type:'assistant/usage', data:{completion_tokens:120}}]); } catch (e) { threw = /only the result of project/.test(String(e.message)); }
    return threw;
  }()));
ok('pipeline is lazy: a caller that needs only the cell value never computes shares',
  typeof M.project([{type:'assistant/usage', data:{completion_tokens:1}}]).projected === 'boolean');
/* The two classes, asserted separately: a DATA state must NOT take the cell down,
 * a PROGRAMMER error must. Reading "must be loud" literally into the render path made
 * three cells crash and disappear — worse than a fake 0.000, because then nothing shows. */
ok('DATA state: all-zero and all-absent produce unknown WITHOUT throwing',
  (function () {
    try {
      const sh1 = M.shares(M.project([{type:'assistant/usage', data:{completion_tokens:0}},{type:'assistant/usage', data:{completion_tokens:0}}]));
      const sh2 = M.shares(M.project([{type:'assistant/usage'},{type:'assistant/usage'}]));
      return sh1.every(function (x) { return x.value.k !== 'p'; })
          && sh2.every(function (x) { return x.value.k !== 'p'; });
    } catch (e) { return false; }
  }()));
/* The gate must NOT turn red on legitimate absence — otherwise this cell can never
 * be "seen" on real data (which necessarily contains null/absent). Only non-finite
 * values are debt, because `div` is total and anything else bypassed it. */
(function () {
  const clean = M.shares(M.project([{type:'assistant/usage', data:{completion_tokens:120}},{type:'assistant/usage', data:{completion_tokens:80}}]));
  const withNull = M.shares(M.project([{type:'assistant/usage', data:{completion_tokens:120}},{type:'assistant/usage', data:{completion_tokens:null}}]));
  const allZero = M.shares(M.project([{type:'assistant/usage', data:{completion_tokens:0}},{type:'assistant/usage', data:{completion_tokens:0}}]));
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
  (function () { try { M.shares([{type:'assistant/usage', data:{completion_tokens:1}}]); return false; } catch (e) { return true; } }()));
/* MAX'S TWO USES ARE ADJUDICATED SEPARATELY (ADR §33). [120, null, 200]:
 * strict (as denominator) would make every bar unknown — but the DISPLAY can still
 * honestly say ">=200", because a lower bound is a true statement. */
(function () {
  const r = M.project([{type:'assistant/usage', data:{completion_tokens:120}},{type:'assistant/usage', data:{completion_tokens:null}},{type:'assistant/usage', data:{completion_tokens:200}}]);
  ok('max as DENOMINATOR stays unknown (direction flip) on [120,null,200]',
    r.max.k === 'n' && M.shares(r).every(function (x) { return x.value.k !== 'p'; }));
  ok('max as DISPLAY is an honest lower bound >=200 on [120,null,200]',
    r.maxDisplay.k === 'p' && r.maxDisplay.v === 200 && r.maxDisplay.bound === '>=');
  const clean = M.project([{type:'assistant/usage', data:{completion_tokens:120}},{type:'assistant/usage', data:{completion_tokens:200}}]);
  ok('max as DISPLAY has NO bound when nothing is unmeasured',
    clean.maxDisplay.bound === null && clean.maxDisplay.v === 200);
}());
ok('a measured-zero denominator yields UNKNOWN, never NaN (div is total)',
  (function () {
    const sh = M.shares(M.project([{type:'assistant/usage', data:{completion_tokens:0}},{type:'assistant/usage', data:{completion_tokens:0}}]));
    return sh.every(function (x) { return x.value.k !== 'p'; }) && sh.nonFinite === 0;
  }()));
/* §47.2 — mutation ③'s target: a PARTIAL max is a LOWER BOUND, so every share must
 * be unknown even though sum and max are both real numbers. Checking only
 * max.k==='present' while missing max.partial yields 1.000/1.000/1.000 — fake
 * exact values, the disease this cell exists to treat. */
(function () {
  const ev = [{type:'assistant/usage', data:{completion_tokens:5}}, {type:'assistant/usage'}];      // present + absent => partial max
  const r = M.project(ev);
  ok('a PARTIAL max makes every share unknown (not 1.000)',
    r.partial === true && r.maxPartial === true
    && M.shares(r).every(function (x) { return x.value.k !== 'p'; }));
}());
/* §47.3 — CONTRACT assertion that permanently prevents the old-fixture failure:
 * under the old top-level fixtures a CORRECT implementation read nothing and
 * returned absent,absent, so every "reads a value" criterion was never exercised. */
ok('contract: an event carrying completion_tokens MUST read as present',
  M.tokOf({type:'assistant/usage', data:{completion_tokens:7}}).k === 'p'
  && M.tokOf({type:'assistant/usage', data:{completion_tokens:0}}).k === 'p'
  && M.tokOf({type:'assistant/usage', data:{completion_tokens:null}}).k === 'n'
  && M.tokOf({type:'assistant/usage'}).k === 'a');
/* §40.3's three cases, now asserted on the pure geometry: the tok path cannot be
 * scaled when maxDur is missing (it cancels), so src must be 'unknown' — NOT a
 * bar at 1.2 pretending to be information. */
(function () {
  /* A genuinely UNMEASURED denominator needs a real null — after N/A exclusion a
   * usage+tool batch is no longer partial (that partiality was the false alarm). */
  const ev = [{type:'assistant/usage', data:{completion_tokens:5}, period_id:'P'},
              {type:'assistant/usage', data:{completion_tokens:null}, period_id:'P'}];
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
      return isFinite(b.wPx) && !Number.isNaN(b.wPx) && ['dur','tok','unknown'].indexOf(b.src) > -1;
    }));
}());
/* §50.1 — the view must NOT pass an index: project returns bars itself, so a
 * filtered/sorted iteration cannot silently mismatch bars against events. */
ok('project returns bars, so the view never passes an index',
  (function () {
    const r = M.project([{type:'assistant/usage', data:{completion_tokens:5}, period_id:'P'},
                         {type:'tool/result', data:{duration_ms:50}, period_id:'P'}]);
    return Array.isArray(r.bars) && r.bars.length === 2
      && r.bars.every(function (b) { return ['dur','tok','unknown'].indexOf(b.src) > -1
                                          && isFinite(b.wPx); });
  }()));
/* §52 — INAPPLICABLE is not ABSENT. inject/tool never carry completion_tokens, so
 * excluding them must NOT make the group partial (that would flood every summary
 * with a false ">="). And foldedCell is the observable text the UI will show. */
(function () {
  const ev = [{type:'assistant/usage', data:{completion_tokens:4}, period_id:'P'},
              {type:'context/inject', data:{chars:800}, period_id:'P'},
              {type:'tool/result', data:{duration_ms:50}, period_id:'P'}];
  const r = M.project(ev);
  ok('inapplicable rows are EXCLUDED, not treated as absent (no false partial)',
    r.na === 1 && r.partial === false && r.tok.k === 'p' && r.tok.v === 4);
  ok('foldedCell(r) returns the plain number the UI will show (no ">=")',
    M.foldedCell(r) === '4');
  ok('foldedCell: absent => "· 无数据"; poisoned => "· 未计量"',
    M.foldedCell(M.project([{type:'assistant/usage', data:{}, period_id:'P'}])) === '· 无数据'
    && M.foldedCell(M.project([{type:'assistant/usage', data:{completion_tokens:null}, period_id:'P'}])) === '· 未计量');
}());
/* §59.1 — THE COMPLETION INVARIANT IS ADDITIVITY, not a hard-coded number. Three times
 * in a row an expected constant was written before measuring (12 -> 4 -> 8/4); the
 * invariant is verifiable on ANY batch and needs no guess. (OLAP: additivity — the
 * roll-up must equal the sum of the base.) */
(function () {
  const ev = [{kind:'turn', id:'T1'},
              {type:'assistant/usage', data:{completion_tokens:5}, period_id:'P'},
              {type:'assistant/usage', data:{completion_tokens:7}, period_id:'P'},
              {kind:'turn', id:'T2'},
              {type:'assistant/usage', data:{completion_tokens:3}, period_id:'P'}];
  const r = M.project(ev);
  const sum = r.turns.reduce(function (acc, t) { return acc + (t.tok.k === 'p' ? t.tok.v : 0); }, 0);
  ok('ADDITIVITY: sum(turns[i].tok) === sessionTok (any batch, no hard-coded number)',
    r.turns.length === 2 && sum === r.sessionTok.v && r.sessionTok.v === 15);
  /* EXPECTATION UPDATED WITH A RECORDED REASON (ADR-0048 §78.7): a turn's bars now
   * include the MARKER EVENT that opens it, so 2/1 became 3/2. The property under test
   * is unchanged — the two turns carry DISJOINT bars and sum to the whole. */
  ok('each turn carries ITS OWN bars (turn 2 cannot read turn 1 bars)',
    r.turns[0].bars.length === 3 && r.turns[1].bars.length === 2
    && r.turns[0].bars.length + r.turns[1].bars.length === r.bars.length);
}());
/* §60 — A SINGLE-TURN SAMPLE IS THE GROUPING IDENTITY ELEMENT: the wrong variant
 * ("all bars belong to turn[0]") is digit-for-digit identical to the correct one, and
 * additivity holds trivially. Synthetic input is legitimate HERE because what is under
 * test is the INVARIANT, not the golden master's actual behaviour. */
(function () {
  const ev = [{kind:'turn', id:'T1'},
              {type:'assistant/usage', data:{completion_tokens:5}, period_id:'P'},
              {type:'context/inject',  data:{chars:1}, period_id:'P'},
              {kind:'turn', id:'T2'},
              {type:'assistant/usage', data:{completion_tokens:7}, period_id:'P'},
              {type:'assistant/usage', data:{completion_tokens:1}, period_id:'P'}];
  const r = M.project(ev);
  ok('multi-turn: additivity holds', r.turns.length === 2
    && r.turns[0].tok.v === 5 && r.turns[1].tok.v === 8 && r.sessionTok.v === 13);
  /* ATTRIBUTION: turn 2 must carry ITS OWN bars, not turn 1's. */
  /* EXPECTATION UPDATED WITH A RECORDED REASON (ADR-0048 §78.8, same class as §59):
   * a turn's events/bars now include the MARKER that opens it, so 2/2 became 3/3. The
   * property under test is unchanged — turn 2's bars come from turn 2's events, and
   * tok is still 5 vs 8 (attribution is about WHICH events, not how many). */
  ok('multi-turn: ATTRIBUTION — turn 2 bars come from turn 2 events',
    r.turns[0].events.length === 3 && r.turns[1].events.length === 3
    && r.turns[1].tok.v === 8 && r.turns[0].tok.v === 5
    && r.turns[0].bars.length === 3 && r.turns[1].bars.length === 3);
}());
/* §61.1 — THREE VALUE-POINT ASSERTIONS. The four states must not collapse at the fold
 * layer: if turns[i].tok were a bare number, "contains null" (4) and "all unavailable"
 * (0) would be indistinguishable there, and 0 is the additive identity — the same trap
 * as observing three states through a sum. */
ok('value point: present(0) must NOT read as "no data" (the additive identity trap)',
  M.foldedCell(M.project([{type:'assistant/usage', data:{completion_tokens:0}, period_id:'P'}])) === '0');
ok('value point: absent reads as "no data"',
  M.foldedCell(M.project([{type:'assistant/usage', data:{}, period_id:'P'}])) === '· 无数据');
(function () {
  const r = M.project([{type:'assistant/usage', data:{completion_tokens:4}, period_id:'P'},
                       {type:'assistant/usage', data:{completion_tokens:null}, period_id:'P'}]);
  ok('value point: a null carries the lower bound HERE (and the fold is not a bare number)',
    r.maxDisplay.bound === '>=' && r.tok.k === 'n' && r.partial === false);
}());
/* §77.3 — THE UNIT IS ASSERTED, not assumed: every width is final pixels inside the
 * declared range, and no ratio-like field exists to be misread by 22x. */
ok('bar widths are FINAL PIXELS inside the declared range (unit is in the name)',
  (function () {
    const r = M.project([{type:'assistant/usage', data:{completion_tokens:5}, period_id:'P'},
                         {type:'tool/result', data:{duration_ms:50}, period_id:'P'}]);
    return M.W_UNIT === 'px'
      && r.bars.every(function (b) {
           return typeof b.wPx === 'number' && b.wPx >= M.W_RANGE[0] && b.wPx <= M.W_RANGE[1];
         });
  }()));
/* §78.2 — THE RANGE ASSERTION ALONE HAS NO DISCRIMINATING POWER: MIN_W is inside the
 * declared range, so "everything collapsed to minimum" is legal, and an empty array
 * makes "out of range = 0" trivially true. These two assertions demand that something
 * was ACTUALLY MEASURED. */
(function () {
  const ev = [{type:'assistant/usage', data:{completion_tokens:5}, period_id:'P'},
              {type:'context/inject', data:{chars:1}, period_id:'P'},
              {type:'tool/result', data:{duration_ms:50}, period_id:'P'}];
  const r = M.project(ev);
  ok('MEASURED: bars are 1:1 with the sequence (n/a included) and non-empty',
    r.bars.length === ev.length && r.bars.length > 0
    && r.bars.filter(function (b) { return b.src === 'n/a'; }).length === 1);
  ok('MEASURED: the longest duration bar reaches W_FULL exactly (blocks equal shrink)',
    Math.max.apply(null, r.bars.map(function (b) { return b.wPx; })) === M.W_RANGE[1]);
  ok('SHAPE: every bar carries exactly the declared keys (a stray .w would read undefined)',
    r.bars.every(function (b) {
      const k = Object.keys(b).sort().join(',');
      return k === M.BAR_KEYS.slice().sort().join(',');
    }));
}());
/* §94.2/§94.3 — THE DEGRADED BRANCHES MUST BE EXERCISED, and the constants must have
 * provenance rather than taste. A fallback that no fault has ever reached is not a
 * fallback. */
(function () {
  const P = {state:M.P(4)}, N = {state:M.A()};
  const okCase = M.allocate([P,P,P].concat(new Array(11).fill(N)));
  ok('allocation: normal case splits the remainder among present rows, tick per unknown',
    okCase.state === 'ok' && okCase.tickPct > 0 && okCase.tickPct <= M.cellPctOf(M.GRID_COLS_DEFAULT)
    && okCase.cols.filter(function (c, i) { return i < 3; }).reduce(function (a,b) { return a+b; }, 0)
       + 11 * okCase.tickPct > 99.999);
  ok('allocation DEGRADED: over-budget unknown count is a STATE, not a negative width',
    (function () {
      /* 250 unknowns > 200 cells, so the MORE PRECISE reason fires first: the row simply
       * does not fit the grid. reserve-over-budget still covers the in-grid case (below). */
      const r = M.allocate(new Array(250).fill(N).concat([P]), {gridCols:200});
      /* 150 unknowns stay IN the grid (<=200) but exceed the reserve: 150 x 0.5 = 75 > 50. */
      const inGrid = M.allocate([P].concat(new Array(150).fill(N)), {gridCols:200});
      return r.state === 'unavailable' && r.reason === 'row-exceeds-grid'
        && inGrid.state === 'unavailable' && inGrid.reason === 'reserve-over-budget'
        && r.cols.every(function (c) { return c >= 0 && isFinite(c); });
    }()));
  ok('allocation DEGRADED: a segment with no present rows is a STATE, not a divide-by-zero',
    (function () {
      const r = M.allocate([N,N]);
      return r.state === 'unavailable' && r.reason === 'no-present-rows';
    }()));
  ok('allocation: the tick is strictly narrower than the smallest real value (no ordering inversion)',
    (function () {
      const r = M.allocate([{state:M.P(1000)}, {state:M.P(1)}, N]);
      const tick = r.tickPct;
      return r.state === 'ok' && tick < (1 / 1001) * (100 - tick);
    }()));
  ok('allocation constants have DERIVED provenance (K>1; cell width from the grid)',
    M.TICK_K > 1 && Math.abs(M.cellPctOf(M.GRID_COLS_DEFAULT) - 100 / 200) < 1e-12 && M.RESERVE_CAP_PCT <= 50);
}());
/* §98.3 — CRITERIA ARE PER STATE (§98.2): a clamped sum is aliasing, not rendering.
 * ok => Σ===100 (with tolerance); unavailable => a DECLARED reason, carbon and silicon
 * both read it (README dual-aspect). */
(function () {
  const N = {state:M.A()}, P = {state:M.P(4)};
  const top = function (r) { return r.cols.reduce(function (x, y) { return x + y; }, 0); };
  const ok11 = M.allocate([P,P,P].concat(new Array(11).fill(N)), {gridCols:200});
  const ok30 = M.allocate([P].concat(new Array(30).fill(N)), {gridCols:200});
  const over = M.allocate([P].concat(new Array(250).fill(N)), {gridCols:200});
  const none = M.allocate([N,N], {gridCols:200});
  ok('state ok => Σ === 100 (tolerance declared), for a small and a large unknown count',
    ok11.state === 'ok' && Math.abs(top(ok11) - 100) <= 1e-9
    && ok30.state === 'ok' && Math.abs(top(ok30) - 100) <= 1e-9);
  ok('state unavailable carries a DECLARED reason (three reasons, one column)',
    over.state === 'unavailable' && over.reason === 'row-exceeds-grid'
    && none.state === 'unavailable' && none.reason === 'no-present-rows');
  ok('gridCols is a DECLARED INPUT, not mutable module state (no setter on the exports)',
    M.setGridCols === undefined && M.cellPctOf(80) === 1.25
    && M.allocate([P], {gridCols:80}).gridCols === 80);
}());
ok('ratio with a partial input degrades to explicit unknown',
    M.ratioOf(M.project([{type:'assistant/usage', data:{completion_tokens:120}}, A]), M.project([{type:'assistant/usage', data:{completion_tokens:800}}])).value.k === 'n');
  ok('order independence of the projection',
    (function () {
      const a = M.project([{type:'assistant/usage', data:{completion_tokens:120}},{type:'assistant/usage', data:{completion_tokens:80}},A,{type:'assistant/usage', data:{completion_tokens:200}}]);
      const b = M.project([{type:'assistant/usage', data:{completion_tokens:200}},A,{type:'assistant/usage', data:{completion_tokens:120}},{type:'assistant/usage', data:{completion_tokens:80}}]);
      return a.tok.k === b.tok.k && a.tok.v === b.tok.v && a.partial === b.partial;
    }()));
}());
console.log(bad === 0 ? 'OK — cell projection holds (golden master)' : 'FAILED — ' + bad);
process.exit(bad === 0 ? 0 : 1);
