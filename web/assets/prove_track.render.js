/* The trajectory's render tables (Cellrix:ADR-0018 batch 4).
 *
 * Declarations only: kind -> lane, kind -> status rule, kind -> summary
 * template, kind -> one-line note. Nothing here touches the DOM (that is the
 * view layer) and nothing here names a protocol event (that was the point of
 * the type lock). This is the trajectory's own vocabulary, in the system's own
 * words — the same division of labour as event_family.js (the contract's
 * vocabulary) and node_shape.js (construction).
 *
 * THE RENDER TABLE IS THE ROW SET. A kind with no SUMMARY entry is not drawn.
 * That is not a convention: `PT.node.buildSession` filters on exactly this
 * table, and `validate()` below requires every contract kind to be either drawn
 * or listed in NOT_DRAWN. A new kind landing in neither refuses to load, rather
 * than disappearing from the trajectory with nobody having decided that.
 */
(function () {
  'use strict';

  var PT = window.CxProveTrack = window.CxProveTrack || {};
  var EF = window.CxEventFamily;
  if (!EF) {
    throw new Error('prove_track.render.js requires event_family.js to load first');
  }
  var D = PT.data;
  if (!D) {
    throw new Error('prove_track.render.js requires prove_track.data.js to load first');
  }
  var short = D.short, firstLine = D.firstLine, ABSENT = D.ABSENT;

  /* 三态 → 给**人看**的短标签。入参必须是 `triStatus` 的结果串
   * （`'ok'`/`'fail'`/`'unmeasured'`）—— **不要**写成 `triLabel(pred === true)`：
   * 那会把 `undefined` 先压成 `false`，三态又塌回两态（本文件里犯过一次，记此）。 */
  function triLabel(status) {
    return status === 'ok' ? 'PASS' : (status === 'fail' ? 'FAIL' : ABSENT);
  }

  /* Which lane a row is drawn in. Complete over the contract's kinds — the
   * guard requires key-for-key equality, so a new kind cannot be silently
   * missing a lane. */
  var LANE_OF = {
    turn: 'model', message: 'input', context: 'input',
    reasoning: 'model', plan: 'model', tool: 'tool',
    check: 'tool', verdict: 'tool', reply: 'model'
  };

  function laneOf(kind) { return LANE_OF[kind] || null; }

  /* Kinds the contract knows and the trajectory does not draw, with the reason.
   *
   * Metering is MEASURED, not performed: it reports a call's cost and has no
   * place in the cycle's sequence. Drawing it would also redefine every
   * duration, because a duration here is the gap to the next drawn row. The
   * measurement is not lost — it is summed onto the reply row (see `tok`) and
   * remains whole in the audit chain.
   */
  var NOT_DRAWN = {
    metering: 'measured per call, not a step of the cycle'
  };

  /* ---- named predicates -------------------------------------------------
   *
   * Each branches on a payload VALUE, not on a kind. These are business
   * judgements — "what counts as passing", "what counts as an empty reply" —
   * and they stay as code: readable, unit-testable, and changeable without
   * touching a table.
   */
  /* 三态：真 / 假 / **缺席** —— 只给"**真值谓词**"用。
   *
   * `!!p.ok` 本身已经正确：它把 `undefined` 留在 `undefined`，只在真有值时
   * 才给布尔。**真正错的是 `!!p.passed`** —— 比较运算把"缺席"压成 `false`，
   * 于是一个从没测量过的判据被渲染成 `FAIL`，`statusOf` 再把它折成 `'fail'`。
   * 这是"缺失被当成一个值"，与 K-088（未知码渲绿）同形、方向相反：
   * 那边把未知渲染成"通过"，这边把未知渲染成"失败"。
   *
   * 故只改 `isCheckPassed` 为 `=== true` 形式（absent ⇒ `undefined`）。
   * **不碰** `isEmptyReply` / `hasModel` / `hasReason` / `hasSha` 这类
   * **存在性谓词**：它们回答的是"这个字段在不在"，`false` 是它们的正确返回值，
   * 不是"缺席"。（改它们会把语义弄反 —— 记此以免下一人重犯。）
   */
  function isToolOk(p) { return !!p.ok; }
  function isCheckPassed(p) { return p.passed === true; }
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
   * A DECLARATION, not branches: eleven if(k === ...) would have the same shape
   * as the eleven if(t === ...) it replaces, with different strings. A kind
   * names a template; the template names payload fields; a named formatter
   * covers what a template cannot express.
   *
   * TWO NAMESPACES, and they must not collide:
   *   {slot}   a placeholder, resolved from `fmt` or from the payload
   *   opt      a SUFFIX fragment, keyed by a name that is NOT a slot
   * Writing an opt key as a {slot} used to fill it with an em dash and then
   * append the real value — four templates were broken that way, silently, with
   * `—` in them that looked exactly like honest absence. `validate()` makes that
   * state unreachable: every slot must resolve, and no slot may be an opt key.
   *
   * `body` names the payload field holding the full deliverable (so the row can
   * be expanded), `gap` marks a row whose duration is the gap to the next drawn
   * row, and `dur` names a payload field carrying its own measurement.
   */
  var SUMMARY = {
    turn: [
      { when: function (p) { return !p.end; }, tpl: 'cognitive cycle started' },
      {
        when: function (p) { return !!p.end; },
        tpl: 'done={done} · success={success}',
        opt: {
          verdict: function (p) { return hasReason(p) ? ' · verdict=' + p.verdict : ''; },
          impasse: function (p) { return p.impasse ? ' · impasse' : ''; }
        }
      }
    ],
    message: { tpl: '{text}', fmt: { text: function (p) { return short(p.text, 140); } } },
    context: {
      tpl: 'context inject · SA-Core selection{tiers} · nodes={nodes} chars={chars}{injected}',
      fmt: {
        /* K-115 measured the injection BESIDE the budget instead of redefining
         * `chars`, and this line had not followed: it showed the ceiling (800)
         * and nothing about what injection actually contributed. Shown only when
         * the event carries it — events written before K-115 have the field
         * absent, and "absent" must not render as "zero contributed", which is
         * the same distinction the field was added to preserve. */
        injected: function (p) {
          return p.injectedChars == null ? '' : ' injected=' + p.injectedChars;
        },
        tiers: function (p) {
          if (!hasTiers(p)) { return ''; }
          var tiers = (p.choice && p.choice.tiers) || {};
          var ks = Object.keys(tiers);
          return ks.length ? ' ' + ks.map(function (k) { return k + '×' + tiers[k]; }).join(' ') : '';
        }
      },
      opt: { resume: function (p) { return p.resumeFrom ? ' · resume ' + short(p.resumeFrom, 24) : ''; } }
    },
    reasoning: {
      tpl: 'think: {text}', gap: true,
      fmt: {
        text: function (p) {
          /* An empty string is a fact: the model reasoned and produced nothing
           * to show. An absent field is a different fact. Both used to render as
           * the same blank, which is the em-dash problem wearing no glyph. */
          if (p.text == null) { return ABSENT; }
          var line = firstLine(p.text, 100);
          return line === '' ? '(no reasoning text recorded)' : line;
        }
      }
    },
    plan: {
      tpl: '{text}', gap: true,
      fmt: {
        text: function (p) {
          if (isEmptyReply(p)) { return '(empty reply — honest marker, nothing invented)'; }
          var txt = String(p.text || '');
          /* Two vocabularies live in this field, and both must read correctly.
           *
           * Events written BEFORE K-116 carried the model's raw output, so the
           * tool names had to be parsed out of it. Events written AFTER carry the
           * attempt itself (`planned calls: a/b`, `no calls planned — answered
           * directly`, `unparseable plan`) and the raw output stays in the trace.
           * The old code only knew the first form, so the moment the runtime
           * changed, every tool round would have been mislabelled `reply:
           * planned calls: weather` — the tool names still there, but filed under
           * the wrong word. Recognising both is the point: the export reads files
           * written either side of the change, and the older ones are not wrong,
           * just older. */
          var planned = /^planned calls: /.test(txt);
          var toolless = /^no calls planned/.test(txt) || /^unparseable plan$/.test(txt);
          if (planned || toolless) { return txt; }
          var calls = null;
          try { var o = JSON.parse(txt); if (o && o.calls) { calls = o.calls; } } catch (err) {}
          if (calls) { return 'planned calls: ' + calls.map(function (c) { return c.tool; }).join(', '); }
          return 'reply: ' + firstLine(txt, 100);
        }
      }
    },
    tool: [
      { when: function (p) { return p.stage === 'call'; }, tpl: '{tool} · #{index} · expect={expect}' },
      {
        when: function (p) { return p.stage === 'result'; },
        tpl: '{tool} · {ok} · {durationMs}',
        dur: 'durationMs',
        fmt: {
          /* 这里要的是词表里的短词（`ok`/`fail`/`unmeasured`），不是给人看的
             `PASS`/`FAIL` ⇒ 直接用 `triStatus`，**不要**套 `triLabel` 再转小写
             （那会得到 `pass`，而本行词表是 `ok`）。 */
          ok: function (p) { return triStatus(isToolOk(p)); },
          durationMs: function (p) { return hasDuration(p) ? p.durationMs + 'ms' : '—'; }
        },
        opt: { sha: function (p) { return hasSha(p) ? ' · sha ' + p.outcomeSha : ''; } }
      }
    ],
    check: {
      tpl: '{gate} · {check} · {passed} · expect={expect}',
      fmt: { passed: function (p) { return triLabel(triStatus(isCheckPassed(p))); } }
    },
    verdict: {
      tpl: '{status}',
      opt: { reason: function (p) { return hasReason(p) ? ' · ' + p.reason : ''; } }
    },
    reply: {
      /* No "(click to expand)" here: that is an instruction to a person at a
       * screen, and this string is shared with the export, where there is nothing
       * to click. The affordance belongs to the view that has the pointer. */
      tpl: 'reply: {prefix}{text}',
      body: 'text',
      /* The reply can be the OUTPUT of a call with no row of its own: when the
       * model's second call is not dispatched, the reply IS that call's result.
       * Without this its latency is attributed to nothing — measured: 3.4s of an
       * 8.0s window belonged to no row. */
      gap: true,
      fmt: {
        prefix: function (p) { return hasModel(p) ? '[' + p.model + '] ' : ''; },
        text: function (p) { return firstLine(p.text, 140); }
      }
    }
  };

  /* The payload fields the contract declares for a kind, sorted. Shared with
   * the validator above rather than recomputed: the inspector shows the same
   * set the load-time check reads, so the pane and the check cannot disagree. */
  var FIELDS_CACHE = null;
  function fieldsOf(kind) {
    if (!FIELDS_CACHE) { FIELDS_CACHE = payloadKeysByKind(); }
    return Object.keys(FIELDS_CACHE[kind] || {}).sort();
  }

  /* One line about what a kind IS, for the inspector. Keyed by kind, so it
   * names no protocol event — the table it replaced was keyed by protocol name
   * and could not survive the type lock. */
  var KIND_NOTE = {
    turn: 'the start or the end of one cognitive cycle',
    message: 'what the human said',
    context: 'the memory the cycle was given before it reasoned',
    reasoning: 'the model thinking; not addressed to the human',
    plan: 'the model saying what it intends to do',
    tool: 'a tool call, or that call landing',
    check: 'a criterion verdict on this cycle',
    verdict: 'the cycle judged as a whole',
    reply: 'the model answering; the deliverable of this cycle'
  };

  /* 三态 → 状态串。`undefined`（缺席）必须与 `false`（判为否）分开：
   * 此前两者都被折成 `'fail'`，于是"没测过"和"测了没过"在界面上无法区分。 */
  function triStatus(v) { return v === true ? 'ok' : (v === false ? 'fail' : 'unmeasured'); }

  /* A kind's default status. Kinds absent from this table are done. */
  var STATUS_OF = {
    tool: function (p) {
      if (p.stage === 'call') { return 'pending'; }
      /* `isToolOk` 保留 `!!`：`p.ok` 缺席时它返回 `undefined`，
         与 `false`（真的失败）不同 ⇒ 落到 `unmeasured`。 */
      return triStatus(isToolOk(p));
    },
    check: function (p) { return triStatus(isCheckPassed(p)); },
    /* `isVerdictMet` 是 `status === 'Met'` 的比较 —— 缺席时同样得 `false`。
       与 check 同一形状，故同样按三态处理。 */
    verdict: function (p) { return triStatus(isVerdictMet(p)); }
  };

  function statusOf(node) {
    var fn = STATUS_OF[node.kind];
    return fn ? fn(node.payload) : 'done';
  }

  /* ---- the load-time check that makes a whole class of defect unreachable --
   *
   * Runs once, when this asset loads. A {slot} resolving to neither a formatter
   * nor a declared payload field used to render as `—` — absence of a value and
   * a broken template looked identical on screen. Now the module refuses to
   * load: the difference between a wrong number and no number.
   *
   * The payload fields per kind are DERIVED: PAYLOAD_MAP is keyed by protocol
   * name, KIND_OF maps a protocol name to its kind, so the union over one kind's
   * names is that kind's declared field set. No hardcoded key list.
   */
  function payloadKeysByKind() {
    var byKind = {};
    Object.keys(EF.PAYLOAD_MAP).forEach(function (type) {
      var kind = EF.KIND_OF[type];
      if (!kind) { return; }
      byKind[kind] = byKind[kind] || {};
      var map = EF.PAYLOAD_MAP[type];
      Object.keys(map).forEach(function (key) { byKind[kind][key] = true; });
    });
    return byKind;
  }

  function slotsOf(tpl) {
    var out = [], m, re = /\{(\w+)\}/g;
    while ((m = re.exec(tpl)) !== null) { out.push(m[1]); }
    return out;
  }

  /* Takes the tables as arguments so a guard can hand it a BROKEN one and
   * require the throw. A check that cannot be shown to fire is the thing this
   * project keeps finding: it proves nothing. */
  function validateTables(summary, notDrawn) {
    var keys = payloadKeysByKind();
    var problems = [];
    Object.keys(summary).forEach(function (kind) {
      var spec = summary[kind];
      var variants = Object.prototype.toString.call(spec) === '[object Array]' ? spec : [spec];
      variants.forEach(function (v) {
        slotsOf(v.tpl).forEach(function (slot) {
          var inFmt = !!(v.fmt && v.fmt[slot]);
          var inPayload = !!(keys[kind] && keys[kind][slot]);
          if (!inFmt && !inPayload) {
            problems.push(kind + ': {' + slot + '} resolves to nothing');
          }
          if (v.opt && v.opt[slot]) {
            problems.push(kind + ': {' + slot + '} is also an opt key (a slot cannot be a suffix)');
          }
        });
      });
    });
    if (problems.length) {
      throw new Error('prove_track.render.js: unusable SUMMARY — ' + problems.join('; '));
    }
    /* Every contract kind is either drawn or explicitly not drawn. */
    var unaccounted = Object.keys(EF.KINDS).map(function (k) { return EF.KINDS[k]; })
      .filter(function (kind) { return !summary[kind] && !notDrawn[kind]; });
    if (unaccounted.length) {
      throw new Error('prove_track.render.js: kinds neither drawn nor declared: ' + unaccounted.join(', '));
    }
  }

  function validate() { validateTables(SUMMARY, NOT_DRAWN); }

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

  /* The variant of a kind's spec that applies to this payload. A turn has two
   * ends, so it lists two variants and `when` picks — the same distinction the
   * contract's classOf reads from payload.end. */
  function specFor(node) {
    var spec = SUMMARY[node.kind];
    if (!spec) { return null; }
    var variants = Object.prototype.toString.call(spec) === '[object Array]' ? spec : [spec];
    for (var i = 0; i < variants.length; i++) {
      if (!variants[i].when || variants[i].when(node.payload)) { return variants[i]; }
    }
    return null;
  }

  function summarize(node) {
    var v = specFor(node);
    return v ? fill(v.tpl, node.payload, v.fmt, v.opt) : node.kind;
  }

  /* The full text of the row's deliverable, when the spec names one. */
  function bodyOf(node) {
    var v = specFor(node);
    if (!v || !v.body) { return ''; }
    return String(node.payload[v.body] || '');
  }

  validate();

  PT.render = {
    laneOf: laneOf, summarize: summarize, statusOf: statusOf,
    specFor: specFor, fill: fill, bodyOf: bodyOf,
    /* exported so the guards read the tables rather than restate them */
    LANE_OF: LANE_OF, NOT_DRAWN: NOT_DRAWN, SUMMARY: SUMMARY,
    STATUS_OF: STATUS_OF, KIND_NOTE: KIND_NOTE, fieldsOf: fieldsOf,
    validate: validate, validateTables: validateTables
  };
})();
