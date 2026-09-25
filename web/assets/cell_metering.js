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
  var DUR_PATHS = ['/data/duration_ms'];
  function readChain(e, paths) {
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
      return TS.P(cur);                           /* incl. 0                      */
    }
    return TS.A();                                /* nothing recorded             */
  }
  function tokOf(e) { return readChain(e, TOK_PATHS); }
  function durOf(e) { return readChain(e, DUR_PATHS); }
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
    var list = [];
    for (var i = 0; i < events.length; i++) { list.push(tokOf(events[i])); }
    var folded = TS.fold(list);
    var acc = TS.start(), seenPMax = false, seenAMax = false, seenAnyNull = false;
    var displayMax = null;
    for (var j = 0; j < list.length; j++) {
      if (list[j].k === 'p') { seenPMax = true; }
      if (list[j].k === 'a') { seenAMax = true; }
      if (list[j].k === 'n') { seenAnyNull = true; }
      if (list[j].k === 'p') { displayMax = (displayMax === null) ? list[j].v
                                                              : Math.max(displayMax, list[j].v); }
      acc = { value: TS.max(acc.value, list[j]), seenP: seenPMax, seenA: seenAMax };
    }
    return {
      states: list,
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
        return { k: 'p', v: displayMax, bound: (seenAMax || seenAnyNull) ? '>=' : null };
      })(),
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
    var unknownTotal = out.filter(function (x) { return x.value.k !== 'p'; }).length;
    out.legitUnknown = unknownTotal - nonFinite;
    out.nonFinite = nonFinite;
    return out;
  }
  return { tokOf: tokOf, durOf: durOf, scopeOf: scopeOf, ptrGet: ptrGet,
           project: project, ratioOf: ratioOf, shares: shares };
}));
