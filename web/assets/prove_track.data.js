/* ============================================================
  Cellrix prove-track data layer (ADR-0016 D1/D6) — pure functions, zero state
  Anaphase event stream -> trajectory SESSION
  Mapping rule: physical facts first — absent data renders as —, never invented.
  Cross-asset communication goes through the window.CxProveTrack namespace (ADR-0016 D2).
  ============================================================ */
(function () {
  'use strict';
  var PT = window.CxProveTrack = window.CxProveTrack || {};

  // The assembly layer owns the tape and derives coordinates from it
  // (ADR-0018). Without it there is no source of truth for node ids or turns,
  // so failing loudly beats deriving them twice.
  var ASM = window.CxAssembly;
  if (!ASM) {
    throw new Error('prove_track.data.js requires assembly.js to load first');
  }

  /* ---------- Primitives ---------- */
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function jsonOf(d) { try { return JSON.stringify(d, null, 2); } catch (e) { return String(d); } }
  function short(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }
  function firstLine(s, n) { s = String(s || '').split('\n')[0]; return short(s, n || 100); }

  /* ---------- Event vocabulary (measured on the wire) ---------- */
  var STATUS = {
    ok: { t: 'success', c: 'ok' }, fail: { t: 'failure', c: 'fail' },
    pending: { t: 'pending', c: 'pending' }, done: { t: 'done', c: 'done' }
  };
  var SCHEMA_NOTE = {
    'turn/start': 'turn/start — cognitive cycle begins (no payload)',
    'user/message': 'user/message — human input',
    'context/inject': 'context/inject — SA-Core context injection (L1/L3 memory selection)',
    'assistant/think': 'assistant/think — model reasoning trace (thinking, not presented to the human directly)',
    'assistant/attempt': 'assistant/attempt — model action intent (tool-call plan or direct answer)',
    'tool/call': 'tool/call — tool call emitted, awaiting response',
    'tool/result': 'tool/result — tool execution result; outcome is the business artifact (protocol fields excluded)',
    'check/status': 'check/status — criterion verdict (hard block / soft ledger)',
    'verdict/status': 'verdict/status — verdict of this cycle (Met / Unmet)',
    'assistant/reply': 'assistant/reply — model final answer (the deliverable of this cycle, end of the closed loop)',
    'turn/end': 'turn/end — cognitive cycle ends (done/success/impasse)'
  };
  var TYPES = {
    'turn/start': { type: 'SYSTEM', track: 'model' },
    'user/message': { type: 'USER', track: 'input' },
    'context/inject': { type: 'CONTEXT', track: 'input' },
    'assistant/think': { type: 'THINK', track: 'model' },
    'assistant/attempt': { type: 'ATTEMPT', track: 'model' },
    'tool/call': { type: 'TOOL', track: 'tool' },
    'tool/result': { type: 'TOOL', track: 'tool' },
    'check/status': { type: 'CHECK', track: 'tool' },
    'verdict/status': { type: 'VERDICT', track: 'tool' },
    'assistant/reply': { type: 'REPLY', track: 'model' },
    'turn/end': { type: 'END', track: 'model' }
  };

  /* ---------- Event -> presentation mapping ---------- */
  function summarize(e) {
    var d = e.data || {}, t = e.type;
    if (t === 'turn/start') return 'cognitive cycle started';
    if (t === 'user/message') return short(d.text, 140);
    if (t === 'context/inject') {
      var s = 'context inject · SA-Core selection';
      var tiers = (d.choice && d.choice.tiers) || {};
      var ks = Object.keys(tiers);
      if (ks.length) s += ' ' + ks.map(function (k) { return k + '×' + tiers[k]; }).join(' ');
      s += ' · nodes=' + d.nodes + ' chars=' + d.chars;
      if (d.resume_from) s += ' · resume ' + short(d.resume_from, 24);
      return s;
    }
    if (t === 'assistant/think') return 'think: ' + firstLine(d.text, 100);
    if (t === 'assistant/reply') {
      var tag = d.model ? '[' + d.model + '] ' : '';
      return 'reply: ' + tag + firstLine(d.text, 140) + ' (click to expand)';
    }
    if (t === 'assistant/attempt') {
      if (d.empty) return '(empty reply — honest marker, nothing invented)';
      var txt = String(d.text || '');
      var calls = null;
      try { var o = JSON.parse(txt); if (o && o.calls) calls = o.calls; } catch (e) {}
      if (calls) return 'planned calls: ' + calls.map(function (c) { return c.tool; }).join(', ');
      return 'reply: ' + firstLine(txt, 100);
    }
    if (t === 'tool/call') return (d.tool || 'tool') + ' · #' + d.index + ' · expect=' + esc(d.expect);
    if (t === 'tool/result') return (d.tool || 'tool') + ' · ' + (d.ok ? 'ok' : 'fail') + ' · ' +
      (d.duration_ms != null ? d.duration_ms + 'ms' : '—') +
      (d.outcome_sha ? ' · sha ' + d.outcome_sha : '');
    if (t === 'check/status') return ((d.gate || 'gate') + ' · ' + (d.check || '') +
      ' · ' + (d.passed ? 'PASS' : 'FAIL') + ' · expect=' + (d.expect || '—')).replace(/^gate/,'HARD').replace('HARD · ','HARDrule · ');
    if (t === 'verdict/status') return d.status + (d.reason ? ' · ' + d.reason : '');
    if (t === 'turn/end') {
      var r = 'done=' + d.done + ' · success=' + d.success;
      if (d.verdict) r += ' · verdict=' + d.verdict;
      if (d.impasse) r += ' · impasse';
      return r;
    }
    return t;
  }
  function statusOf(e) {
    var d = e.data || {}, t = e.type;
    if (t === 'tool/call') return 'pending';
    if (t === 'tool/result') return d.ok ? 'ok' : 'fail';
    if (t === 'check/status') return d.passed ? 'ok' : 'fail';
    if (t === 'verdict/status') return d.status === 'Met' ? 'ok' : 'fail';
    return 'done';
  }
  function toolName(e) {
    var d = e.data || {};
    return d.tool || (e.type === 'tool/call' ? 'tool' : null);
  }
  function payloadOf(e) {
    var d = e.data || {}, t = e.type;
    if (t === 'user/message') return jsonOf({ role: 'user', content: d.text });
    if (t === 'assistant/think') return jsonOf({ role: 'assistant', stage: 'think', text: d.text });
    if (t === 'assistant/reply') return jsonOf({ role: 'assistant', stage: 'reply', text: d.text, chars: d.chars, model: d.model });
    if (t === 'assistant/attempt') return jsonOf(d.empty ? { empty: true, text: '' } : { text: d.text });
    return jsonOf(d);
  }
  function resultOf(e) {
    var d = e.data || {}, t = e.type;
    if (t === 'context/inject') {
      var top = (d.choice && d.choice.top) || [];
      if (!top.length) return '(no node hit)';
      return top.map(function (n) {
        return n.tier + '·' + n.heat + ' ' + short(n.id || '', 12) + ' ' + (n.phase || '');
      }).join('\n');
    }
    if (t === 'tool/call') return 'awaiting tool response…';
    if (t === 'tool/result') {
      var out = d.outcome;
      try { return JSON.stringify(JSON.parse(out), null, 2); } catch (e) { return out || '—'; }
    }
    if (t === 'check/status') return 'actual=' + (d.actual || '—') + (d.reason ? '\n' + d.reason : '');
    if (t === 'verdict/status') return d.reason || '—';
    if (t === 'user/message' || t === 'turn/end' || t === 'turn/start') return '—';
    if (t === 'assistant/think') return '(full thinking in Payload)';
    if (t === 'assistant/reply') return d.chars != null ? d.chars + ' chars' : '(full reply in Payload)';
    if (t === 'assistant/attempt') return '(intent and calls in Payload)';
    return '—';
  }
  function resultIsTerm(e) {
    return e.type === 'tool/result' && /^[#\$>]/.test(String(e.data.outcome || ''));
  }

  /* ---------- Formatting ---------- */
  function fmtDur(ms) { return ms === 0 ? '—' : (ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(2) + 's'); }
  // null/undefined = the fact does not exist; 0 = the fact IS zero. Two
  // different things, two different renderings (DNA principle 11: never a
  // fake placeholder).
  function fmtTok(n) { return (n == null) ? '—' : Number(n).toLocaleString('en-US'); }

  /* ---------- Period metering derivation (ADR-0038) ----------
     The event stream is the single source of truth: the write side records only
     the raw fact of each call (assistant/usage); aggregation is derived here on
     demand — a pure function, same input gives same output, replayable, zero
     model calls. Three hard rules:
       1. DISJOINT counts: input = prompt - cached. The upstream prompt_tokens
          already includes cache hits, so showing it raw would count the same
          tokens twice.
       2. OPTIONAL BUCKETS ARE ALL-OR-NOTHING: if not every call reported a
          bucket, the whole bucket is omitted instead of summing a partial set
          (the per-call detail stays intact in the event stream; only the
          untrustworthy aggregate is withheld).
       3. ABSENT MEANS OMITTED: nothing is nothing, never an estimate.
  */
  function safeCount(n) {
    return typeof n === 'number' && isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
  }

  function derivePeriodUsage(events) {
    var calls = 0, prompt = 0, completion = 0;
    var cachedSum = 0, cachedAll = true, reasoningSum = 0, reasoningAll = true;
    (events || []).forEach(function (e) {
      if (e.type !== 'assistant/usage') return;
      var d = e.data || {};
      if (!safeCount(d.prompt_tokens) || !safeCount(d.completion_tokens)) return;
      calls++;
      prompt += d.prompt_tokens;
      completion += d.completion_tokens;
      if (d.cached_tokens == null) cachedAll = false; else cachedSum += d.cached_tokens;
      if (d.reasoning_tokens == null) reasoningAll = false; else reasoningSum += d.reasoning_tokens;
    });
    // No metering event = the upstream reported nothing = the fact does not
    // exist. No approximation.
    if (!calls) return null;
    // Sum overflow: withhold the whole aggregate rather than publish a
    // wrapped sum.
    if (!safeCount(prompt) || !safeCount(completion)) return null;
    var cached = (cachedAll && safeCount(cachedSum)) ? cachedSum : null;
    var reasoning = (reasoningAll && safeCount(reasoningSum)) ? reasoningSum : null;
    return {
      calls: calls,
      prompt: prompt,
      completion: completion,
      cached: cached,
      reasoning: reasoning,
      // Disjoint input: unknowable when cached is absent (prompt - 0 would be
      // guessing a cache miss).
      input: (cached == null) ? null : prompt - cached,
      total: prompt + completion
    };
  }

  /* ---------- Build: Anaphase event stream -> SESSION ---------- */
  function buildSession(events, meta) {
    var out = [];
    var note = (meta && (meta.name || meta.preview)) || 'a session';
    // Keep only events that render: dur is the gap to the NEXT RENDERED event.
    // Metering events do not render, so letting them into the gap baseline
    // would collapse the existing durations.
    var shown = (events || []).filter(function (e) { return !!TYPES[e.type]; });
    // Node ids and turn numbers are the assembly's job (ADR-0018 D5), derived
    // from the tape rather than counted as events arrive.
    var coords = ASM.deriveCoordinates(shown, meta);
    var usage = derivePeriodUsage(events);
    var seenTurn = {};
    shown.forEach(function (e, i) {
      var map = TYPES[e.type];
      var coord = coords[i];
      // A turn header per distinct turn, emitted where the turn first appears —
      // a resumed session has more than one, and pinning them all to 't1'
      // silently merged them.
      if (!seenTurn[coord.turn]) {
        seenTurn[coord.turn] = true;
        out.push({
          kind: 'turn', id: coord.turn,
          index: Number(coord.turn.slice(1)), note: short(note, 60)
        });
      }
      var dur = 0;
      if (e.type === 'tool/result') dur = e.data.duration_ms || 0;
      else if (e.type === 'assistant/think' || e.type === 'assistant/attempt') {
        var nxt = shown[i + 1];
        if (nxt) dur = Math.max(0, Date.parse(nxt.time) - Date.parse(e.time));
      }
      out.push({
        kind: 'ev', id: coord.node, turn: coord.turn,
        type: map.type, track: map.track,
        dur: dur,
        // The deliverable row carries this period's metering total (a derived
        // view; the event stream remains the only source).
        tok: (e.type === 'assistant/reply' && usage) ? usage.total : null,
        tool: toolName(e),
        summary: summarize(e), status: statusOf(e),
        payload: payloadOf(e), result: resultOf(e),
        // REPLY full deliverable: kept verbatim so inline expand shows the
        // complete answer, not the truncated summary (no fake expand).
        full: e.type === 'assistant/reply' ? (e.data.text || '') : '',
        schema: SCHEMA_NOTE[e.type] || e.type, seq: e.seq, time: e.time
      });
    });
    return out;
  }

  /* ---------- Stuck detection: run-length state machine, marks once at the tail ---------- */
  function computeRepeats(session) {
    session.forEach(function (e) { if (e.kind === 'ev') delete e.repeat; });
    var tool = null, streak = [];
    function flush() {
      if (streak.length >= 3) streak[streak.length - 1].repeat = streak.length;
      streak = [];
    }
    session.forEach(function (e) {
      if (e.kind !== 'ev') return;
      if (e.type === 'TOOL' && e.status === 'fail') {
        if (e.tool !== tool) { flush(); tool = e.tool; }
        streak.push(e);
      } else { flush(); tool = null; }
    });
    flush();
  }

  /* ---------- Exports (consumed by the view / ctrl layers) ---------- */
  PT.$ = $; PT.esc = esc; PT.jsonOf = jsonOf; PT.short = short; PT.firstLine = firstLine;
  PT.STATUS = STATUS; PT.SCHEMA_NOTE = SCHEMA_NOTE; PT.TYPES = TYPES;
  PT.summarize = summarize; PT.statusOf = statusOf; PT.toolName = toolName;
  PT.payloadOf = payloadOf; PT.resultOf = resultOf; PT.resultIsTerm = resultIsTerm;
  PT.fmtDur = fmtDur; PT.fmtTok = fmtTok;
  PT.buildSession = buildSession; PT.computeRepeats = computeRepeats;
  PT.derivePeriodUsage = derivePeriodUsage;
})();
