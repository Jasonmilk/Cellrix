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

  /* The assembly layer's own version — distinct from the contract's.
   * They were both '1.0.0' once, which hid the fact that the digest
   * was citing the wrong one. */
  var LAYER_VERSION = '1.0.0';

  /* How many refused events to keep as specimens. The COUNTS are the durable
   * fact; the sample exists so a diagnosis can name a culprit. Bounded so a
   * malformed feed cannot grow the layer without limit. */
  var REJECT_SAMPLE_MAX = 16;

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

  /* ---------- T2: shared fold primitives ---------- */

  /* Idempotent upsert keyed by (kind, id) — the merge rule from ADR-0018 D3.
   * An existing key is REPLACED, never appended, so replaying the same window
   * twice deep-equals (acceptance 1). The separator is a NUL so that a kind or
   * id containing the delimiter cannot collide with a real key. */
  function upsert(state, node) {
    state[node.kind + '\u0000' + node.id] = node;
    return state;
  }

  /* Turn coordinates: for every event in tape order, which turn it belongs to
   * and the node id it folds to.
   *
   * Derived from the TAPE, never from arrival order — arrival order is a
   * network fact, not an event fact (D4). Two clients fed the same events in
   * different orders must get the same coordinates. */
  function deriveCoordinates(events, meta) {
    var jobId = (meta && meta.job_id) || 'run';
    var out = [];
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      var turn = countsUpTo(events, i, EF.TYPES.TURN_START);
      out.push({
        seq: e.seq,
        type: e.type,
        turn: 't' + turn,
        node: jobId + '#' + e.seq
      });
    }
    return out;
  }

  /* How many events of `type` occur in events[0..upto] inclusive. Turn numbers
   * are ordinal, so they come from the tape, not from a counter that depends on
   * which events happened to arrive first. */
  /* Events before the first turn/start belong to the opening turn, which is
   * turn 1 — the count is 0 there, and 0 must not become 0. Named so the
   * intent is readable rather than inferred from `|| 1`. */
  var OPENING_TURN = 1;

  function countsUpTo(events, upto, type) {
    var n = 0;
    for (var i = 0; i <= upto; i++) {
      if (events[i].type === type) n++;
    }
    return n === 0 ? OPENING_TURN : n;
  }

  function create() {
    var tape = [];   // accepted events, ordered by seq
    var bySeq = {};  // seq -> event, so dedupe is O(1) not O(n)
    var counts = {}; // type -> count, for digest()
    var watermark = null;
    var targets = {}; // name -> { name, active }
    var rejectCounts = {}; // "reason:type" -> count, never silently dropped (D3)
    var rejectSample = []; // bounded; the counts are the fact, this is the clue
    var subscribers = []; // functions fed on publication
    var dirty = false;    // tape changed since the last flush

    /* Accept one event. Replay of an already-seen seq is dropped: replaying
     * the same window twice must be idempotent. */
    /* Record a refusal. A dropped event that leaves no trace is a silent
     * failure: the stream looks empty rather than wrong (ADR-0018 D3). */
    function refuse(e, reason) {
      var type = (e && typeof e === 'object' && e.type) ? String(e.type) : '(untyped)';
      var key = reason + ':' + type;
      rejectCounts[key] = (rejectCounts[key] || 0) + 1;
      if (rejectSample.length < REJECT_SAMPLE_MAX) {
        rejectSample.push({ type: type, reason: reason });
      }
    }

    function accept(e) {
      if (!EF.isValidEvent(e)) { refuse(e, 'invalid'); return false; }
      if (Object.prototype.hasOwnProperty.call(bySeq, e.seq)) { refuse(e, 'duplicate'); return false; }

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
      dirty = true;
      return true;
    }

    /* Canonical digest: keys sorted, so the same facts always stringify the
     * same way. Clauses 9 and 10 compare these strings, and a digest that
     * depends on insertion order would report a difference that is not there. */
    function digestOf() {
      var types = {};
      Object.keys(counts).sort().forEach(function (k) { types[k] = counts[k]; });
      // Refusal counts are deliberately NOT here: they depend on delivery
      // history, and this string is what clauses 9 and 10 compare. A digest
      // that changes when the same tape is fed twice is not a digest.
      // `v` is the CONTRACT version: it answers "which interpretation
      // produced this", which is the question a digest has to answer.
      return JSON.stringify({ v: EF.VERSION, n: tape.length, wm: watermark, types: types });
    }

    return {
      version: LAYER_VERSION,

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
        return digestOf();
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

      /* One snapshot per merged window. It carries only what a target may
       * read: the watermark and the digest — never the tape itself (D5: a
       * target must not scan the window). */
      snapshot: function () {
        return { version: LAYER_VERSION, watermark: watermark, count: tape.length,
                 digest: digestOf() };
      },

      /* Subscribe. The FIRST subscriber triggers one full replace, not an
       * incremental build (D5) — but only if there is something to publish. */
      subscribe: function (fn) {
        var first = subscribers.length === 0;
        subscribers.push(fn);
        if (first && watermark !== null) {
          /* The replace just published this window, so it is no longer pending
           * a flush. Leaving it dirty would publish the same window twice on
           * the next flush (acceptance 5: one publication per merged window). */
          dirty = false;
          fn(this.snapshot());
        }
        var self = this;
        return function unsubscribe() {
          subscribers = subscribers.filter(function (f) { return f !== fn; });
          return self;
        };
      },

      /* Publish the merged window. Returns how many subscribers were fed.
       * Publishing twice without an intervening change feeds nobody — the
       * window is merged, so a burst costs one publication, not one per event
       * (acceptance 5). No subscriber means no work (acceptance 7). */
      flush: function () {
        if (!dirty || subscribers.length === 0) {
          dirty = false;
          return 0;
        }
        dirty = false;
        var snap = this.snapshot();
        subscribers.slice().forEach(function (fn) { fn(snap); });
        return subscribers.length;
      },

      /* T2 primitives, bound to this tape. */
      coordinates: function (meta) {
        return deriveCoordinates(tape, meta);
      },
      /* Fold a list of nodes into one map, idempotently. */
      foldNodes: function (nodes) {
        var state = {};
        for (var i = 0; i < nodes.length; i++) upsert(state, nodes[i]);
        return state;
      },

      /* What was refused, and why. Counts first (the fact), specimens second. */
      rejections: function () {
        var counts = {};
        Object.keys(rejectCounts).sort().forEach(function (k) { counts[k] = rejectCounts[k]; });
        return { counts: counts, sample: rejectSample.slice(),
                 total: Object.keys(rejectCounts).reduce(function (n, k) {
                   return n + rejectCounts[k];
                 }, 0) };
      },

      /* Read-only view, for targets and tests. */
      events: function () {
        return tape.slice();
      }
    };
  }

  window.CxAssembly = {
    VERSION: LAYER_VERSION,
    create: create,
    /* Exposed for targets that already hold their own tape. */
    upsert: upsert,
    deriveCoordinates: deriveCoordinates
  };
})();
