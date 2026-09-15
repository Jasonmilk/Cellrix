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

  var VERSION = '1.0.0';

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
    TURN_END: 'turn/end'
  };

  /* data shape per type. A value is a LIST of accepted primitives — `model` is
   * explicitly nullable (anaphase:ADR-0036: the upstream may not report one),
   * and "nullable" is data here, not a special case in the validator. */
  var DATA_SCHEMA = {
    'turn/start': {},
    'user/message': { text: ['string'] },
    'context/inject': { nodes: ['number'], chars: ['number'], resume_from: ['string', 'null'] },
    'assistant/think': { text: ['string'] },
    'assistant/attempt': { text: ['string'] },
    'tool/call': { tool: ['string'], index: ['number'], expect: ['string'] },
    'tool/result': { tool: ['string'], ok: ['boolean'], duration_ms: ['number'], data: ['string'] },
    'check/status': { check_id: ['string'], check: ['string'], expect: ['string'], actual: ['string'], gate: ['string'] },
    'verdict/status': { job_id: ['string'], status: ['string'] },
    'assistant/reply': { text: ['string'], chars: ['number'], model: ['string', 'null'] },
    'turn/end': { done: ['boolean'], success: ['boolean'], impasse: ['boolean'], reply: ['string'], model: ['string', 'null'] }
  };

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

    for (var k in shape) {
      if (!Object.prototype.hasOwnProperty.call(shape, k)) continue;
      var actual = d[k] === null ? 'null' : typeof d[k];
      if (shape[k].indexOf(actual) < 0) return false;
    }
    return true;
  }

  window.CxEventFamily = {
    VERSION: VERSION,
    TYPES: TYPES,
    DATA_SCHEMA: DATA_SCHEMA,
    KNOWN_TYPES: Object.keys(DATA_SCHEMA),
    isKnownType: isKnownType,
    isValidEvent: isValidEvent
  };
})();
