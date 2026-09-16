/* Event family contract — Cellrix <-CAP-> Anaphase.
 *
 * Cellrix:ADR-0018 T0. The vocabulary is owned by `anaphase:ADR-0026` D2
 * (protocol values, frozen there); this file is the Cellrix-side mirror, so
 * ProveTrack and Chat consume ONE vocabulary instead of each deriving its own.
 *
 * One row: { type, seq, time, data }
 *   seq  — monotonic within a period (deterministic replay)
 *   time — injected clock, RFC3339 (replayable, never host-read)
 *
 * Loaded as a browser IIFE. `window` is the only global it touches, so it also
 * loads under node with a one-line shim — see web/tests/event_family_test.js.
 *
 * Zero build dependency (ADR-0016 D7): no modules, no bundler.
 */
(function () {
  'use strict';

  /* Contract version. Bumped whenever the interpretation of an event changes,
   * not just when a field is added: the required/optional split and the
   * addition of assistant/usage both changed what a given tape means, and a
   * digest that keeps saying 1.0.0 cannot tell the two apart.
   *
   *   1.0.0  2026-09-15  initial vocabulary (11 types, all fields required)
   *   1.1.0  2026-09-15  + assistant/usage; required/optional split; fields
   *                      measured optional are no longer demanded
   */
  var VERSION = '1.1.0';

  /* Protocol values. Consumers match these exactly; never derive a type name
   * from display text. */
  var TYPES = {
    TURN_START: 'turn/start',
    USER_MESSAGE: 'user/message',
    CONTEXT_INJECT: 'context/inject',
    ASSISTANT_THINK: 'assistant/think',
    ASSISTANT_ATTEMPT: 'assistant/attempt',
    TOOL_CALL: 'tool/call',
    TOOL_RESULT: 'tool/result',
    CHECK_STATUS: 'check/status',
    VERDICT_STATUS: 'verdict/status',
    ASSISTANT_REPLY: 'assistant/reply',
    ASSISTANT_USAGE: 'assistant/usage',
    TURN_END: 'turn/end'
  };

  /* Semantic kinds — what a fact IS, after interpretation.
   *
   * A target selects over these. It cannot re-interpret them: there is no
   * protocol name on a Node, and no branch table to switch on. tool/call and
   * tool/result share one kind and are separated by payload.stage, so pairing
   * them is a selection, not a re-reading of the protocol.
   *
   * KIND_OF's key set must equal TYPES' value set — asserted, so the two cannot
   * drift, and so this cannot quietly become a second vocabulary.
   */
  var KINDS = {
    TURN: 'turn',
    MESSAGE: 'message',
    CONTEXT: 'context',
    REASONING: 'reasoning',
    PLAN: 'plan',
    TOOL: 'tool',
    CHECK: 'check',
    VERDICT: 'verdict',
    REPLY: 'reply',
    METERING: 'metering'
  };

  var KIND_OF = {
    'turn/start': KINDS.TURN,
    'turn/end': KINDS.TURN,
    'user/message': KINDS.MESSAGE,
    'context/inject': KINDS.CONTEXT,
    'assistant/think': KINDS.REASONING,
    'assistant/attempt': KINDS.PLAN,
    'tool/call': KINDS.TOOL,
    'tool/result': KINDS.TOOL,
    'check/status': KINDS.CHECK,
    'verdict/status': KINDS.VERDICT,
    'assistant/reply': KINDS.REPLY,
    'assistant/usage': KINDS.METERING
  };

  /* Protocol name + data -> { kind, payload }. The ONE place a protocol name is
   * turned into meaning. fold calls this and never sees the name.
   *
   * payload carries only what a view needs; absent fields stay absent rather
   * than becoming empty strings, so a consumer can tell "not present" from
   * "present and empty". */
  var INTERPRETERS = {
    'turn/start': function () { return { start: true }; },
    'turn/end': function (d) {
      return { end: true, done: d.done, success: d.success, impasse: d.impasse, model: d.model || null };
    },
    'user/message': function (d) { return { text: d.text }; },
    'context/inject': function (d) {
      return { chars: d.chars, nodes: d.nodes, resumeFrom: d.resume_from || null };
    },
    'assistant/think': function (d) { return { text: d.text }; },
    'assistant/attempt': function (d) { return { text: d.text }; },
    'tool/call': function (d) {
      return { stage: 'call', tool: d.tool, index: d.index, expect: d.expect, args: d.args };
    },
    'tool/result': function (d) {
      return { stage: 'result', tool: d.tool, ok: d.ok, durationMs: d.duration_ms, outcome: d.outcome };
    },
    'check/status': function (d) { return { name: d.name, state: d.state, detail: d.detail }; },
    'verdict/status': function (d) { return { name: d.name, state: d.state, detail: d.detail }; },
    'assistant/reply': function (d) { return { text: d.text, chars: d.chars, model: d.model || null }; },
    'assistant/usage': function (d) {
      return { promptTokens: d.prompt_tokens, completionTokens: d.completion_tokens };
    }
  };

  /* Unknown protocol name: no interpretation, no guess. The caller decides
   * whether that is a refusal — this layer never invents meaning. */
  function interpret(typeName, data) {
    var fn = INTERPRETERS[typeName];
    if (!fn) { return null; }
    return { kind: KIND_OF[typeName], payload: fn(data || {}) };
  }

  /* data shape per type, split into required and optional.
   *
   * A field the producer omits when the fact does not exist is OPTIONAL.
   * Demanding it rejects real events — measured 2026-09-15 over 86 real
   * periods: `context/inject.resume_from` appears in 34/103, `turn/end.reply`
   * in 37/102, `assistant/reply.model` in 32/37. Required below means the
   * field was present in EVERY event of that type in the measurement.
   *
   * A value is the list of accepted primitives; 'null' and 'array' are named
   * explicitly because typeof alone cannot tell them apart from 'object'.
   */
  var DATA_SCHEMA = {
    'turn/start': { required: {}, optional: {} },
    'user/message': { required: { text: ['string'] }, optional: {} },
    'context/inject': {
      required: { chars: ['number'], nodes: ['number'] },
      optional: { choice: ['object'], resume_from: ['string', 'null'] }
    },
    'assistant/think': { required: { text: ['string'] }, optional: {} },
    'assistant/attempt': {
      required: { text: ['string'] },
      optional: { empty: ['boolean'] }
    },
    'assistant/usage': {
      required: { prompt_tokens: ['number'], completion_tokens: ['number'] },
      optional: {
        cached_tokens: ['number'], reasoning_tokens: ['number'],
        model: ['string', 'null']
      }
    },
    'tool/call': {
      required: { tool: ['string'], index: ['number'], expect: ['string'] },
      optional: {}
    },
    'tool/result': {
      required: { tool: ['string'], ok: ['boolean'], duration_ms: ['number'] },
      optional: {
        data: ['string', 'null'], index: ['number'],
        outcome: ['string'], outcome_sha: ['string']
      }
    },
    'check/status': {
      required: {
        check_id: ['string'], check: ['string'], expect: ['string'],
        actual: ['string'], gate: ['string']
      },
      optional: {
        evidence_id: ['string'], judge: ['string'],
        passed: ['boolean'], reason: ['string']
      }
    },
    'verdict/status': {
      required: { job_id: ['string'], status: ['string'] },
      optional: { checks: ['array', 'number'], reason: ['string'] }
    },
    'assistant/reply': {
      required: { text: ['string'], chars: ['number'] },
      optional: { model: ['string', 'null'] }
    },
    'turn/end': {
      required: { done: ['boolean'], success: ['boolean'], impasse: ['boolean'] },
      optional: {
        reply: ['string', 'null'], model: ['string', 'null'],
        verdict: ['string', 'null']
      }
    }
  };

  /* Primitive name of a value. typeof reports 'object' for both null and
   * arrays, which would make ['object'] accept null — so they are named. */
  function kindOf(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    return typeof v;
  }

  function matches(v, allowed) {
    return allowed.indexOf(kindOf(v)) >= 0;
  }

  function isKnownType(t) {
    return Object.prototype.hasOwnProperty.call(DATA_SCHEMA, t);
  }

  /* Structural check on one event.
   *
   * `time` is checked as a string but never parsed: the clock is injected
   * upstream, and replay must not depend on a host date parser (which would
   * make the same tape produce different results on different machines).
   *
   * Unknown extra fields are tolerated — the producer may add them; what must
   * hold is that every field this vocabulary promises is present and typed.
   */
  function isValidEvent(e) {
    if (!e || typeof e !== 'object') return false;
    if (!isKnownType(e.type)) return false;
    if (typeof e.seq !== 'number' || !isFinite(e.seq)) return false;
    if (typeof e.time !== 'string') return false;

    var shape = DATA_SCHEMA[e.type];
    var d = e.data;
    if (!d || typeof d !== 'object') return false;

    /* Required: present AND typed. A missing required field is a malformed
     * event, not an optional one. */
    for (var k in shape.required) {
      if (!Object.prototype.hasOwnProperty.call(shape.required, k)) continue;
      if (!Object.prototype.hasOwnProperty.call(d, k)) return false;
      if (!matches(d[k], shape.required[k])) return false;
    }
    /* Optional: absent is fine; present-but-wrong-typed is not. */
    for (var k2 in shape.optional) {
      if (!Object.prototype.hasOwnProperty.call(shape.optional, k2)) continue;
      if (!Object.prototype.hasOwnProperty.call(d, k2)) continue;
      if (!matches(d[k2], shape.optional[k2])) return false;
    }
    return true;
  }

  window.CxEventFamily = {
    VERSION: VERSION,
    TYPES: TYPES,
    KINDS: KINDS,
    KIND_OF: KIND_OF,
    interpret: interpret,
    DATA_SCHEMA: DATA_SCHEMA,
    KNOWN_TYPES: Object.keys(DATA_SCHEMA),
    isKnownType: isKnownType,
    isValidEvent: isValidEvent
  };
})();
