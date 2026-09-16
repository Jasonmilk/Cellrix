/* Node-side consumption for the trajectory (Cellrix:ADR-0018 batch 4).
 *
 * Everything here takes a NODE, not an event:
 *
 *   kind      semantic, from the contract
 *   payload   interpreted, from the contract
 *   node/ord  identity and position
 *
 * There is no protocol name in this file. A consumer that wanted to re-read the
 * protocol would have no name to branch on and no raw fields to read. The type
 * lock is satisfied by what this file does not have.
 *
 * What a row LOOKS like comes from prove_track.render.js (the tables). This
 * file turns one node into that row's content (the panes) and a node stream
 * into the session the view walks.
 */
(function () {
  'use strict';

  var PT = window.CxProveTrack = window.CxProveTrack || {};
  var EF = window.CxEventFamily;
  if (!EF) {
    throw new Error('prove_track.node.js requires event_family.js to load first');
  }
  var R = PT.render;
  if (!R) {
    throw new Error('prove_track.node.js requires prove_track.render.js to load first');
  }
  var D = PT.data;
  if (!D) {
    throw new Error('prove_track.node.js requires prove_track.data.js to load first');
  }
  var jsonOf = D.jsonOf, short = D.short, ABSENT = D.ABSENT;

  function hasOutcome(p) { return p.outcome != null; }
  function hasNodes(p) { return ((p.choice && p.choice.top) || []).length > 0; }

  /* ---- tool name and the panes ------------------------------------------ */
  function toolNameOf(node) {
    if (node.kind !== 'tool') { return null; }
    return node.payload.tool || 'tool';
  }

  function payloadOf(node) {
    var p = node.payload;
    switch (node.kind) {
      case 'message':
        return jsonOf({ role: 'user', content: p.text });
      case 'reasoning':
        return jsonOf({ role: 'assistant', stage: 'think', text: p.text });
      case 'reply':
        return jsonOf({ role: 'assistant', stage: 'reply', text: p.text,
                        chars: p.chars, model: p.model });
      case 'plan':
        return jsonOf(p.empty ? { empty: true, text: '' } : { text: p.text });
      default:
        return jsonOf(p);
    }
  }

  /* The Result pane. This is the pane a reviewer reads, so it shows the
   * BUSINESS artifact rather than a summary of it: a tool's outcome verbatim
   * (pretty-printed when it is JSON), the node hits a context injection chose,
   * and the reason behind a criterion. A digest once stood here in place of the
   * outcome — a digest proves it is the same artifact, it does not show what
   * the artifact said.
   */
  function prettyJson(text) {
    try { return JSON.stringify(JSON.parse(text), null, 2); } catch (err) { return text; }
  }

  function detailOf(node) {
    var p = node.payload;
    switch (node.kind) {
      case 'context':
        if (!hasNodes(p)) { return '(no node hit)'; }
        /* The pane lists TOP hits. Saying how many there are is not decoration:
         * `nodes=20` beside three lines reads as missing data otherwise. */
        var top = p.choice.top || [];
        var head = (p.nodes != null && p.nodes > top.length)
          ? 'top ' + top.length + ' of ' + p.nodes + '\n' : '';
        return head + top.map(function (n) {
          return n.tier + '·' + n.activation + ' ' + short(n.id || '', 12) + ' ' + (n.phase || '');
        }).join('\n');
      case 'tool':
        if (p.stage === 'call') { return 'awaiting tool response…'; }
        return hasOutcome(p) ? prettyJson(String(p.outcome)) : ABSENT;
      case 'check':
        return 'actual=' + (p.actual || ABSENT) + (p.reason ? '\n' + p.reason : '');
      case 'verdict':
        return p.reason || ABSENT;
      case 'reasoning':
        return '(full thinking in Payload)';
      case 'reply':
        return p.chars != null ? p.chars + ' chars' : '(full reply in Payload)';
      case 'plan':
        return '(intent and calls in Payload)';
      default:
        return '—';
    }
  }

  /* An outcome that is a fragment of terminal output is rendered as one. The
   * rule reads a payload VALUE, not a protocol name — the same judgement the
   * event-based layer made, which could never fire there because it was handed
   * a session row and asked for an event. */
  function resultIsTerm(node) {
    if (node.kind !== 'tool' || node.payload.stage !== 'result') { return false; }
    return /^[#$>]/.test(String(node.payload.outcome || ''));
  }

  /* ---- period metering --------------------------------------------------
   * Metering is a kind, not a protocol name. No metering node means the
   * upstream reported nothing means the fact does not exist — no
   * approximation, and an overflow withholds the whole aggregate rather than
   * publishing a wrapped sum. Three rules, unchanged from ADR-0038:
   *   1. DISJOINT counts: input = prompt - cached.
   *   2. OPTIONAL BUCKETS ARE ALL-OR-NOTHING.
   *   3. ABSENT MEANS OMITTED.
   */
  function safeCount(n) {
    return typeof n === 'number' && isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
  }

  /* Metering is a fact about ONE period. Grouping by the node's source and
   * running the same derivation per group is the whole implementation — one
   * derivation function, applied to the group it is about. */
  function usageBySource(nodes) {
    var by = {};
    (nodes || []).forEach(function (n) {
      if (n.kind !== 'metering') { return; }
      (by[n.source] = by[n.source] || []).push(n);
    });
    Object.keys(by).forEach(function (k) { by[k] = derivePeriodUsage(by[k]); });
    return by;
  }

  function derivePeriodUsage(nodes) {
    var calls = 0, prompt = 0, completion = 0;
    var cachedSum = 0, cachedAll = true, reasoningSum = 0, reasoningAll = true;
    (nodes || []).forEach(function (n) {
      if (n.kind !== 'metering') { return; }
      var p = n.payload || {};
      if (!safeCount(p.promptTokens) || !safeCount(p.completionTokens)) { return; }
      calls++;
      prompt += p.promptTokens;
      completion += p.completionTokens;
      if (p.cachedTokens == null) { cachedAll = false; } else { cachedSum += p.cachedTokens; }
      if (p.reasoningTokens == null) { reasoningAll = false; } else { reasoningSum += p.reasoningTokens; }
    });
    if (!calls) { return null; }
    if (!safeCount(prompt) || !safeCount(completion)) { return null; }
    var cached = (cachedAll && safeCount(cachedSum)) ? cachedSum : null;
    var reasoning = (reasoningAll && safeCount(reasoningSum)) ? reasoningSum : null;
    return {
      calls: calls, prompt: prompt, completion: completion,
      cached: cached, reasoning: reasoning,
      input: (cached == null) ? null : prompt - cached,
      total: prompt + completion
    };
  }

  /* ---- build: node stream -> SESSION -----------------------------------
   *
   * An item carries every fact a row needs and nothing else: what it is drawn
   * as (cls/lane), how it reads (summary), what it measures (dur/tok), how it
   * can be traced back (id/ord/ts), and what it unfolds to (payload/detail/
   * term/full/schema).
   */
  function buildSession(nodes) {
    /* The filter IS the render table: no SUMMARY entry means no row. */
    var shown = (nodes || []).filter(function (n) { return !!R.SUMMARY[n.kind]; });
    /* Over the WHOLE stream, not the drawn subset: metering is precisely the
     * kind that is not drawn, so deriving from `shown` would find no call to
     * total and the reply row would carry nothing. Measured: it did. */
    var perSource = usageBySource(nodes);
    var out = [];
    var seenTurn = {};

    shown.forEach(function (n, i) {
      var spec = R.specFor(n) || {};
      /* A turn header per distinct turn, emitted where the turn first appears —
       * a resumed session has more than one, and pinning them all to 't1'
       * silently merged them. The ordinal arrives on the node. */
      if (n.turn && !seenTurn[n.turn]) {
        seenTurn[n.turn] = true;
        out.push({
          kind: 'turn', id: n.turn,
          index: Number(String(n.turn).slice(1)),
          /* Which period this turn came from. A merged chain is exactly where a
           * reader needs it: without it every header over ten periods says the
           * same nothing. */
          note: short(n.source || 'a session', 24)
        });
      }
      var dur = 0;
      if (spec.dur) {
        dur = n.payload[spec.dur] || 0;
      } else if (spec.gap) {
        /* The wait that ENDED at this row, not the wait that follows it.
         *
         * These rows are the RESPONSE side of a call: the runtime writes them
         * once the model has answered, so the interval that produced them sits
         * between the previous drawn row and this one. Measured on the chain
         * under review: request side at 08:30:49, response side at 08:30:54 —
         * five seconds of inference, which the old (forward-looking) gap
         * attributed to whatever came NEXT and therefore reported as nothing.
         * The call latency was in the data the whole time; it was being read
         * off the wrong end. */
        var prev = shown[i - 1];
        var a = prev ? Date.parse(prev.ts) : NaN, b = Date.parse(n.ts);
        dur = (isFinite(a) && isFinite(b)) ? Math.max(0, b - a) : 0;
      }
      out.push({
        kind: 'ev', id: n.node, source: n.source, turn: n.turn, ord: n.ord, ts: n.ts,
        cls: EF.classOf(n), lane: R.laneOf(n.kind),
        dur: dur,
        status: R.statusOf(n), summary: R.summarize(n),
        tool: toolNameOf(n),
        /* The Schema pane: what this kind is, and the fields the contract
         * declares for it. The second half is derived, so the pane cannot drift
         * from the contract the row was interpreted through. */
        kindNote: R.KIND_NOTE[n.kind] || '', fields: R.fieldsOf(n.kind),
        payload: payloadOf(n), detail: detailOf(n), term: resultIsTerm(n),
        /* The deliverable row is kept verbatim so expanding it shows the whole
         * answer rather than the truncated summary (no fake expand). */
        full: R.bodyOf(n),
        /* The row carries ITS OWN period's metering total, not the window's.
         * Stamping the window total on every reply row made three different
         * answers report the same number — measured: 1129 / 1696 / 1573 became
         * 4398 / 4398 / 4398, which is physically impossible. */
        tok: (n.kind === 'reply' && perSource[n.source]) ? perSource[n.source].total : null
      });
    });
    return out;
  }

  /* ---- stuck detection: run-length state machine, marks once at the tail --- */
  function computeRepeats(session) {
    var TOOL = EF.KIND_CLASS.tool;
    session.forEach(function (e) { if (e.kind === 'ev') { delete e.repeat; } });
    var tool = null, streak = [];
    function flush() {
      if (streak.length >= 3) { streak[streak.length - 1].repeat = streak.length; }
      streak = [];
    }
    session.forEach(function (e) {
      if (e.kind !== 'ev') { return; }
      if (e.cls === TOOL && e.status === 'fail') {
        if (e.tool !== tool) { flush(); tool = e.tool; }
        streak.push(e);
      } else { flush(); tool = null; }
    });
    flush();
  }

  PT.node = {
    /* the pageless primitives a document projection needs, named once */
    toolNameOf: toolNameOf, payloadOf: payloadOf, detailOf: detailOf,
    resultIsTerm: resultIsTerm,
    derivePeriodUsage: derivePeriodUsage, usageBySource: usageBySource,
    buildSession: buildSession, computeRepeats: computeRepeats
  };
})();
