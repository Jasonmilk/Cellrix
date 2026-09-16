/* Node-side consumption for the trajectory (Cellrix:ADR-0018 batch 4).
 *
 * A SEPARATE FILE, not new names in the old one. `summarizeNode` would have to
 * be renamed back to `summarize` after the switch — a second edit and a second
 * risk. Here the functions keep their final names, and switching is a change of
 * call sites (`PT.data.x` -> `PT.node.x`), with zero changes to the functions.
 * That is the same rule as splitting by responsibility rather than by name.
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
 * The contract layer supplies `classOf(node)` (what a kind IS). This file
 * supplies `laneOf(kind)` (where a row is DRAWN) — a rendering concept, which
 * ADR-0019 §4 keeps out of the contract.
 *
 * TEMPORARY, like L0: this file replaces prove_track.data.js's consumption half.
 * Until that file is reduced to nothing, both exist, which is two derivations of
 * one fact for as long as it lasts. It does not last a round.
 */
(function () {
  'use strict';

  var PT = window.CxProveTrack = window.CxProveTrack || {};
  var EF = window.CxEventFamily;
  if (!EF) {
    throw new Error('prove_track.node.js requires event_family.js to load first');
  }

  /* Text helpers, local to this file. They format strings; they are not type
   * knowledge. Kept here rather than shared, because this file replaces the old
   * one and must not depend on anything inside it. */
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function jsonOf(d) {
    try { return JSON.stringify(d, null, 2); } catch (e) { return String(d); }
  }
  function short(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n) + '…' : s;
  }
  function firstLine(s, n) {
    s = String(s || '').split('\n')[0];
    return short(s, n || 100);
  }

  /* Which lane a row is drawn in. A rendering concept: the contract says what a
   * kind IS, this says where the picture puts it. */
  var LANE_OF = {
    turn: 'model', message: 'input', context: 'input',
    reasoning: 'model', plan: 'model', tool: 'tool',
    check: 'tool', verdict: 'tool', reply: 'model', metering: 'model'
  };

  function laneOf(kind) { return LANE_OF[kind] || null; }

  /* ---- named predicates -------------------------------------------------
   *
   * Branches on a payload VALUE, not on a kind. These are business judgements —
   * "what counts as passing", "what counts as an empty reply" — and they stay
   * as code: readable, unit-testable, and changeable without touching a table.
   * Collapsing them into data would move the rules into a place where nobody
   * can read them and nothing can test them.
   */
  function isToolOk(p) { return !!p.ok; }
  function isCheckPassed(p) { return !!p.passed; }
  function isVerdictMet(p) { return p.status === 'Met'; }
  function isEmptyReply(p) { return !!p.empty; }
  function hasModel(p) { return !!p.model; }
  function hasReason(p) { return !!p.reason; }
  function hasSha(p) { return !!p.outcomeSha; }
  function hasChars(p) { return p.chars != null; }
  function hasDuration(p) { return p.durationMs != null; }
  function hasTiers(p) { return !!p.choice; }
  function hasCached(p) { return p.cachedTokens != null; }
  function hasReasoning(p) { return p.reasoningTokens != null; }

  /* ---- how each kind summarises itself ---------------------------------
   *
   * A DECLARATION, not branches: eleven if(k === ...) would be the same shape as
   * the eleven if(t === ...) it replaces, with different strings. A kind names a
   * template; the template names payload fields; a named formatter covers what
   * a template language cannot express.
   *
   * A turn has two ends, so it lists two variants and `when` picks. That is the
   * same distinction the contract's classOf reads from payload.end.
   */
  var SUMMARY = {
    turn: [
      { when: function (p) { return !p.end; }, tpl: 'cognitive cycle started' },
      {
        when: function (p) { return !!p.end; },
        tpl: 'done={done} · success={success}{verdict}{impasse}',
        opt: {
          verdict: function (p) { return hasReason(p) ? ' · verdict=' + p.verdict : ''; },
          impasse: function (p) { return p.impasse ? ' · impasse' : ''; }
        }
      }
    ],
    message: { tpl: '{text}', fmt: { text: function (p) { return short(p.text, 140); } } },
    context: {
      tpl: 'context inject · SA-Core selection{tiers} · nodes={nodes} chars={chars}{resume}',
      opt: {
        tiers: function (p) {
          if (!hasTiers(p)) { return ''; }
          var tiers = (p.choice && p.choice.tiers) || {};
          var ks = Object.keys(tiers);
          return ks.length ? ' ' + ks.map(function (k) { return k + '×' + tiers[k]; }).join(' ') : '';
        },
        resume: function (p) { return p.resumeFrom ? ' · resume ' + short(p.resumeFrom, 24) : ''; }
      }
    },
    reasoning: { tpl: 'think: {text}', fmt: { text: function (p) { return firstLine(p.text, 100); } } },
    plan: {
      tpl: '{text}',
      fmt: {
        text: function (p) {
          if (isEmptyReply(p)) { return '(empty reply — honest marker, nothing invented)'; }
          var txt = String(p.text || '');
          var calls = null;
          try { var o = JSON.parse(txt); if (o && o.calls) { calls = o.calls; } } catch (err) {}
          if (calls) {
            return 'planned calls: ' + calls.map(function (c) { return c.tool; }).join(', ');
          }
          return 'reply: ' + firstLine(txt, 100);
        }
      }
    },
    tool: [
      {
        when: function (p) { return p.stage === 'call'; },
        tpl: '{tool} · #{index} · expect={expect}'
      },
      {
        when: function (p) { return p.stage === 'result'; },
        tpl: '{tool} · {ok} · {durationMs}{sha}',
        fmt: {
          ok: function (p) { return isToolOk(p) ? 'ok' : 'fail'; },
          durationMs: function (p) { return hasDuration(p) ? p.durationMs + 'ms' : '—'; }
        },
        opt: { sha: function (p) { return hasSha(p) ? ' · sha ' + p.outcomeSha : ''; } }
      }
    ],
    check: {
      tpl: 'gate · {check} · {passed} · expect={expect}',
      fmt: { passed: function (p) { return isCheckPassed(p) ? 'PASS' : 'FAIL'; } }
    },
    verdict: {
      tpl: '{status}{reason}',
      opt: { reason: function (p) { return hasReason(p) ? ' · ' + p.reason : ''; } }
    },
    reply: {
      tpl: 'reply: {prefix}{text} (click to expand)',
      fmt: {
        prefix: function (p) { return hasModel(p) ? '[' + p.model + '] ' : ''; },
        text: function (p) { return firstLine(p.text, 140); }
      }
    },
    metering: {
      tpl: 'tokens · prompt {promptTokens} completion {completionTokens}{cached}{reasoning}',
      opt: {
        cached: function (p) { return hasCached(p) ? ' cached ' + p.cachedTokens : ''; },
        reasoning: function (p) { return hasReasoning(p) ? ' reasoning ' + p.reasoningTokens : ''; }
      }
    }
  };

  /* Filling is substitution, not dispatch: a named formatter wins, otherwise the
   * payload value is written in. No branch on kind. */
  function fill(tpl, payload, fmt, opt) {
    var out = tpl.replace(/\{(\w+)\}/g, function (_, name) {
      if (fmt && fmt[name]) { return fmt[name](payload); }
      var v = payload[name];
      return v === undefined || v === null ? '—' : String(v);
    });
    if (opt) {
      out += Object.keys(opt).map(function (k) { return opt[k](payload); }).join('');
    }
    return out;
  }

  function summarize(node) {
    var spec = SUMMARY[node.kind];
    if (!spec) { return node.kind; }
    var variants = Object.prototype.toString.call(spec) === '[object Array]' ? spec : [spec];
    for (var i = 0; i < variants.length; i++) {
      var v = variants[i];
      if (!v.when || v.when(node.payload)) {
        return fill(v.tpl, node.payload, v.fmt, v.opt);
      }
    }
    return node.kind;
  }

  /* ---- status ----------------------------------------------------------- */
  var STATUS = {
    tool: function (p) {
      if (p.stage === 'call') { return 'pending'; }
      return isToolOk(p) ? 'ok' : 'fail';
    },
    check: function (p) { return isCheckPassed(p) ? 'ok' : 'fail'; },
    verdict: function (p) { return isVerdictMet(p) ? 'ok' : 'fail'; }
  };

  function statusOf(node) {
    var fn = STATUS[node.kind];
    return fn ? fn(node.payload) : 'done';
  }

  /* ---- tool name and the payload/detail panes --------------------------- */
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
        return jsonOf(isEmptyReply(p) ? { empty: true, text: '' } : { text: p.text });
      case 'context':
        return jsonOf(p);
      default:
        return jsonOf(p);
    }
  }

  function detailOf(node) {
    var p = node.payload;
    switch (node.kind) {
      case 'tool':
        if (p.stage === 'call') { return 'awaiting tool response…'; }
        return hasSha(p) ? 'sha ' + p.outcomeSha : (p.outcome || '—');
      case 'check':
        return 'actual=' + (p.actual || '—') + (hasReason(p) ? '\n' + p.reason : '');
      case 'verdict':
        return p.reason || '—';
      case 'message':
      case 'turn':
        return '—';
      case 'reasoning':
        return '(full thinking in Payload)';
      case 'reply':
        return hasChars(p) ? p.chars + ' chars' : '(full reply in Payload)';
      case 'plan':
        return '(intent and calls in Payload)';
      default:
        return '—';
    }
  }

  PT.node = {
    laneOf: laneOf,
    summarize: summarize,
    statusOf: statusOf,
    toolNameOf: toolNameOf,
    payloadOf: payloadOf,
    detailOf: detailOf,
    /* exported for tests and for the guard that checks no branch sits on kind */
    LANE_OF: LANE_OF,
    SUMMARY: SUMMARY,
    STATUS: STATUS
  };


  /* ---- moved from the event-based layer, now node-based ----------------- */

  function safeCount(n) {
    return typeof n === 'number' && isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
  }
  function fmtDur(ms) { return ms === 0 ? '—' : (ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(2) + 's'); }
  function fmtTok(n) { return (n == null) ? '—' : Number(n).toLocaleString('en-US'); }

  /* Metering is a kind, not a protocol name. No metering event means the
   * upstream reported nothing means the fact does not exist — no approximation,
   * and an overflow withholds the whole aggregate rather than publishing a
   * wrapped sum. */
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
      /* Disjoint input: unknowable when cached is absent (prompt - 0 would be
       * guessing a cache miss). */
      input: (cached == null) ? null : prompt - cached,
      total: prompt + completion
    };
  }

  /* The tool row's own payload, for the inspector. `stage` separates the call
   * from the result — the same field classOf reads, not a protocol name. */
  function resultOf(node) {
    var p = node.payload || {};
    if (node.kind !== 'tool' || p.stage !== 'result') { return null; }
    return {
      tool: p.tool, ok: p.ok, durationMs: p.durationMs,
      outcome: p.outcome, outcomeSha: p.outcomeSha
    };
  }

  /* ---- build: node stream -> SESSION ----------------------------------- */
  function buildSession(nodes) {
    var out = [];
    var note = 'a session';
    var shown = nodes || [];
    var seenTurn = {};
    shown.forEach(function (n) {
      var cls = EF.classOf(n);
      var lane = laneOf(n.kind);
      /* A turn header per distinct turn, emitted where the turn first appears —
       * a resumed session has more than one, and pinning them all to 't1'
       * silently merged them. The ordinal now arrives on the node. */
      if (n.turn && !seenTurn[n.turn]) {
        seenTurn[n.turn] = true;
        out.push({
          kind: 'turn', id: n.turn,
          index: Number(String(n.turn).slice(1)), note: short(note, 60)
        });
      }
      if (!cls) { return; }
      var dur = 0;
      if (n.kind === 'tool' && n.payload && n.payload.stage === 'result') {
        dur = n.payload.durationMs || 0;
      }
      out.push({
        kind: 'ev', id: n.node, turn: n.turn, cls: cls, lane: lane,
        ord: n.ord, ts: n.ts, dur: dur,
        status: statusOf(n), summary: summarize(n),
        payload: payloadOf(n), detail: detailOf(n)
      });
    });
    /* The array shape is the contract with the caller: prove_track.js assigns
     * it to S.session and iterates it. usage is derived separately by the same
     * caller, exactly as before — changing the return shape here would be a
     * silent break at the switch. */
    return out;
  }

  PT.node.derivePeriodUsage = derivePeriodUsage;
  PT.node.resultOf = resultOf;
  PT.node.buildSession = buildSession;
  PT.node.safeCount = safeCount;
  PT.node.fmtDur = fmtDur;
  PT.node.fmtTok = fmtTok;
})();
