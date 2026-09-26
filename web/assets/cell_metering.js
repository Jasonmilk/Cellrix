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
  /* DECLARED FIELD PATHS (ADR-0048 §42/§43): RFC 6901 JSON Pointer, ordered
   * candidate chain, terminating on the FIRST KEY THAT EXISTS — not on the first
   * non-empty value. Key present with null => N (explicitly unmeasured); key absent
   * => A (not recorded); 0 => P(0). Reading top-level `e.tok` was the wrong drawer:
   * real data carries /data/completion_tokens (OTel output_tokens, incremental). */
  function ptrGet(obj, ptr) {
    if (typeof ptr !== 'string' || ptr.charAt(0) !== '/') { return undefined; }
    var cur = obj;
    var parts = ptr.slice(1).split('/');
    for (var i = 0; i < parts.length; i++) {
      var key = parts[i].replace(/~1/g, '/').replace(/~0/g, '~');
      if (cur === null || typeof cur !== 'object') { return undefined; }
      if (!Object.prototype.hasOwnProperty.call(cur, key)) { return undefined; }
      cur = cur[key];
    }
    return cur;
  }
  var TOK_PATHS = ['/data/completion_tokens', '/data/output_tokens'];
  /* APPLICABILITY (ADR-0048 §52, Codd's fourth state). A dimension is INAPPLICABLE
   * to an event type that never carries it — that is NOT "unmeasured this time".
   * Merging the two (as three-valued logic does) floods every group with `>=`:
   * inject/tool never carry completion_tokens, so every group would look partial.
   * Inapplicable rows are EXCLUDED at row selection; they never reach the algebra. */
  /* THE TURN BOUNDARY IS DECLARED, NOT DISCOVERED (ADR-0048 §58.3 / §59.3 — "declaration
   * over discovery", the EIGHTH time). The view's session objects carry `kind: 'turn'`;
   * the落盘 events carry `type: 'turn/start'`. Both vocabularies are declared here so
   * `project` never guesses a grouping key. */
  /* PROJECTION CONSTANTS (module scope: they belong to the projection, not to a call).
   * The old source had bare 22, a bare 0.5 and a bare 1.2 in the formula, which is why
   * "22 vs 11" looked like an unexplained scale mismatch — 11 was 22 x 0.5, unwritten. */
  /* THE UNIT LIVES IN THE NAME (ADR-0048 §77.3, "declaration over discovery" #10).
   * the DELETED pixel ruler was final pixels: directly usable, never to be
   * re-normalised, never to be treated as a ratio. Measured failure modes of the
   * unnamed version: re-normalising gave the longest bar 6.59 instead of 22.00;
   * treating it as a ratio gave 242.00 (a 22x unit error); indexing bars by event
   * count gave undefined -> NaNpx back in a new form. None of them crashed, and all
   * of them passed a gate that only checked names and counts. */
  var BAR_KEYS = ['src', 'reason', 'value', 'idx', 'eventId'];
  var TURN_MARKS = [['/kind', 'turn'], ['/type', 'turn/start']];
  function isTurnMark(e) {
    for (var i = 0; i < TURN_MARKS.length; i++) {
      if (ptrGet(e, TURN_MARKS[i][0]) === TURN_MARKS[i][1]) { return true; }
    }
    return false;
  }
  var TOK_APPLICABLE = ['assistant/usage'];
  var DUR_APPLICABLE = ['tool/result'];
  function eventType(e) { return (e && typeof e.type === 'string') ? e.type : ''; }
  function applicable(e, list) { return list.indexOf(eventType(e)) > -1; }
  var DUR_PATHS = ['/data/duration_ms'];
  /* RUN MODE (ADR-0048 §124 / A2): drive | partner | survive — a fact about the PERIOD that
   * the event stream either DECLARES or does not. Read like any other fact, so an old tape is
   * N (unmeasured), never a default: defaulting to 'partner' would be a configured value
   * standing in for a measured one — the exact fault this ADR exists to remove. */
  var MODE_PATHS = ['/data/mode', '/mode'];
  function readChain(e, paths, numeric) {
    /* NO SILENT DEFAULT (rule ⑩, which I had just re-affirmed in `0e`): omitting the flag made
     * a numeric dimension read as a NARRATIVE one, and a narrative value that reaches `max`
     * silently wins (ADR-0048 §136). Missing ⇒ throw. */
    if (numeric === undefined) {
      throw new Error('readChain: the numeric/narrative choice must be DECLARED'
        + ' (true for magnitudes, false for narrative facts) — ADR-0048 §136.');
    }
    for (var i = 0; i < paths.length; i++) {
      var seg = paths[i].slice(1).split('/');
      var cur = e, exists = true;
      for (var j = 0; j < seg.length; j++) {
        var key = seg[j].replace(/~1/g, '/').replace(/~0/g, '~');
        if (cur === null || typeof cur !== 'object'
            || !Object.prototype.hasOwnProperty.call(cur, key)) { exists = false; break; }
        cur = cur[key];
      }
      if (!exists) { continue; }                 /* FIRST EXISTING KEY WINS */
      if (cur === null) { return TS.N(); }        /* explicit null => unmeasured  */
      /* DOMAIN DECLARATION (ADR-0048 §134): tokens / durations / chars are NON-NEGATIVE by
       * definition, and the lower bound `>=` DEPENDS on it: S + u >= S requires u >= 0.
       * A negative here is therefore NOT a measurement of this quantity — it is
       * INAPPLICABLE, which keeps the enclosure sound (the applicable measured sum is a
       * true lower bound) and stays VISIBLE as n/a instead of silently poisoning the sum.
       * Measured counterexample this fixes: [-5, null, 7] used to print "2 >=", a FALSE
       * statement, because the true sum is 2 + u for an arbitrary real u. */
      /* NUMERIC DIMENSIONS ONLY (the mode reader shares this function and reads a STRING):
       * data that is not a finite number, or is negative, is INAPPLICABLE for a non-negative
       * quantity — visible as n/a, never coerced (a string is not a measurement; turning '5'
       * into 5 would be assuming for the producer, §134/§135). The `numeric` flag is what keeps
       * the guard on the dimensions it is true for — my first version put it in the shared path
       * and the mode reader immediately broke, which the gate caught. */
      if (numeric && (typeof cur !== 'number' || !isFinite(cur) || cur < 0)) { return TS.A(); }
      /* NON-NUMERIC READS (the run mode) use the narrative constructor: only the NUMERIC
       * dimensions may build a magnitude (ADR-0048 §135). */
      return numeric ? TS.P(cur) : TS.Pstr(cur);   /* incl. 0 for numbers          */
    }
    return TS.A();                                /* nothing recorded             */
  }
  function tokOf(e) { return readChain(e, TOK_PATHS, true); }
  function durOf(e) { return readChain(e, DUR_PATHS, true); }
  function modeOf(e) { return readChain(e, MODE_PATHS, false); }   /* narrative fact */
  /* INPUT SCOPE (ADR-0048 §41/§43): this cell aggregates ONE period.
   * Missing period_id normalises to "" (PromQL: an undefined label matches the
   * empty label value — it is not an error); two DISTINCT non-empty periods is a
   * programmer error. Events lacking it do not participate, and are COUNTED. */
  function scopeOf(events) {
    var seen = {}, distinct = [], missing = 0, i, pid;
    for (i = 0; i < events.length; i++) {
      pid = (events[i] && events[i].period_id !== undefined) ? String(events[i].period_id) : '';
      if (pid === '') { missing++; continue; }
      if (!seen[pid]) { seen[pid] = true; distinct.push(pid); }
    }
    if (distinct.length > 1) {
      throw new Error('project() accepts ONE period per batch; got ' + JSON.stringify(distinct)
        + ' (ADR-0048 §41: cross-period aggregation crushes one period\'s shares with'
        + ' another\'s magnitude). Group upstream, do not relax this check.');
    }
    return { period: distinct[0] || '', missing: missing };
  }
  /* BOTH aggregates the cell needs, from the SAME list, in ONE pass — otherwise the
   * view keeps its own :335 max loop and the cell has TWO aggregation paths, which is
   * guaranteed drift (the "two menus" problem). `max` also carries the three states. */
  function project(events) {
    /* EACH DIMENSION SELECTS ITS OWN ROWS. Pushing an A() into the tok list for a row
     * that is merely applicable to DURATION makes the tok fold partial — the exact
     * false-alarm flood this rule exists to prevent (measured: it happened even while
     * fixing it). `rows` is the UNION, for display; the two folds see only their own. */
    var list = [], durList = [], naCount = 0, tokApplicableFlags = [];
    var rowIndexOf = [], rowCount = 0;   /* event i -> its row (never searched for) */
    var tokFold = [], durFold = [];
    for (var i = 0; i < events.length; i++) {
      var applicableTok = applicable(events[i], TOK_APPLICABLE);
      var applicableDur = applicable(events[i], DUR_APPLICABLE);
      if (!applicableTok && !applicableDur) { naCount++; continue; }
      rowIndexOf[i] = rowCount++;
      list.push(applicableTok ? tokOf(events[i]) : TS.A());
      durList.push(applicableDur ? durOf(events[i]) : TS.A());
      tokApplicableFlags.push(applicableTok);
      if (applicableTok) { tokFold.push(tokOf(events[i])); }
      if (applicableDur) { durFold.push(durOf(events[i])); }
    }
    var folded = TS.fold(tokFold);
    var acc = TS.start(), seenPMax = false, seenAMax = false, seenAnyNull = false;
    var displayMax = null, tokHasUnmeasured = false;
    var maxDurAcc = TS.A(), seenPDur = false, seenADur = false, seenNDur = false;
    for (var j = 0; j < list.length; j++) {
      if (list[j].k === 'p' && tokApplicableFlags[j]) { seenPMax = true; }
      if (list[j].k === 'a' && tokApplicableFlags[j]) { seenAMax = true; }
      if (list[j].k === 'n' && tokApplicableFlags[j]) { seenAnyNull = true; }
      if (list[j].k === 'a' && tokApplicableFlags[j]) { tokHasUnmeasured = true; }
      if (list[j].k === 'n' && tokApplicableFlags[j]) { tokHasUnmeasured = true; }
      if (list[j].k === 'p') { displayMax = (displayMax === null) ? list[j].v
                                                              : Math.max(displayMax, list[j].v); }
      acc = { value: TS.max(acc.value, list[j]), seenP: seenPMax, seenA: seenAMax };
      var dj = durList[j];
      if (dj.k === 'p') { seenPDur = true; }
      if (dj.k === 'a') { seenADur = true; }
      if (dj.k === 'n') { seenNDur = true; }
      maxDurAcc = TS.max(maxDurAcc, dj);
    }
    var self = {
      states: list,
      durStates: durList,
      maxDur: maxDurAcc,
      maxDurPartial: seenPDur && (seenADur || seenNDur),
      projected: true,
      /* MAX HAS TWO USES, ADJUDICATED SEPARATELY (ADR §33):
       *   as DISPLAY      -> a LOWER BOUND is a true statement (>=200),
       *                     consistent with B' on the summation side;
       *   as DENOMINATOR  -> UNKNOWN (a bound in the denominator flips the
       *                     direction), which is what `max` itself stays. */
      maxDisplay: (function () {
        /* The DISPLAY bound must be taken over the MEASURED values only. Judging it
         * on the strict (poisoned) max was a real bug: it returned unknown instead of
         * the honest ">=200". */
        if (!seenPMax) { return seenAMax ? { k: 'a' } : { k: 'n' }; }
        /* `>=` ONLY when the TOK dimension itself has unmeasured data: an always-on
         * marker has the same discriminating power as the 1.2 identity element
         * (measured: it showed while partial was false). */
        return { k: 'p', v: displayMax, bound: tokHasUnmeasured ? '>=' : null };
      })(),
      tok: folded.value,
      max: acc.value,
      /* A DENOMINATOR THAT IS ONLY A LOWER BOUND MUST DEGRADE (ADR §25.3). With `max` no
       * longer poisoned by a null, shares() cannot rely on `max.k !== 'p'`: a null
       * APPLICABLE row makes the max a lower bound exactly like an absent one does.
       * Omitting seenAnyNull here is how the same disease moved out of `add` into this
       * flag (measured: [P5,N,P7] gave an EXACT share while [P5,A,P7] degraded). */
      maxPartial: seenPMax && (seenAMax || seenAnyNull),
      partial: folded.partial,
      count: folded.count,
      bound: TS.lowerBound(folded).bound || null,
      na: naCount,
      tokApplicable: tokApplicableFlags
    };
    /* BARS ARE RETURNED BY project, NOT INDEXED BY THE VIEW (ADR-0048 §50): if the
     * view passed its own index, a filtered/sorted iteration would silently mismatch
     * bars against events (React: "don't use index as key"). Returning the array makes
     * that misalignment UNREPRESENTABLE — the same move as shares(project(x)). */
    /* BARS ARE 1:1 WITH THE SEQUENCE (ADR-0048 §78.3, option 甲): every input event gets
     * a bar, and inapplicable ones carry src 'n/a' at the minimum width. Returning only
     * the measurable subset made the count drift (15 -> 4 on the pinned sample) and
     * silently invalidated the registered expectation that inject rows stay minimum
     * width. 1:1 keeps ONE sequence, so bar j always means event j.
     * Each bar also carries ITS OWN state, so the expanded view never re-reads e.tok. */
    self.bars = events.map(function (e, i) {
      /* THE PROJECTION EMITS THE MEASURED QUANTITY AND THE STATE; geometry belongs to the
       * layout engine (ADR-0048 §100.2). The pixel ruler is GONE, so nothing coexists with
       * the percentage encoding and §99's expected-red assertion turns green here. */
      var appliesTok = applicable(e, TOK_APPLICABLE);
      var st = appliesTok ? tokOf(e) : TS.A();
      var src = appliesTok
        ? (st.k === TS.P(0).k ? 'tok' : (st.k === TS.N().k ? 'null' : 'absent'))
        : (applicable(e, DUR_APPLICABLE) ? 'dur' : 'n/a');
      return { src: src, reason: null, value: st, idx: i,
               eventId: (e && e.id !== undefined) ? e.id : null };
    });
    /* ONE TRUTH SOURCE, TWO VIEWS (ADR-0048 §58.3): the summary is TURN-level while the
     * denominator is SESSION-level. Calling project per turn would change the
     * denominator and reintroduce the drift the brand removed. Each turn also carries
     * ITS OWN bars, so a view expanding turn i cannot silently read turn j's bars
     * (React: "don't use index as key", relocated to the turn axis). */
    var turns = [], cur = null;
    for (var m = 0; m < events.length; m++) {
      if (isTurnMark(events[m])) {
        cur = { id: (events[m] && events[m].id !== undefined) ? events[m].id : null,
                states: [], events: [], rows: [], tok: TS.A(), bars: [] };
        turns.push(cur);
        /* THE MARKER BELONGS TO THE TURN IT OPENS (ADR-0048 §78.7): without this the
         * per-turn bars summed to 14 while self.bars held 15 — two alignments. It
         * does NOT enter `states` (a marker is not applicable to any dimension), so
         * the fold is unchanged. */
        cur.events.push(events[m]);
        cur.rows.push(rowIndexOf[m]);
        continue;
      }
      if (!cur) { continue; }
      cur.events.push(events[m]);
      cur.rows.push(rowIndexOf[m]);
      if (applicable(events[m], TOK_APPLICABLE)) { cur.states.push(tokOf(events[m])); }
    }
    for (var n = 0; n < turns.length; n++) {
      var foldedTurn = TS.fold(turns[n].states);
      turns[n].tok = foldedTurn.value;
      turns[n].partial = foldedTurn.partial;
      /* SAME recorded map as self.bars — searching `list` by event returned -1, which is
       * how the turn-level bars silently became `unknown` (ADR-0048 §78.5). */
      turns[n].bars = turns[n].rows.map(function (r) { return self.bars[r]; });
    }
    self.turns = turns;
    /* ADDITIVITY is the completion invariant (ADR-0048 §59.1): the per-turn sums must
     * roll up to the session figure, on any batch, without hard-coding a number. */
    self.sessionTok = folded.value;
    return self;
  }
  /* foldedCell(r) -> text. Formatting is its ONLY job (King: push the burden of proof
   * upward, but no further — a {text, bars} return would be the wide DTO ADR §27
   * rejected). Printing this text makes "what the UI will show" TESTABLE, and the view
   * shrinks to `el.textContent = foldedCell(r)` — so the value lives in `r`, never in
   * the DOM. Inapplicable rows are already excluded, so a plain number carries no
   * false `>=`. */
  function foldedCell(r) {
    if (!r || r.tok.k === 'a') { return '· 无数据'; }
    if (r.tok.k === 'n') { return '· 未计量'; }
    var body = String(r.tok.v);
    return r.partial ? (body + ' ≥') : body;
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
  /* PIPELINE, not a wide DTO: `shares` accepts ONLY the result of `project`, so the
   * denominator can only come from `projected.max`. The burden of proof is pushed up
   * as far as possible — and no further (King, "Parse, don't validate"): a caller that
   * does not need shares is not forced to compute them. */
  function shares(p) {
    if (!p || p.projected !== true) {
      throw new Error('shares() accepts only the result of project(); refusing to guess a'
        + ' denominator from anything else (a second denominator source is an illegal state).');
    }
    var denomPartial = p.maxPartial;
    var denom = p.max;
    var events = p.states;
    var out = [], nonFinite = 0;
    for (var i = 0; i < events.length; i++) {
      var num = events[i];
      if (denomPartial || denom.k !== 'p') {
        out.push({ value: denom.k === 'a' ? TS.A() : TS.N(), reason: 'denominator-not-measured' });
      } else if (denom.v === 0) {
        out.push({ value: TS.N(), reason: 'denominator-zero' });
      } else if (num.k !== 'p') {
        out.push({ value: num.k === 'a' ? TS.A() : TS.N(), reason: 'numerator-not-measured' });
      } else {
        var d = TS.div(num, denom);
        /* SECOND LINE OF DEFENCE (ADR §26.2): since `div` is TOTAL, a non-finite
         * value can only appear where something bypassed it (a bare `/`). That is
         * the case "loud" must catch — NOT the legitimate unknown. */
        if (d.k === 'p' && !Number.isFinite(d.v)) {
          nonFinite++; out.push({ value: TS.N(), reason: 'non-finite' });
        } else { out.push({ value: d, reason: null }); }
      }
    }
    /* TWO CLASSES OF "LOUD" (measured: reading "must be loud" literally into the render
     * path made THREE cells crash and disappear — worse than showing a fake 0.000):
     *   PROGRAMMER ERROR  -> throw            (bad input shape; see the brand check)
     *   DATA STATE        -> renderable unknown + a COUNTING channel
     * The counter is the same discipline as the pending-overdue WARN: never silent, but
     * it does not take the interface down. The gate asserts it must be 0. */
    /* TWO COUNTERS, because ONE would have closed the gate on honest data:
     *   legitUnknown — a legitimate missing value renders as "unknown". That is the
     *                  CORRECT output of this cell, so it is INFORMATION, not debt.
     *   nonFinite    — NaN/Infinity appeared. The gate asserts this must be 0.
     * A detector that counts the normal unknown as positive has specificity 0 — it is
     * not a detector (same family as "8080 answered, so the panel is up"). */
    /* N/A IS A RELATION, NOT A MISSING VALUE: it enters neither counter. Counting it
     * made legitUnknown ring on every batch (same self-lock as dataUnknowns). */
    var unknownTotal = 0;
    for (var q = 0; q < out.length; q++) {
      if (p.tokApplicable && p.tokApplicable[q] && out[q].value.k !== 'p') { unknownTotal++; }
    }
    out.legitUnknown = unknownTotal - nonFinite;
    out.nonFinite = nonFinite;
    return out;
  }
  /* BAR GEOMETRY as a pure function (ADR-0048 §36/§40): the two diseases both live
   * here — the `1.2` identity element that disguises "no data" as a legal minimum
   * width, and `NaNpx` from a bare `/` on an absent value. So this function:
   *   - NEVER produces NaN or Infinity;
   *   - returns { w, src } with src in {dur, tok, unknown}, and src is what the
   *     completion criterion reads (w alone has no discriminating power);
   *   - treats maxDur as a GLOBAL SWITCH: missing maxDur means every bar is unknown,
   *     even when tok has a value (measured: maxDur=0 collapses tok bars too). */
  /* A PREDICATE INSTEAD OF A LITERAL (ADR-0048 §73.3): the view compared `k === 'p'`
   * against a projection that returns 'P' — no crash, every gate green, and the cell
   * silently showed "unmeasured" forever. Callers ask; they do not spell state.
   * (Zero-hard-coding: the state vocabulary lives HERE, once.) */
  function isPresent(st) { return !!st && st.k === TS.P(0).k; }

  /* THE SHAPE SET HAS ONE SOURCE (ADR-0048 §138): every consumer asks here instead of
   * re-spelling the letters. Adding a shape without teaching the consumers makes them RED,
   * which is the whole point of rule ⑮'s second half. */
  var SHAPES = { p: TS.P(0).k, ps: TS.Pstr('').k, n: TS.N().k, a: TS.A().k };

  /* THE CONSUMER x SHAPE MATRIX (ADR-0048 §139). A guard derived from SHAPES alone cannot do
   * what a compiler does: growing SHAPES would silently WIDEN the gate (`isKnownShape` would
   * return true for the new member and the row would fall through as "not present"). Rust's
   * E0004 fails the build instead. The JS equivalent is this table: every (consumer, shape)
   * pair must be classified as handle or refuse, and an UNCLASSIFIED pair is what a new shape
   * produces — so growth is RED, not silent. */
  var CONSUMERS = {
    /* THREE CLASSES (ADR-0048 §140): handle / refuse / degrade. Two classes force a future
     * "accept but mark" case into `handle` — which is how a silent fallback is born. */
    allocate:  { handle: ['p', 'n', 'a'], refuse: ['ps'], degrade: [] },
    stateText: { handle: ['p', 'n', 'a'], refuse: ['ps'], degrade: [] }
  };
  var SHAPE_ORDER = [SHAPES.p, SHAPES.ps, SHAPES.n, SHAPES.a];

  /* Returns the pairs a new shape would leave unclassified — empty for today's shape set.
   * Pure, so the growth criterion can exercise it without patching any file. */
  function unclassified(shapes) {
    var list = shapes || SHAPE_ORDER;
    var out = [];
    Object.keys(CONSUMERS).forEach(function (c) {
      var cls = CONSUMERS[c];
      list.forEach(function (k) {
        var inH = cls.handle.indexOf(k) > -1, inR = cls.refuse.indexOf(k) > -1;
        var inD = (cls.degrade || []).indexOf(k) > -1;
        var nClass = (inH ? 1 : 0) + (inR ? 1 : 0) + (inD ? 1 : 0);
        if (nClass > 1) { out.push(c + ':' + k + ':multi'); }
        else if (nClass === 0) { out.push(c + ':' + k + ':unclassified'); }
      });
    });
    return out;
  }
  function isKnownShape(k) { return SHAPE_ORDER.indexOf(k) > -1; }
  function assertExhaustive() {
    var bad = unclassified();
    if (bad.length) {
      throw new Error('consumer/shape matrix is not exhaustive: ' + bad.join(', ')
        + ' — classify every pair (ADR-0048 §139).');
    }
  }
  /* "IS A FINITE NUMBER" WITHOUT COERCION (ADR-0048 §116, rule ⑫). `isFinite(null)` is TRUE
   * and `null >= 0` is true, because Number(null) === 0 — a guard written that way cannot
   * see a null in a numeric column. This predicate is the ONE way to ask, and it is tested
   * on null / undefined / NaN / string / boolean so the difference is observable. */
  function isFiniteNumber(x) { return typeof x === 'number' && isFinite(x); }
  /* A STATE BECOMES TEXT HERE, ONCE (ADR-0048 §80.1). The view used to pass a STATE
   * into a number formatter, which is the third instance of the same family: the
   * interface changed shape and the CONSUMER did not (barWidthsFor crashed; `k === 'p'`
   * was never true; this one rendered "unmeasured"/NaN forever). No consumer may spell
   * the states again. */
  function stateText(st) {
    if (!st) { return '\u00b7 \u65e0\u6570\u636e'; }
    if (st.k === SHAPES.p) { return String(st.v); }
    if (st.k === SHAPES.a) { return '\u00b7 \u65e0\u6570\u636e'; }
    if (st.k === SHAPES.n) { return '\u00b7 \u672a\u8ba1\u91cf'; }
    if (!isKnownShape(st.k)) { /* falls through to the throw below, made explicit here */ }
    /* EXHAUSTIVE ENUMERATION (ADR-0048 §137 — the second half of rule ⑮). An `else` meaning
     * "everything else is no-data" is the LIMIT CASE of judging by appearance: it does not
     * even look. Before this, a narrative fact (`ps`) rendered as "no data" — the worst
     * failure shape, because it reads as "this machine reported nothing". */
    throw new Error('stateText: unlisted shape k=' + String(st && st.k)
      + ' — enumerate it explicitly (ADR-0048 §137).');
  }
  /* The vocabulary is DERIVED from the algebra, never re-spelled: the first draft of
   * this predicate wrote 'P' while the algebra emits 'p', which would have shown
   * "unmeasured" forever with every gate green (ADR-0048 §73.3). */
  /* ── COLUMN ALLOCATION (ADR-0048 §92/§93/§94) ───────────────────────────────
   * THREE CHANNELS, each with ONE source: POSITION = order/time (all rows),
   * LENGTH = value (present rows only), COLOUR/TEXT = state.
   * The tick is a RULE, not a taste constant (three failure modes measured):
   *   B: a fixed tick wider than the smallest real value INVERTS the ordering;
   *   C: enough unknowns make budget*n exceed 100 => NEGATIVE width;
   *   D: a segment with no present rows leaves the budget dangling / divides by 0.
   * PROVENANCE OF EACH CONSTANT (no taste):
   *   TICK_K = 2            tick = minPresent/K, so K > 1 is DERIVED from "strictly
   *                         narrower than the smallest real value" — not chosen.
   *   CELL_PCT              README: the terminal is "a grid of deterministic, semantic
   *                         cells", so the minimum visible width is ONE CELL, derived
   *                         from the column count — not 0.5%.
   *   RESERVE_CAP_PCT       reverse-derived from "present must stay distinguishable".
   * The degraded branch is a STATE IN THE PROJECTION (silicon-readable), never just
   * equal widths + colour: "colors represent system states, never decoration".
   * ─────────────────────────────────────────────────────────────────────────── */
  var TICK_K = 2;
  /* PROVENANCE (§94.3/§97.3): README says the terminal is "a grid of deterministic,
   * semantic cells", so ONE CELL is the minimum visible width. 200 is a DEFAULT that must
   * come from the real terminal (measure its column count; 80 columns => 1.25%). The
   * alignment the renderer actually uses must be declared here if it is not cell-aligned. */
  var GRID_COLS_DEFAULT = 200;
  function cellPctOf(gridCols) { return 100 / ((gridCols > 0) ? gridCols : GRID_COLS_DEFAULT); }
  var RESERVE_CAP_PCT = 50;

  function allocate(rows, opts) {
    assertExhaustive();   /* a new shape must be classified BEFORE it can reach here */
    /* EXHAUSTIVE, NOT A ONE-SHAPE WHITELIST (ADR-0048 §138). The first version refused only
     * `ps`, so a FIFTH shape reached the allocation as if it were absent — measured:
     * allocate([{k:'zz'}, P(5)]) gave cols=[0.5, 99.5], state='ok', reason=null, BIT-IDENTICAL
     * to a real absent row. Rule ⑮ exists to catch the shape someone adds later; a guard that
     * only knows today's shapes cannot do that. */
    for (var qi = 0; qi < rows.length; qi++) {
      var qs = rows[qi] && rows[qi].state;
      if (!qs || !isKnownShape(qs.k)) {
        throw new Error('allocate: UNKNOWN shape k=' + String(qs && qs.k)
          + ' — a new shape must be taught to every consumer (ADR-0048 §138).');
      }
      if (qs.k === SHAPES.ps) {
        throw new Error('allocate: a NARRATIVE fact (k=ps) cannot be allocated —'
          + ' ADR-0048 §138 (magnitudes only).');
      }
    }
    /* EVERY BRANCH REPORTS WHAT IT SAW, PER SHAPE (ADR-0048 §140). Without this, `n` and `a`
     * were BIT-IDENTICAL on the way out: a handled shape was indistinguishable from an ignored
     * one, so "accept => handled" held literally and failed OBSERVATIONALLY. */
    var counts = { p: 0, ps: 0, n: 0, a: 0 };
    for (var ci = 0; ci < rows.length; ci++) {
      var ck = rows[ci] && rows[ci].state && rows[ci].state.k;
      if (counts[ck] !== undefined) { counts[ck]++; }
    }
    var gridCols = (opts && opts.gridCols > 0) ? opts.gridCols : GRID_COLS_DEFAULT;
    var CELL_PCT = cellPctOf(gridCols);
    /* THE LENGTH CHANNEL'S QUANTITY IS DECLARED AT THE CALL SITE (ADR-0048 §110.4/§111.1).
     * allocate never guesses it; the view declares it, and the two declarations are:
     *   mode 'equal' => the length channel is CLOSED: every cell is equal and only the
     *                   POSITION channel carries information (this is the view's DEFAULT,
     *                   S.durMode === 'equal'). 1.2 / PEND_MIN / toFixed have no meaning
     *                   here — closed, not "converted".
     *   mode 'value' => the length channel encodes the declared quantity; rows whose state
     *                   is not present do not enter the allocation.
     * Anything else is a PROGRAMMER error, not a data state: an undeclared quantity must
     * never default silently (this cell's whole failure family is silent defaults). */
    /* NO SILENT DEFAULT: the declaration is mandatory. A defaulted mode is exactly the
     * silent-default family this cell exists to remove (the first draft defaulted to
     * 'equal' and turned seven value-mode assertions red — the failure was in MY default,
     * not in them). */
    if (!opts || !opts.mode) {
      throw new Error('allocate: the length-channel mode must be DECLARED'
        + ' (mode: "equal" | "value", ADR-0048 §110.4).');
    }
    var mode = opts.mode;
    if (mode !== 'equal' && mode !== 'value') {
      throw new Error("allocate: undeclared length-channel mode '" + mode
        + "' (ADR-0048 §110.4: the caller declares the quantity).");
    }
    if (mode === 'equal') {
      /* BOTH MODES REPORT THE SAME RULER (§112.3): gridCols is USED (not silently ignored)
       * and cellPct is returned, so equal and value cannot drift onto two different scales
       * — separate scales per panel is the cardinal sin of small multiples. */
      return { counts: counts, state: 'unavailable', reason: 'length-closed', gridCols: gridCols,
               cellPct: CELL_PCT,
               cols: rows.length ? rows.map(function () { return 100 / rows.length; }) : [],
               tickPct: 0 };
    }
    /* EMPTY IS ITS OWN REASON, AND IT IS CHECKED FIRST (§118.4): "no rows" is a different
     * fact from "rows but none measured", and the later `present.length === 0` branch would
     * otherwise swallow it (measured: allocate([]) returned 'no-present-rows'). */
    if (rows.length === 0) {
      return { counts: counts, state: 'unavailable', reason: 'empty', cols: [], tickPct: 0, gridCols: gridCols };
    }
    /* rows: [{state}] where state is a three-state value. Returns ONE object with the
     * per-column percentages AND the row-level state, from one projection pass. */
    var present = [], i;
    for (i = 0; i < rows.length; i++) { if (isPresent(rows[i].state)) { present.push(rows[i].state.v); } }
    var nUnknown = rows.length - present.length;
    if (present.length === 0 || nUnknown === 0 && present.length === 0) {
      /* EVERY BRANCH RETURNS cols OF THE SAME LENGTH AS rows (ADR-0048 §108): a consumer
       * that indexes by row must never receive a short array, or it silently reads
       * undefined (the shape of the failures this cell keeps producing). */
      return { counts: counts, state: 'unavailable', reason: 'no-present-rows',
               cols: rows.map(function () { return CELL_PCT; }), tickPct: 0, gridCols: gridCols };
    }
    if (nUnknown === 0) {
      /* ALL PRESENT — ALLOCATE THE WHOLE WIDTH BY THE DECLARED QUANTITY, NEVER `null`
       * (ADR-0048 §116). `null` in a numeric context IS 0, so the previous shape made every
       * lane zero-width while a `isFinite(c) && c >= 0` guard stayed green
       * (Number(null) === 0). That was a REGRESSION introduced by step 2 and caught by
       * review, not by the assertion — the guard, not the code, was the weak link.
       * If every declared quantity is zero the split is EQUAL: an explicitly declared
       * state (`all-zero-declared`), never a `|| 1` fallback (the additive-identity trap). */
      var sumAll = 0, k;
      for (k = 0; k < rows.length; k++) { sumAll += rows[k].state.v; }
      if (sumAll === 0) {
        return { counts: counts, state: 'ok', reason: 'all-zero-declared',
                 cols: rows.map(function () { return 100 / rows.length; }), tickPct: 0,
                 gridCols: gridCols };
      }
      return { counts: counts, state: 'ok', reason: null,
               cols: rows.map(function (r) { return (r.state.v / sumAll) * 100; }), tickPct: 0,
               gridCols: gridCols };
    }
    var minPresent = Math.min.apply(null, present), sumPresent = 0;
    for (i = 0; i < present.length; i++) { sumPresent += present[i]; }
    /* THE INVARIANT MUST BE STATED ON THE ACTUAL ALLOCATED WIDTH, not on the raw value
     * (my first rule used minPresent/K and my own assertion caught it: with a 1000:1
     * spread the unknown column came out WIDER than the smallest real one — ordering
     * inverted). present rows are scaled by `remaining`, so the bound is
     *     tick <= s(100 - n*tick)   with s = minPresent/sumPresent
     * =>  tick <= 100*s/(1 + n*s), and TICK_K > 1 makes it strictly narrower. */
    var minShare = sumPresent === 0 ? 0 : minPresent / sumPresent;
    var tick = Math.min(CELL_PCT, (100 * minShare) / (TICK_K + nUnknown * minShare));
    /* "CANNOT FIT" IS ITS OWN STATE (ADR-0048 §98.3). Clamping every unknown column to one
     * cell is fine only while n * cell <= 100; beyond that the clamp itself overflows the
     * row (measured 250 columns => 312%), which is aliasing, not rendering. The row is a
     * WINDOW on a long strip: when the unknowns outnumber the grid, the honest answer is a
     * declared state, not a clamped sum. (Windowing itself belongs to the on-demand
     * rendering line.) */
    if (nUnknown > gridCols) {
      return { counts: counts, state: 'unavailable', reason: 'row-exceeds-grid',
               cols: rows.map(function () { return CELL_PCT; }), tickPct: tick, gridCols: gridCols };
    }
    if (nUnknown * tick > RESERVE_CAP_PCT) {
      /* DEGRADED: say so in the projection, do not fabricate a proportion. */
      return { counts: counts, state: 'unavailable', reason: 'reserve-over-budget',
               /* CLAMP TO ONE CELL (§97.3): equal widths narrower than a cell are
                * invisible, and a degradation that loses the core capability is not a
                * degradation but a failure. */
               cols: rows.map(function () { return Math.max(CELL_PCT, 100 / rows.length); }), tickPct: tick };
    }
    var remaining = 100 - nUnknown * tick, cols = [], p = 0;
    for (i = 0; i < rows.length; i++) {
      if (isPresent(rows[i].state)) {
        cols.push(sumPresent === 0 ? 0 : (rows[i].state.v / sumPresent) * remaining / 1);
      } else { cols.push(tick); }
    }
    return { counts: counts, state: 'ok', reason: null, cols: cols, tickPct: tick, remainingPct: remaining,
             gridCols: gridCols };
  }

  return { P: TS.P, Pstr: TS.Pstr, N: TS.N, A: TS.A, isPresent: isPresent, isFiniteNumber: isFiniteNumber, modeOf: modeOf,
           SHAPES: SHAPES, isKnownShape: isKnownShape, unclassified: unclassified,
           assertExhaustive: assertExhaustive,
           stateText: stateText,
           allocate: allocate, cellPctOf: cellPctOf, GRID_COLS_DEFAULT: GRID_COLS_DEFAULT,
           TICK_K: TICK_K, RESERVE_CAP_PCT: RESERVE_CAP_PCT,
           foldedCell: foldedCell,
           BAR_KEYS: BAR_KEYS,
           tokOf: tokOf, durOf: durOf, scopeOf: scopeOf, ptrGet: ptrGet,
           project: project, ratioOf: ratioOf, shares: shares };
}));
