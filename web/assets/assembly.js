/* Event family assembly layer — Cellrix:ADR-0018 T1.
 *
 * One tape, many targets. The assembly layer owns the event stream and hands
 * each target what it needs; a target never reads the tape itself (D5), so the
 * same window cannot yield two different pictures depending on who read it.
 *
 * T1 scope is the skeleton: intake, watermark, pending, target registry,
 * digest. Fold primitives and deriveCoordinates() are T2; the three targets
 * attach in T3–T5.
 *
 * Depends on CxEventFamily (T0) for the vocabulary — it must load first.
 * Zero build dependency (ADR-0016 D7); `window` is the only global touched.
 */
(function () {
  'use strict';

  var EF = window.CxEventFamily;
  if (!EF) {
    throw new Error('assembly.js requires event_family.js to load first');
  }

  var VERSION = '1.0.0';

  /* Position of `seq` in a seq-ordered array; the tape stays sorted so a
   * back-fill (an earlier page arriving late) needs no full re-sort. */
  function lowerBound(tape, seq) {
    var lo = 0, hi = tape.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (tape[mid].seq < seq) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function create() {
    var tape = [];   // accepted events, ordered by seq
    var bySeq = {};  // seq -> event, so dedupe is O(1) not O(n)
    var counts = {}; // type -> count, for digest()
    var watermark = null;
    var targets = {}; // name -> { name, active }

    /* Accept one event. Replay of an already-seen seq is dropped: replaying
     * the same window twice must be idempotent. */
    function accept(e) {
      if (!EF.isValidEvent(e)) return false;
      if (Object.prototype.hasOwnProperty.call(bySeq, e.seq)) return false;

      bySeq[e.seq] = e;
      counts[e.type] = (counts[e.type] || 0) + 1;

      /* Fast path — the common case is a monotonic append, which needs no
       * search. Only a back-fill pays for the insert (D5). */
      if (watermark === null || e.seq > watermark) {
        tape.push(e);
        watermark = e.seq;
      } else {
        tape.splice(lowerBound(tape, e.seq), 0, e);
      }
      return true;
    }

    return {
      version: VERSION,

      /* Feed a window. Returns how many events were newly accepted. */
      feed: function (events) {
        if (!events) return 0;
        var n = 0;
        for (var i = 0; i < events.length; i++) {
          if (accept(events[i])) n++;
        }
        return n;
      },

      /* D4: without a turn/start the window is incomplete, so stay pending
       * rather than construct a State from a guess. Blank is honest; a
       * guessed row is not. Bounded: nothing is built while pending. */
      status: function () {
        return counts[EF.TYPES.TURN_START] ? 'ready' : 'pending';
      },

      /* D7: the watermark is a first-class output, not an internal detail. */
      watermark: function () {
        return watermark;
      },

      /* D8: observable during production, and the thing the split/chunk
       * invariance tests (T6) assert on. */
      digest: function () {
        return JSON.stringify({ v: VERSION, n: tape.length, wm: watermark, types: counts });
      },

      /* D5: registering does no work. A target is driven only after it is
       * activated, and stops being driven when deactivated — creating a
       * source must not cost anything. */
      register: function (name) {
        if (!Object.prototype.hasOwnProperty.call(targets, name)) {
          targets[name] = { name: name, active: false };
        }
        return targets[name];
      },
      activate: function (name) {
        if (!Object.prototype.hasOwnProperty.call(targets, name)) {
          throw new Error('unknown target: ' + name);
        }
        targets[name].active = true;
        return targets[name];
      },
      deactivate: function (name) {
        if (Object.prototype.hasOwnProperty.call(targets, name)) {
          targets[name].active = false;
        }
      },
      activeTargets: function () {
        return Object.keys(targets)
          .filter(function (k) { return targets[k].active; })
          .sort();
      },

      /* Read-only view, for targets and tests. */
      events: function () {
        return tape.slice();
      }
    };
  }

  window.CxAssembly = { VERSION: VERSION, create: create };
})();
