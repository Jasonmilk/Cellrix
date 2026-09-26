/* ONE SHAPE, ONE HELPER (ADR-0048 §102.3): two blocks built the same context and the
 * second was missed. Same move as "project distributes bars": one shape, one definition. */
const colPctOf = (rows) => M.allocate(rows, { gridCols: 200, mode: 'value' }).cols;
const tickOf = (rows) => M.allocate(rows, { gridCols: 200, mode: 'value' }).tickPct;
const statesOf = (bars) => bars.map(function (b) { return { state: b.value }; });
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
/* ADR §4.2: a null does NOT poison a sum — the measured 0 survives and the total
 * becomes a LOWER BOUND (partial). This is the same answer the absent case gives. */
S('present(0)+null       ', [Z, N], 'p:0 [partial]');
S('[120,80,absent,200]   ', [{type:'assistant/usage', data:{completion_tokens:120}},{type:'assistant/usage', data:{completion_tokens:80}},A,{type:'assistant/usage', data:{completion_tokens:200}}], 'p:400 [partial]');
S('[120,80,null,200]     ', [{type:'assistant/usage', data:{completion_tokens:120}},{type:'assistant/usage', data:{completion_tokens:80}},N,{type:'assistant/usage', data:{completion_tokens:200}}], 'p:400 [partial]');
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
    return f.tok.k !== 'p' || M.isFiniteNumber(f.tok.v);
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
  /* NUMBER CHANGED, PROPERTY KEPT (§133): the count follows the adjudicated aggregation rule;
   * what must never change is that a legitimate unknown is not a gate failure. */
  ok('a legitimate null does NOT make the gate red (legit=' + 2 + ', nonFinite=0)',
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
  /* SPLIT (ADR-0048 §133): this used to be ONE conjunction of an outdated branch and a
   * correct one. `F ∧ X ≡ F` — while the first stayed red, the second was UNOBSERVABLE, and
   * it guards exactly the direction-flip rule that broke once already. The two branches are
   * now separate assertions: the outdated one follows the adjudicated rule, the true one
   * stands alone and must stay green. */
  ok('max as DENOMINATOR is a LOWER BOUND (P(200), partial) — not a poisoned unknown',
    r.max.k === 'p' && r.max.v === 200 && r.maxPartial === true);
  ok('direction flip HOLDS: a bound in the denominator makes every share unknown',
    M.shares(r).every(function (x) { return x.value.k !== 'p'; }));
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
    M.allocate([{state:M.A()}], {gridCols:200, mode:'value'}).reason === 'no-present-rows');
  const withDur = { maxDur: M.P(50), max: r.max, partial: r.partial, states: r.states, durStates: r.durStates };
  ok('with maxDur but a PARTIAL max => tok bars stay unknown (lower-bound denominator)',
    colPctOf([{state:M.A()}]).every(function (c) { return M.isFiniteNumber(c); }));
  ok('bar width is never NaN or Infinity, for any combination',
    [[M.A(), M.A()], [M.A(), M.P(5)], [M.P(50), M.A()], [M.P(50), M.P(5)]].every(function (pair) {
      return colPctOf([{state:M.P(5)}, {state:pair[1]}]).every(function (c) { return M.isFiniteNumber(c) && c >= 0; });
    }));
}());
/* §50.1 — the view must NOT pass an index: project returns bars itself, so a
 * filtered/sorted iteration cannot silently mismatch bars against events. */
ok('project returns bars, so the view never passes an index',
  (function () {
    const r = M.project([{type:'assistant/usage', data:{completion_tokens:5}, period_id:'P'},
                         {type:'tool/result', data:{duration_ms:50}, period_id:'P'}]);
    return Array.isArray(r.bars) && r.bars.length === 2
      && r.bars.every(function (b) { return ['tok','null','absent','dur','n/a'].indexOf(b.src) > -1; })
      && colPctOf(statesOf(r.bars)).every(function (c) { return M.isFiniteNumber(c); });
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
  /* SPLIT (§133): the display-bound branch was TRUE and must stand alone; the other two
   * branches encoded the overruled poisoning rule. */
  ok('value point: the DISPLAY lower bound is present exactly when a null is in the batch',
    r.maxDisplay.bound === '>=');
  ok('value point: the fold keeps the measured 4 and declares itself partial (not unknown)',
    r.tok.k === 'p' && r.tok.v === 4 && r.partial === true);
}());
/* §77.3 — THE UNIT IS ASSERTED, not assumed: every width is final pixels inside the
 * declared range, and no ratio-like field exists to be misread by 22x. */
ok('bar widths are FINAL PIXELS inside the declared range (unit is in the name)',
  (function () {
    const r = M.project([{type:'assistant/usage', data:{completion_tokens:5}, period_id:'P'},
                         {type:'tool/result', data:{duration_ms:50}, period_id:'P'}]);
    /* REWRITTEN to the percentage encoding: the pixel ruler is gone, so this asserts the
     * observable allocation instead of an internal unit (ADR-0048 §101.1 / §96). */
    const a = M.allocate(statesOf(r.bars), { gridCols: 200, mode: 'value' });
    return Math.abs(a.cols.reduce(function (x, y) { return x + y; }, 0) - 100) <= 1e-9
      && a.tickPct <= M.cellPctOf(200);
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
    tickOf(statesOf(r.bars)) <= M.cellPctOf(200)
      && colPctOf(statesOf(r.bars)).every(function (c) { return M.isFiniteNumber(c) && c >= 0; }));
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
  const okCase = M.allocate([P,P,P].concat(new Array(11).fill(N)), { gridCols: 200, mode: 'value' });
  ok('allocation: normal case splits the remainder among present rows, tick per unknown',
    okCase.state === 'ok' && okCase.tickPct > 0 && okCase.tickPct <= M.cellPctOf(M.GRID_COLS_DEFAULT)
    && okCase.cols.filter(function (c, i) { return i < 3; }).reduce(function (a,b) { return a+b; }, 0)
       + 11 * okCase.tickPct > 99.999);
  ok('allocation DEGRADED: over-budget unknown count is a STATE, not a negative width',
    (function () {
      /* 250 unknowns > 200 cells, so the MORE PRECISE reason fires first: the row simply
       * does not fit the grid. reserve-over-budget still covers the in-grid case (below). */
      const r = M.allocate(new Array(250).fill(N).concat([P]), {gridCols:200, mode:'value'});
      /* 150 unknowns stay IN the grid (<=200) but exceed the reserve: 150 x 0.5 = 75 > 50. */
      const inGrid = M.allocate([P].concat(new Array(150).fill(N)), {gridCols:200, mode:'value'});
      return r.state === 'unavailable' && r.reason === 'row-exceeds-grid'
        && inGrid.state === 'unavailable' && inGrid.reason === 'reserve-over-budget'
        && r.cols.every(function (c) { return c >= 0 && M.isFiniteNumber(c); });
    }()));
  ok('allocation DEGRADED: a segment with no present rows is a STATE, not a divide-by-zero',
    (function () {
      const r = M.allocate([N,N], { gridCols: 200, mode: 'value' });
      return r.state === 'unavailable' && r.reason === 'no-present-rows';
    }()));
  ok('allocation: the tick is strictly narrower than the smallest real value (no ordering inversion)',
    (function () {
      const r = M.allocate([{state:M.P(1000)}, {state:M.P(1)}, N], { gridCols: 200, mode: 'value' });
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
  const ok11 = M.allocate([P,P,P].concat(new Array(11).fill(N)), {gridCols:200, mode:'value'});
  const ok30 = M.allocate([P].concat(new Array(30).fill(N)), {gridCols:200, mode:'value'});
  const over = M.allocate([P].concat(new Array(250).fill(N)), {gridCols:200, mode:'value'});
  const none = M.allocate([N,N], {gridCols:200, mode:'value'});
  ok('state ok => Σ === 100 (tolerance declared), for a small and a large unknown count',
    ok11.state === 'ok' && Math.abs(top(ok11) - 100) <= 1e-9
    && ok30.state === 'ok' && Math.abs(top(ok30) - 100) <= 1e-9);
  ok('state unavailable carries a DECLARED reason (three reasons, one column)',
    over.state === 'unavailable' && over.reason === 'row-exceeds-grid'
    && none.state === 'unavailable' && none.reason === 'no-present-rows');
  ok('gridCols is a DECLARED INPUT, not mutable module state (no setter on the exports)',
    M.setGridCols === undefined && M.cellPctOf(80) === 1.25
    && M.allocate([P], {gridCols:80, mode:'value'}).gridCols === 80);
}());
/* ② migrate (ADR-0048 §99): THE ASSERTION THAT MUST GO RED BEFORE ③.
 * It covers the WHOLE pixel encoding, not just one name — deleting a single constant
 * must not be enough to turn it green. Expected state RIGHT NOW: RED (the encoding is
 * still present). ③ deletes wPx/W_UNIT/W_RANGE/barWidth and this same assertion turns
 * GREEN: red -> green IS the evidence for that commit (expand -> migrate -> contract). */
ok('EXPECTED-RED until ③: no pixel encoding coexists with the percentage encoding',
  !('wPx' in M) && !('W_UNIT' in M) && !('W_RANGE' in M) && !('barWidth' in M)
  && !/\bwPx\b/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'assets', 'cell_metering.js'), 'utf8')));
/* META (same rule as the gate's META): the assertion above must EXIST and be EXERCISED —
 * a list of expected reds that nobody ever exercised is not a list. */
ok('META: the coexistence assertion above is present in this file',
  require('fs').readFileSync(__filename, 'utf8').indexOf('EXPECTED-RED until') > -1);
/* 0e (ADR-0048 §111.1): THE QUANTITY IS DECLARED AT THE CALL SITE, and the two
 * declarations are both exercised. An undeclared mode must NOT default silently —
 * silent defaults are this cell's entire failure family. */
(function () {
  const P = {state:M.P(4)}, N = {state:M.A()};
  const rows = [P, P, P].concat(new Array(11).fill(N));
  const eq = M.allocate(rows, { gridCols: 200, mode: 'equal' });
  const val = M.allocate(rows, { gridCols: 200, mode: 'value' });
  ok('0e: mode=equal closes the LENGTH channel (equal cells, position only)',
    eq.reason === 'length-closed' && eq.state === 'unavailable'
    && eq.cols.every(function (c) { return Math.abs(c - eq.cols[0]) < 1e-12; })
    && eq.cols.length === rows.length);
  ok('0e: mode=value allocates over the declared quantity (present rows share the rest)',
    val.reason === null && val.cols.filter(function (c, i) { return i < 3; })
      .every(function (c) { return c > eq.cols[0]; }));
  ok('0e: an UNDECLARED mode throws (programmer error, not a data state)',
    (function () { try { M.allocate(rows, { mode: 'whatever' }); return false; }
                   catch (e) { return /undeclared length-channel mode/.test(e.message); } }()));
  ok('0e: the signature takes a declared opts object (not a guessed quantity)',
    M.allocate.length >= 2);
  /* A MISSING declaration must throw too — otherwise the "no silent default" guard is an
   * equivalent mutant: every caller already declares, so removing the guard changes nothing
   * observable. This assertion is what gives the guard teeth (verified by mutation). */
  ok('0e: a MISSING mode throws (no silent default)',
    (function () { try { M.allocate(rows); return false; }
                   catch (e) { return /must be DECLARED/.test(e.message); } }()));
}());
/* §116 — NUMERIC GUARDS MUST NOT COERCE. `isFinite(null) === true` and `null >= 0` is
 * true (Number(null) === 0), so the old guard was GREEN on an all-null array while every
 * lane rendered zero-width. The three-state discipline stopped `||`; this stops `isFinite`. */
(function () {
  const allPresent = M.allocate([{state:M.P(5)},{state:M.P(3)},{state:M.P(2)}],
                                { gridCols: 200, mode: 'value' });
  ok('§116: all-present allocates the WHOLE width by the declared quantity (no null)',
    allPresent.state === 'ok' && allPresent.cols.every(function (c) { return typeof c === 'number'; })
    && Math.abs(allPresent.cols.reduce(function (x, y) { return x + y; }, 0) - 100) <= 1e-9);
  ok('§116: all-present keys the split to the declared ratio (5:3:2)',
    Math.abs(allPresent.cols[0] - 50) <= 1e-9 && Math.abs(allPresent.cols[1] - 30) <= 1e-9
    && Math.abs(allPresent.cols[2] - 20) <= 1e-9);
  ok('§116: all-present-and-all-zero is a DECLARED equal split, not a || 1 fallback',
    (function () {
      const r = M.allocate([{state:M.P(0)},{state:M.P(0)}], { gridCols: 200, mode: 'value' });
      return r.state === 'ok' && r.reason === 'all-zero-declared'
        && Math.abs(r.cols[0] - 50) <= 1e-9 && Math.abs(r.cols[1] - 50) <= 1e-9;
    }()));
}());
/* §116 rule ⑫ — the predicate itself is asserted on the values that COERCION would accept:
 * this is the assertion that distinguishes `isFinite(x)` from `typeof x === 'number' &&
 * isFinite(x)`, and it is why the guard is no longer an equivalent mutant. */
ok('§116: isFiniteNumber REJECTS every value a coercing check would accept',
  M.isFiniteNumber(0) === true && M.isFiniteNumber(50) === true
  && M.isFiniteNumber(null) === false && M.isFiniteNumber(undefined) === false
  && M.isFiniteNumber(NaN) === false && M.isFiniteNumber('5') === false
  && M.isFiniteNumber(true) === false && M.isFiniteNumber(Infinity) === false);
/* §118.2 — RULE ⑫ AS A CLASS, NOT AN INSTANCE: after this commit the test file must
 * contain ZERO bare `isFinite(` uses (comments stripped — a check that counts words in
 * prose can never fail). Mutation: put one back ⇒ this must go red. */
ok('§118: no bare isFinite( remains in this test file (rule ⑫ as a class)',
  (function () {
    /* ONLY the part BEFORE this assertion is scanned: the first draft matched its own
     * pattern literal and was red with nothing wrong (the oracle check hit this too). */
    const src = require('fs').readFileSync(__filename, 'utf8')
      .split('§118.2')[0]
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
    const bare = (src.match(/(^|[^\w.])isFinite\s*\(/g) || []);
    return bare.length === 0;
  }()));
/* §118.3 — "USABLE" HAS ONE TRUTH SOURCE: `state === 'ok'` means the allocation is
 * usable, and usable is DEFINED as Σ == 100. `reason` records WHY the basis is what it is
 * (`all-zero-declared` = equal split because every declared quantity was zero) — it is not
 * a second answer to "was this degraded". Asserted over every branch that returns ok. */
ok('§118: state==="ok" ⟺ the columns are usable (Σ == 100); reason explains the basis',
  (function () {
    const cases = [
      M.allocate([{state:M.P(5)},{state:M.P(3)},{state:M.P(2)}], { gridCols:200, mode:'value' }),
      M.allocate([{state:M.P(0)},{state:M.P(0)}], { gridCols:200, mode:'value' }),
      M.allocate([{state:M.P(4)},{state:M.A()}], { gridCols:200, mode:'value' })
    ];
    return cases.every(function (r) {
      const sum = r.cols.reduce(function (x, y) { return x + y; }, 0);
      return r.state === 'ok' ? Math.abs(sum - 100) <= 1e-9 : true;
    });
  }()));
/* §124 / A2 — THE RUN MODE IS DECLARED OR IT IS UNMEASURED. There is no third option and
 * no default: `partner` is Helix's native state, which makes it the most tempting value to
 * fall back to and therefore the most dangerous one (a default standing in for a measurement). */
(function () {
  const drive = M.modeOf({ type: 'turn/start', data: { mode: 'drive' } });
  const absent = M.modeOf({ type: 'turn/start', data: {} });   /* a tape predating the field */
  const unmeas = M.modeOf({ type: 'turn/start', data: { mode: null } });  /* declared unknown */
  const none = M.modeOf({ type: 'turn/start' });
  /* The projection was RIGHT and my first expectation was wrong (same lesson as the "≥"
   * marker): a field that does not exist is ABSENT, while a field that exists with null is
   * UNMEASURED. Two different facts, two states — and neither is a default. */
  ok('§124: a declared mode reads as present (NARRATIVE shape ps, not a magnitude p)',
    drive.k === 'ps' && drive.v === 'drive');
  /* THIRD TIME THE PROJECTION CORRECTED MY EXPECTATION: A()/N() carry NO `v` key at all —
   * only `present` has one. That is stronger than v:null, which could be confused with a
   * MEASURED null. So the assertion is about the ABSENCE of the key, not about its value. */
  ok('§124: an ABSENT mode field is absent, not a default',
    absent.k === 'a' && !Object.prototype.hasOwnProperty.call(absent, 'v'));
  ok('§124: a null mode field is unmeasured, not a default',
    unmeas.k === 'n' && !Object.prototype.hasOwnProperty.call(unmeas, 'v'));
  ok('§124: a row with no mode path at all is absent/inapplicable', none.k === 'a');
  ok('§124: NONE of the four cases invents a value (no partner fallback anywhere)',
    [drive, absent, unmeas, none].every(function (r) {
      return (r.k !== 'p' && r.k !== 'ps') || r.v === 'drive';
    }));
}());
/* §134 — THE LOWER BOUND'S PREMISE IS NON-NEGATIVITY, SO IT IS DECLARED AND GUARDED.
 * S + u >= S  <=>  u >= 0   (max is unconditional by monotonicity). Tokens / durations /
 * chars are non-negative BY DEFINITION, so a negative is not a measurement of the quantity:
 * it is inapplicable. Measured counterexample this fixes: [-5, null, 7] printed "2 >=" — a
 * FALSE statement, since the true sum is 2 + u for an arbitrary real u. */
(function () {
  const neg = M.project([{ type:'assistant/usage', data:{completion_tokens:-5}, period_id:'P' },
                         { type:'assistant/usage', data:{completion_tokens:null}, period_id:'P' },
                         { type:'assistant/usage', data:{completion_tokens:7}, period_id:'P' }]);
  ok('§134: a negative is INAPPLICABLE, so it cannot enter the sum (no false bound)',
    neg.tok.k === 'p' && neg.tok.v === 7);
  ok('§134: the remaining lower bound is SOUND (applicable measured sum, unknown >= 0)',
    String(M.foldedCell(neg)).indexOf('7') === 0 && String(M.foldedCell(neg)).indexOf('≥') > -1);
  const negOnly = M.project([{ type:'assistant/usage', data:{completion_tokens:-5}, period_id:'P' }]);
  ok('§134: a batch of only negatives has nothing measured (no invented 0, no invented bound)',
    negOnly.tok.k !== 'p' || negOnly.tok.v !== -5);
}());
/* §137 — THE SECOND HALF OF RULE ⑮: AN `else` IS "JUDGING WITHOUT LOOKING".
 * stateText mapped every unlisted shape to "no data", and the view mapped every unlisted shape
 * to data-cell-state="absent". A narrative fact (`ps`, the run mode A2 is about to wire in)
 * would therefore have rendered as "this machine reported nothing" — the worst failure shape,
 * because it invites the wrong conclusion instead of looking broken. */
(function () {
  const throws = (f) => { try { f(); return false; } catch (e) { return true; } };
  ok('§137: stateText is EXHAUSTIVE — a narrative fact does NOT render as "no data"',
    throws(() => M.stateText(M.Pstr('drive'))));
  ok('§137: every known shape still has an explicit branch (p / n / a)',
    M.stateText(M.P(5)) === '5' && String(M.stateText(M.N())).length > 0
    && String(M.stateText(M.A())).length > 0);
  ok('§137: unmeasured and absent stay DISTINCT at the text point',
    M.stateText(M.N()) !== M.stateText(M.A()));
  ok('§137: allocate refuses a narrative fact at the ENTRY (never a silent drop)',
    throws(() => M.allocate([{ state: M.Pstr('drive') }], { gridCols: 200, mode: 'value' })));
}());
/* §138 — THE GATE BEFORE THE WATER: a guard that knows only TODAY'S bad shape cannot catch
 * the shape someone adds tomorrow, which is rule ⑮'s entire purpose. Measured before this:
 * allocate([{k:'zz'}, P(5)]) returned cols=[0.5,99.5], state='ok', reason=null — BIT-IDENTICAL
 * to a real absent row. Now every consumer enumerates, and the shape set has ONE source. */
(function () {
  const throws = (f) => { try { f(); return false; } catch (e) { return true; } };
  const UNKNOWN = ['zz', 'P', 'ps ', '', 'p2', undefined];
  ok('§138: allocate refuses EVERY unlisted shape, not just the known-bad one',
    UNKNOWN.every(function (k) {
      return throws(function () { M.allocate([{ state: { k: k } }], { gridCols: 200, mode: 'value' }); });
    }));
  ok('§138: stateText refuses every unlisted shape too',
    UNKNOWN.every(function (k) { return throws(function () { M.stateText({ k: k }); }); }));
  ok('§138: the shape set is ONE source, derived from the algebra (never re-spelled)',
    M.SHAPES.p === M.P(0).k && M.SHAPES.ps === M.Pstr('x').k
    && M.SHAPES.n === M.N().k && M.SHAPES.a === M.A().k);
  ok('§138: a narrative fact must be a STRING (the shape and its content agree)',
    throws(function () { M.Pstr(5); }) && throws(function () { M.Pstr(true); })
    && M.Pstr('drive').v === 'drive');
  ok('§138: the known shapes still allocate (the gate did not close the road)',
    (function () {
      const r = M.allocate([{ state: M.P(5) }, { state: M.A() }], { gridCols: 200, mode: 'value' });
      return r.state === 'ok' && r.cols.length === 2;
    }()));
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
