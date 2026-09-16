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

  /* Which source field feeds which payload field, per protocol type.
   *
   * A DECLARATION, not code. interpret() walks this table, so it contains no
   * per-type branch: adding a type is a data edit, not a code edit. Twelve
   * per-type functions would also have been "type knowledge in one place", but
   * it would have been twelve pieces of hardcoding in the contract layer's coat.
   *
   * Every field named here is declared in DATA_SCHEMA for the same type, and
   * asserted so. The first draft of this table guessed names for check/status,
   * verdict/status and tool/call ('name', 'state', 'detail', 'args') that the
   * declaration never had — four of them did not exist in any real event
   * either. Measured over the real periods: tool/call carries tool/index/expect,
   * check/status carries check_id/check/expect/actual/gate/…, verdict/status
   * carries job_id/status.
   *
   * Entry forms:
   *   ['field']                    copy data.field as-is
   *   ['field', 'snake']           copy, camelCasing the payload name
   *   ['field', 'maybe']           copy only when the producer sent it
   *   ['?literal', 'lit:value']    a constant; the '?' marks it as not a field
   */
  var PAYLOAD_MAP = {
    'turn/start': { start: ['?turn/start', 'lit:true'] },
    'turn/end': {
      end: ['?turn/end', 'lit:true'], done: ['done'], success: ['success'],
      impasse: ['impasse'], model: ['model', 'maybe'], verdict: ['verdict', 'maybe']
    },
    'user/message': { text: ['text'] },
    'context/inject': {
      chars: ['chars'], nodes: ['nodes'], choice: ['choice', 'maybe'],
      resumeFrom: ['resume_from', 'snake', 'maybe']
    },
    'assistant/think': { text: ['text'] },
    'assistant/attempt': { text: ['text'], empty: ['empty', 'maybe'] },
    'tool/call': {
      stage: ['?tool/call', 'lit:call'], tool: ['tool'], index: ['index'], expect: ['expect']
    },
    'tool/result': {
      stage: ['?tool/result', 'lit:result'], tool: ['tool'], ok: ['ok'],
      durationMs: ['duration_ms', 'snake'], outcome: ['outcome', 'maybe'],
      outcomeSha: ['outcome_sha', 'snake', 'maybe'], index: ['index', 'maybe']
    },
    'check/status': {
      checkId: ['check_id', 'snake'], check: ['check'], expect: ['expect'],
      actual: ['actual'], gate: ['gate'], evidenceId: ['evidence_id', 'snake', 'maybe'],
      judge: ['judge', 'maybe'], passed: ['passed', 'maybe'], reason: ['reason', 'maybe']
    },
    'verdict/status': {
      jobId: ['job_id', 'snake'], status: ['status'],
      checks: ['checks', 'maybe'], reason: ['reason', 'maybe']
    },
    'assistant/reply': { text: ['text'], chars: ['chars'], model: ['model', 'maybe'] },
    'assistant/usage': {
      promptTokens: ['prompt_tokens', 'snake'], completionTokens: ['completion_tokens', 'snake'],
      cachedTokens: ['cached_tokens', 'snake', 'maybe'],
      reasoningTokens: ['reasoning_tokens', 'snake', 'maybe'],
      model: ['model', 'maybe']
    }
  };

  /* Protocol name + data -> { kind, payload }, by table lookup.
   *
   * The one place a protocol name becomes meaning. fold calls this and never
   * learns a name. Absent optional fields stay absent rather than becoming
   * empty strings, so a consumer can tell "not sent" from "sent and empty".
   *
   * Unknown name: no interpretation, no guess. Refusing is the caller's call;
   * this layer never invents meaning.
   */
  function interpret(typeName, data, missing) {
    var kind = KIND_OF[typeName];
    var map = PAYLOAD_MAP[typeName];
    if (!kind || !map) { return null; }
    var src = data || {};
    var payload = {};
    for (var key in map) {
      if (!Object.prototype.hasOwnProperty.call(map, key)) { continue; }
      var spec = map[key];
      var from = spec[0];
      if (from.charAt(0) === '?') {
        payload[key] = spec[1].slice(4) === 'true' ? true : spec[1].slice(4);
        continue;
      }
      var has = Object.prototype.hasOwnProperty.call(src, from) && src[from] !== undefined;
      if (!has) {
        /* An optional field the producer did not send. Counted, never silent:
         * a field going quiet must show up as a number, not as a payload that
         * quietly got smaller while every assertion stayed green. Pass a
         * collector to observe it; omitting the argument is not an error. */
        if (spec.indexOf('maybe') !== -1) {
          if (missing && typeof missing.push === 'function') {
            missing.push(typeName + '.' + from);
          }
        } else {
          payload[key] = null;
        }
        continue;
      }
      payload[key] = src[from];
    }
    return { kind: kind, payload: payload };
  }

  /* What each semantic kind IS, in the system's own vocabulary.
   *
   * One axis only: a neutral class. A type fact, not a view fact, so it lives
   * here for the same reason KIND_OF does — otherwise the trajectory carries
   * its own vocabulary, which is the duplication this layer exists to end.
   *
   * `track` deliberately does NOT live here. It says which lane a row is drawn
   * in, which is a rendering concept; ADR-0019 §4 already ruled that a render
   * table may be a subset of the vocabulary but must not drag UI needs into the
   * contract. Adding it here would have been the same pollution in the other
   * direction — a fifth vocabulary avoided by pushing UI semantics into the
   * contract instead. The lane table belongs to the view.
   */
  /* The closed set of classes. Declared so a guard can check membership: a rule
   * phrased as "cls must not name a lane" is a denylist, and a new lane named
   * something else would pass it. */
  var CLASSES = ['SYSTEM', 'USER', 'CONTEXT', 'THINK', 'ATTEMPT',
                 'TOOL', 'CHECK', 'VERDICT', 'REPLY', 'USAGE', 'END'];

  var KIND_CLASS = {
    turn: 'SYSTEM',
    message: 'USER',
    context: 'CONTEXT',
    reasoning: 'THINK',
    plan: 'ATTEMPT',
    tool: 'TOOL',
    check: 'CHECK',
    verdict: 'VERDICT',
    reply: 'REPLY',
    metering: 'USAGE'
  };

  /* A turn has two ends and they are not drawn the same. Which end a row is
   * comes from payload.end — a fact about the payload this layer produces, so
   * the rule for reading it belongs here too rather than being guessed at by
   * every consumer. */
  function classOf(node) {
    var base = KIND_CLASS[node && node.kind];
    if (!base) { return null; }
    /* A turn has two ends and they are not the same class. Which end a row is
     * comes from payload.end — a fact about the payload this layer produces, so
     * reading it belongs here rather than being guessed by every consumer. */
    if (node.kind === KINDS.TURN && node.payload && node.payload.end) {
      return 'END';
    }
    return base;
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
    KIND_CLASS: KIND_CLASS,
    CLASSES: CLASSES,
    classOf: classOf,
    interpret: interpret,
    PAYLOAD_MAP: PAYLOAD_MAP,
    DATA_SCHEMA: DATA_SCHEMA,
    KNOWN_TYPES: Object.keys(DATA_SCHEMA),
    isKnownType: isKnownType,
    isValidEvent: isValidEvent
  };
})();
