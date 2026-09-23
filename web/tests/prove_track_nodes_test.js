/* The trajectory's own real-chain criterion (batch 4).
 *
 * Until now the only real-chain number was the conversation view's — 55 events
 * over 5 turns, produced by ab_verify. The trajectory has none, so after the
 * consumption layer changes there would be nothing that says it was fixed
 * rather than merely not broken. That is the 1e mistake: validating against a
 * baseline that cannot distinguish the two.
 *
 * The criterion is NOT "the new functions match the old ones". The old ones
 * dispatched on the protocol name and received events; the new ones dispatch on
 * `kind` and receive nodes. They cannot agree — the old ones produce undefined
 * throughout when handed a node stream. Comparing them would be the same
 * mistake a third time. (The field-by-field comparison against the old layer
 * WAS run, as a throwaway script, to find the drifts asserted below — that is
 * what such a script is for. It is not an assertion, because the thing it
 * compares is gone.)
 *
 * So: run a real 10-period chain through the tape, take the snapshot's nodes,
 * and require that the Node-side consumption layer handles all of them — and
 * that the defects the comparison found cannot come back.
 *
 * The fixture is a LEAF, not a root (2026-09-17). `chainJobIds` used to walk
 * breadth-first over the whole subtree, so a root's ten periods happened to be
 * a ten-period chain. The window is now the lineage path — root → the period
 * opened — because walking the subtree merged every later branch into one
 * window and a new experience appeared inside the old one it had resumed from.
 * Asking from a leaf gives the same real 10-period, 80-event, tool-free chain
 * this file always exercised, with the semantics the panel now has. Same
 * criterion, same numbers, different (and correct) reason.
 *
 * Usage: node prove_track_nodes_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const A = path.join(__dirname, '..', 'assets');
const EV = path.join(__dirname, '..', '..', '..', '.helix', 'events');
global.window = {};
['event_family.js', 'period_normalize.js', 'node_shape.js', 'assembly.js',
 'prove_track.data.js', 'prove_track.render.js', 'prove_track.node.js',
 'prove_track.export.js'].forEach(function (f) {
  const p = path.join(A, f);
  if (fs.existsSync(p)) { eval(fs.readFileSync(p, 'utf8')); }
});

const NORM = global.window.CxNormalize;
const ASM = global.window.CxAssembly;
const PT = global.window.CxProveTrack;
const EF = global.window.CxEventFamily;

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  PASS  ' + name); }
  else { failures++; console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}

/* ---- the real files ---- */
const periods = [];
const byJob = {};
fs.readdirSync(EV).forEach(function (name) {
  if (!name.endsWith('.events.jsonl')) { return; }
  const stem = name.slice(0, -'.events.jsonl'.length);
  const rows = fs.readFileSync(path.join(EV, name), 'utf8').trim()
    .split('\n').filter(Boolean).map(JSON.parse);
  if (!rows.length) { return; }
  /* Identity comes from the ROW (period_id), never from the file name. A name is
   * a locator; reading identity out of it is the mistake B15 removed. Rows
   * written before the field existed fall back to the stem, which is exactly the
   * legacy case and nothing else. */
  const jobId = (rows[0] && rows[0].period_id) || stem;
  byJob[jobId] = rows;
  let parent = null;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].type === 'context/inject') {
      parent = (rows[i].data || {}).resume_from || null;
      break;
    }
  }
  periods.push({ period_id: jobId, job_id: (rows[0] && rows[0].job_id) || jobId, parent: parent, first_ts: rows[0].time || '' });
});

// A leaf, so the lineage path is the full 10 periods (see the header note).
const ids = NORM.chainJobIds(periods, 'run-0537fb101ecccb5e');
const merged = NORM.mergeChain(byJob, ids);
const tape = ASM.create();
tape.feed(merged.events);
const snap = tape.snapshot();

check('the real chain reaches the tape', merged.events.length === 80,
  String(merged.events.length));
check('the snapshot carries all of them as nodes', snap.nodes.length === 80,
  String(snap.nodes.length));

/* ---- a node's identity is its two parts, not an opaque key ---- */
check('every node names the file it came from',
  snap.nodes.every(function (n) { return typeof n.source === 'string' && n.source; }),
  'source missing — a turn header in a merged chain could not name its period');
check('the node key is its parts welded',
  snap.nodes.every(function (n) { return n.node === n.source + '#' + n.lineNo; }));

/* ---- the Node-side consumption layer */
const NODE_SIDE = PT && PT.node;
const RENDER = PT && PT.render;
check('the Node-side consumption layer exists', !!NODE_SIDE,
  NODE_SIDE ? '' : 'PT.node missing — this is the red state before 3b-1');
check('the render tables exist', !!RENDER,
  RENDER ? '' : 'PT.render missing — the tables moved out of node.js at the 400-line line');

const kinds = Array.from(new Set(snap.nodes.map(function (n) { return n.kind; })));

if (NODE_SIDE && RENDER) {
  const unclassified = snap.nodes.filter(function (n) {
    return n.kind === 'unknown' || !n.kind;
  });
  check('every node is classified (no unknown kind)', unclassified.length === 0,
    String(unclassified.length));

  const empty = [];
  kinds.forEach(function (k) {
    if (!RENDER.SUMMARY[k]) { return; }
    const n = snap.nodes.filter(function (x) { return x.kind === k; })[0];
    const s = RENDER.summarize(n);
    if (typeof s !== 'string' || !s.trim()) { empty.push(k + '=' + JSON.stringify(s)); }
  });
  check('every drawn kind produces a non-empty summary', empty.length === 0,
    JSON.stringify(empty));
}

/* ---- P0-3: the tables partition the contract exactly ----------------
 *
 * A kind with no summary is not drawn; a kind in neither table would vanish
 * from the trajectory with nobody having decided that.
 */
if (RENDER) {
  const contractKinds = Object.keys(EF.KINDS).map(function (k) { return EF.KINDS[k]; }).sort();
  const laneKinds = Object.keys(RENDER.LANE_OF).sort();
  const drawn = Object.keys(RENDER.SUMMARY).sort();
  const declared = Object.keys(RENDER.NOT_DRAWN).sort();

  check('drawn + not-drawn account for the contract exactly',
    JSON.stringify(drawn.concat(declared).sort()) === JSON.stringify(contractKinds),
    JSON.stringify(drawn.concat(declared).sort()) + ' vs ' + JSON.stringify(contractKinds));

  /* The lane table's keys ARE the drawn set. A drawn row that has no lane would
   * have nowhere to be placed, and a lane for a kind that is never drawn would
   * be a placement nobody can reach. */
  check('the lane table covers exactly the drawn kinds',
    JSON.stringify(laneKinds) === JSON.stringify(drawn),
    JSON.stringify(laneKinds) + ' vs ' + JSON.stringify(drawn));
  const overlap = drawn.filter(function (k) { return declared.indexOf(k) > -1; });
  check('a kind is drawn or not drawn, never both', overlap.length === 0, JSON.stringify(overlap));

  /* Metering is measured, not performed. The old layer encoded the same
   * decision by filtering on its own protocol-name table; drawing it would add
   * ten rows per chain and redefine every duration, because a duration is the
   * gap to the next drawn row. */
  check('metering is declared as not drawn and has no summary',
    !!RENDER.NOT_DRAWN.metering && !RENDER.SUMMARY.metering,
    'metering would become a row');
}

/* ---- the defects the field-by-field comparison found ------------------
 *
 * Each is asserted with a positive control: a check that cannot be shown to
 * fire is the thing this project keeps finding, and it proves nothing.
 */
if (NODE_SIDE && RENDER) {
  /* 1. A {slot} that resolves to nothing used to render as an em dash — the
   *    same glyph as honest absence. Four templates were broken this way. */
  check('a slot with no formatter and no payload value is refused',
    (function () {
      try {
        RENDER.validateTables({ message: { tpl: '{not_a_field}' }, turn: {}, metering: {} }, { metering: 1 });
        return false;
      } catch (e) { return /resolves to nothing/.test(e.message); }
    })(),
    'validateTables accepted an unresolvable slot');

  check('a slot that is also an opt key is refused',
    (function () {
      try {
        RENDER.validateTables(
          { verdict: { tpl: '{status}{reason}', opt: { reason: function () { return ''; } } } }, {});
        return false;
      } catch (e) { return /also an opt key/.test(e.message); }
    })(),
    'validateTables accepted a slot that is also a suffix');

  check('a kind in neither table is refused',
    (function () {
      try {
        RENDER.validateTables({ message: { tpl: '{text}' } }, {});
        return false;
      } catch (e) { return /neither drawn nor declared/.test(e.message); }
    })(),
    'validateTables accepted an unaccounted kind');

  check('the real tables pass the same validator',
    (function () { try { RENDER.validate(); return true; } catch (e) { return e.message; } })() === true);

  /* On this data every slot resolves, so a substituted em dash would be a
   * broken template and nothing else. */
  const substituted = [];
  snap.nodes.forEach(function (n) {
    if (!RENDER.SUMMARY[n.kind]) { return; }
    const v = RENDER.specFor(n);
    if (!v) { return; }
    (v.tpl.match(/\{(\w+)\}/g) || []).forEach(function (raw) {
      const slot = raw.slice(1, -1);
      if (v.fmt && v.fmt[slot]) { return; }
      if (n.payload[slot] === undefined || n.payload[slot] === null) {
        substituted.push(n.kind + '.' + slot);
      }
    });
  });
  check('no summary slot was filled with an em dash on real data',
    substituted.length === 0, JSON.stringify(substituted.slice(0, 6)));

  /* 2. The result pane showed a digest where the artifact belongs. */
  const toolChain = 'run-7efbf0f8aacf96d5';
  const t2 = ASM.create();
  t2.feed(byJob[toolChain]);
  const toolNodes = t2.snapshot().nodes;
  const resultNode = toolNodes.filter(function (n) {
    return n.kind === 'tool' && n.payload.stage === 'result';
  })[0];
  check('the tool chain has a tool result to look at', !!resultNode);
  if (resultNode) {
    const d = NODE_SIDE.detailOf(resultNode);
    const outcome = String(resultNode.payload.outcome);
    /* Same artifact, laid out: pretty-printed when it is JSON, verbatim when it
     * is not. A digest proves identity; it does not show what was said. */
    check('the result pane shows the outcome, not a digest',
      JSON.stringify(JSON.parse(d)) === JSON.stringify(JSON.parse(outcome)),
      JSON.stringify(d.slice(0, 80)));
    check('a non-JSON outcome is shown verbatim',
      NODE_SIDE.detailOf({ kind: 'tool', payload: { stage: 'result', tool: 't', outcome: 'plain text' } }) === 'plain text');
    check('a result whose outcome is absent says so, and does not invent one',
      NODE_SIDE.detailOf({ kind: 'tool', payload: { stage: 'result', tool: 't' } }) === '—');
  }

  /* 3. The context row lost the node hits it was given. Ask the first context
   * node that actually CARRIES hits: which period leads the window is a
   * property of the fixture (the lineage path's root can legitimately have no
   * memory hits), while the criterion here is the rendering. The no-hit path
   * has its own assertion immediately below, so nothing is left uncovered. */
  const ctxNode = snap.nodes.filter(function (n) {
    return n.kind === 'context'
      && n.payload && n.payload.choice && (n.payload.choice.top || []).length > 0;
  })[0];
  check('the context pane lists the node hits',
    !!ctxNode && NODE_SIDE.detailOf(ctxNode).indexOf('·') > -1,
    JSON.stringify(ctxNode ? NODE_SIDE.detailOf(ctxNode).slice(0, 60) : null));
  check('a context with no hit says so, and does not invent one',
    NODE_SIDE.detailOf({ kind: 'context', payload: { choice: { top: [] } } }) === '(no node hit)');

  /* 4. The deliverable row: the period's total and the full text. */
  const session = NODE_SIDE.buildSession(snap.nodes);
  const usage = NODE_SIDE.derivePeriodUsage(snap.nodes);
  const replyCls = EF.KIND_CLASS.reply;
  const replies = session.filter(function (r) { return r.kind === 'ev' && r.cls === replyCls; });
  const others = session.filter(function (r) { return r.kind === 'ev' && r.cls !== replyCls; });
  check('exactly one reply row per period', replies.length === ids.length,
    replies.length + ' replies for ' + ids.length + ' periods');
  /* Each row carries ITS OWN period's total. The window total stamped on every
   * reply row was the defect: three different answers reported 4398 apiece,
   * measured, because the window total is the sum of all of them. */
  const perSource = NODE_SIDE.usageBySource(snap.nodes);
  check('every reply row carries its own period\'s total',
    replies.every(function (r) { return r.tok === perSource[r.source].total; }),
    JSON.stringify(replies.map(function (r) { return r.tok; })));
  check('no reply row carries the window total to stand for its own',
    !!usage && ids.length < 2 || replies.every(function (r) { return r.tok !== usage.total; }),
    'window total ' + (usage && usage.total) + ' vs ' + JSON.stringify(replies.map(function (r) { return r.tok; })));
  check('no other row carries a token figure',
    others.every(function (r) { return r.tok === null; }));
  /* The expand shows the row's OWN text, verbatim — not the truncated summary
   * the cell already shows. */
  const textById = {};
  snap.nodes.forEach(function (n) { textById[n.node] = n.payload.text; });
  check('every reply row expands to its own verbatim answer',
    replies.every(function (r) { return r.full.length > 0 && r.full === String(textById[r.id] || ''); }),
    JSON.stringify(replies.map(function (r) { return r.full.slice(0, 20); }).slice(0, 2)));

  /* 5. Durations: a tool result carries its own measurement; a reasoning row is
   *    measured by the gap to the next drawn row. Without the gap, LLM TIME
   *    reads an em dash forever. */
  const gapCls = [EF.KIND_CLASS.reasoning, EF.KIND_CLASS.plan];
  const gapRows = session.filter(function (r) {
    return r.kind === 'ev' && gapCls.indexOf(r.cls) > -1;
  });
  /* Neither rule can be checked on the 80-chain: it has no tool calls, and no
   * sub-second gap inside a turn. The chain that has both is the one to use. */
  const t3 = ASM.create();
  t3.feed(byJob[toolChain]);
  const toolSession = NODE_SIDE.buildSession(t3.snapshot().nodes);
  const toolCls = EF.KIND_CLASS.tool;
  const toolRows = toolSession.filter(function (r) { return r.kind === 'ev' && r.cls === toolCls; });
  const measured = toolRows.filter(function (r) { return r.dur > 0; });
  check('a tool result keeps its own duration',
    measured.length > 0, toolRows.length + ' tool rows, none measured');
  const gapRows2 = toolSession.filter(function (r) {
    return r.kind === 'ev' && gapCls.indexOf(r.cls) > -1;
  });
  /* The direction is part of the meaning: a response-side row carries the wait
   * that ENDED at it. Derived here from the timestamps rather than pinned to a
   * number, so a future flip of the direction cannot pass by matching a value. */
  check('a gap row carries the interval that ended at it, derived',
    (function () {
      var drawn = toolSession.filter(function (r) { return r.kind === 'ev'; });
      for (var i = 1; i < drawn.length; i++) {
        var r = drawn[i], prev = drawn[i - 1];
        if (gapCls.indexOf(r.cls) < 0) { continue; }
        var want = Math.max(0, Date.parse(r.ts) - Date.parse(prev.ts));
        if (!isFinite(want)) { continue; }
        if (r.dur !== want) { return false; }
      }
      return true;
    })());
  check('reasoning rows are measured by the gap, not left at zero',
    gapRows2.some(function (r) { return r.dur > 0; }),
    gapRows2.length + ' rows in ' + toolChain + ', all zero');

  /* 6. The turn header names its period: a merged chain is exactly where a
   *    reader needs to see that the turns came from different files. */
  const headers = session.filter(function (r) { return r.kind === 'turn'; });
  const chainSet = {};
  ids.forEach(function (i) { chainSet[i] = true; });
  check('every turn header names a period of this chain',
    headers.length === ids.length &&
      headers.every(function (h) { return chainSet[h.note] === true; }),
    JSON.stringify(headers.map(function (h) { return h.note; }).slice(0, 3)));

  /* 7. Metering must not become a row — the decision, on real data. */
  check('no metering row is drawn',
    session.every(function (r) { return r.cls !== 'USAGE'; }),
    session.filter(function (r) { return r.cls === 'USAGE'; }).length + ' metering rows');
  check('and every other node still becomes one',
    session.length === 80, String(session.length));
}

/* ---- P0-2: the switch, asserted rather than noted ---------------------
 *
 * These were RED ON PURPOSE until the migration landed. They are green now
 * because the caller changed, not because an assertion did:
 *   1. prove_track.js takes its consumption from PT.node / PT.render
 *   2. it no longer accepts a stream — the tape is the only way in
 *   3. it fetches no period of its own
 *   4. the consumption half of prove_track.data.js is gone
 *
 * If one of these goes red again, do NOT relax it: fix the caller. Editing the
 * assertion would hide a real regression — the trajectory view would keep
 * running a second data path while a green run claimed otherwise.
 */
{
  const view = fs.readFileSync(path.join(A, 'prove_track.js'), 'utf8');
  check('the trajectory view drives the Node layer',
    /buildSession = N\.buildSession/.test(view),
    'prove_track.js still takes its consumption from the legacy path');
  check('the naive legacy wiring is gone',
    !/buildSession\s*=\s*PT\.buildSession/.test(view),
    'buildSession is still bound from PT.buildSession');
  check('the stream parameter is gone',
    !/function \(jobId, meta, stream\)/.test(view) && !/stream && stream\.length/.test(view),
    'the trajectory still accepts a stream to render');
  check('the trajectory fetches no period of its own',
    !/\/api\/events/.test(view),
    'a second data path — the shell owns the read now');

  const legacyData = fs.readFileSync(path.join(A, 'prove_track.data.js'), 'utf8');
  const stillExportsConsumption = /PT\.(summarize|statusOf|buildSession|derivePeriodUsage|resultOf)\s*=/.test(legacyData);
  check('exactly one implementation is exported (the legacy one is not)',
    !stillExportsConsumption,
    'prove_track.data.js still exports a consumption function — two complete implementations coexist');

  /* The view reads the session item's names; the layer that produces it is the
   * only place those names are decided. A rename on one side only is a silent
   * blank column, so the pair is asserted together. */
  const itemFields = ['cls', 'lane', 'detail', 'term', 'tool', 'full', 'tok', 'kindNote', 'fields', 'ord', 'ts'];
  const viewSrc = fs.readFileSync(path.join(A, 'prove_track.view.js'), 'utf8');
  const missingInView = itemFields.filter(function (f) {
    return new RegExp('\\.' + f + '\\b').test(viewSrc) === false;
  });
  check('the view reads the item fields the Node layer produces',
    missingInView.length === 0, JSON.stringify(missingInView));
}

/* ---- the export is a projection of what the view rendered --------------
 *
 * Pull, and a pure function of the rows it is handed. Each assertion here has a
 * control, because the interesting failure is not "the document is empty" — it
 * is a document that looks complete and says something the view never showed.
 */
if (PT.export) {
  const session = NODE_SIDE.buildSession(snap.nodes);
  const evRows = session.filter(function (r) { return r.kind === 'ev'; });
  const md = PT.export.markdown(session, { name: 'chain' });

  const tableRows = md.split('\n').filter(function (l) { return /^\| \d+ \|/.test(l); });
  check('the document has one table line per rendered row',
    tableRows.length === evRows.length, tableRows.length + ' vs ' + evRows.length);
  check('every row carries its identity anchor',
    evRows.every(function (r) { return md.indexOf('`' + r.id + '`') !== -1; }),
    'a row without source#lineNo cannot be checked against its record');
  /* The DOCUMENT declares which kinds are measured but not drawn — so the word
   * appears on purpose. What must not appear is a metering ROW. */
  const meteringCls = EF.KIND_CLASS.metering;
  check('metering is not drawn as a row in the document',
    tableRows.every(function (l) { return l.indexOf('| ' + meteringCls + ' |') === -1; }) &&
      md.indexOf('| ' + meteringCls + ' |') === -1);
  check('and the document says so, rather than leaving a gap in the numbering to be inferred',
    md.indexOf('not drawn as rows') !== -1);

  const replyCls = EF.KIND_CLASS.reply;
  const reply = evRows.filter(function (r) { return r.cls === replyCls && r.full; })[0];
  check('the deliverable is quoted in full',
    !!reply && md.indexOf(reply.full) !== -1, reply ? reply.full.slice(0, 30) : 'no reply row');

  /* Positive control: the document is a function of what it was GIVEN. If a
   * sentinel row that exists nowhere else comes out, it cannot be re-deriving
   * from the tape. */
  const sentinel = [{ kind: 'ev', id: 'L#9', cls: 'REPLY', status: 'done',
    summary: 'SENTINELSUMMARY', dur: 7, tok: 11, payload: '{"k":1}', detail: 'd',
    full: 'SENTINELBODY', term: false, ts: null, tool: null, kindNote: '' }];
  const m1 = PT.export.markdown(sentinel, null);
  check('the document is built from the rows it was given (positive control)',
    m1.indexOf('SENTINELSUMMARY') !== -1 && m1.indexOf('SENTINELBODY') !== -1 &&
      m1.indexOf('L#9') !== -1);
  check('an empty session yields a document, not a crash',
    PT.export.markdown([], null).indexOf('# ProveTrack export') === 0);
  const fenced = [{ kind: 'ev', id: 'Y#1', cls: 'REPLY', status: 'done', summary: 's',
    dur: 0, tok: null, payload: '{"a":"```"}', detail: 'd', full: 'x```y', term: false,
    ts: null, tool: null, kindNote: '' }];
  check('a fence inside the body widens the fence instead of ending the block',
    PT.export.markdown(fenced, null).indexOf('````') !== -1);
  check('a row with nothing to quote contributes only its table line',
    (function () {
      const quiet = [{ kind: 'ev', id: 'Z#1', cls: 'END', status: 'done', summary: 's',
        dur: 0, tok: null, payload: '', detail: PT.data.ABSENT, full: '', term: false,
        ts: null, tool: null, kindNote: '' }];
      const m2 = PT.export.markdown(quiet, null);
      return m2.indexOf('### ') === -1 && m2.indexOf('| 1 |') !== -1;
    })());

  /* ---- the export is EVIDENCE, so its own numbers must survive a check ----
   *
   * An exhibit is not a rendering: it is a record someone will cite. A negative
   * span and a negative "not attributed" are not cosmetic — they are the two
   * numbers a reviewer reads to decide whether the window adds up.
   *
   * Measured on the real 10-period chain (70 ev rows, 20 distinct timestamps):
   *   forward   span  428.0s · not attributed  331.0s
   *   reversed  span -428.0s · not attributed -525.0s
   * — i.e. the same rows, in a different arrival order, rendered a complete
   * looking exhibit whose headline numbers were subtraction artefacts. Both
   * halves of the repair are asserted here, each with a control:
   *   1. the arithmetic is order-independent (min/max, not first/last);
   *   2. an out-of-order stream is REFUSED, not silently re-sorted (re-sorting
   *      would hide the one fact the document exists to expose).
   * Scope, stated: every one of the 162 real event files on disk is already
   * ordered, so (2) is the guard for a stream that has gone wrong, not a
   * description of today's data. It is still the assertion that can go red.
   */
  const tsOf = function (r) { return r.kind === 'ev' && r.ts ? Date.parse(r.ts) : null; };

  check('the rows are in time order, so the window has a direction (assertion)',
    (function () {
      let prev = null, outOfOrder = 0;
      session.forEach(function (r) {
        const t = tsOf(r);
        if (t === null) { return; }
        if (prev !== null && t < prev) { outOfOrder++; }
        prev = t;
      });
      return outOfOrder === 0;
    })(),
    'a row earlier than its predecessor makes every span below a subtraction in the wrong direction');

  check('the same predicate goes red on rows that are not in time order (control)',
    (function () {
      const reversed = session.slice().reverse();
      let prev = null, outOfOrder = 0;
      reversed.forEach(function (r) {
        const t = tsOf(r);
        if (t === null) { return; }
        if (prev !== null && t < prev) { outOfOrder++; }
        prev = t;
      });
      return outOfOrder > 0;
    })(),
    'if the predicate cannot fail on reversed input it asserts nothing');

  const realSpan = PT.export.span(session);
  const reversedSpan = PT.export.span(session.slice().reverse());

  check('the declared span is not negative',
    realSpan.ms !== null && realSpan.ms >= 0, JSON.stringify(realSpan));

  check('the span is a fact about the rows, not about their arrival order (repair 1)',
    reversedSpan.ms !== null && reversedSpan.ms === realSpan.ms,
    'forward ' + JSON.stringify(realSpan) + ' vs reversed ' + JSON.stringify(reversedSpan) +
    ' — a span that changes with row order is derived from the endpoints, not the window');

  check('and the endpoints themselves are order-independent, not just the difference',
    reversedSpan.from === realSpan.from && reversedSpan.to === realSpan.to,
    'from/to must be the earliest and latest timestamps, whichever row carries them');

  check('an out-of-order stream is refused rather than silently re-sorted (repair 2)',
    (function () {
      try { PT.export.assertTimeOrdered(session.slice().reverse()); return false; }
      catch (e) { return /not in time order/.test(e.message); }
    })(),
    're-sorting would hide that the stream went out of order — the fact the exhibit exists to expose');

  check('and the refusal is what a caller cannot ignore: markdown() throws too (repair 2)',
    (function () {
      try { PT.export.markdown(session.slice().reverse(), null); return false; }
      catch (e) { return /export refused/.test(e.message); }
    })(),
    'a boolean a caller can ignore is not a gate');

  check('the refusal does not fire on the ordered stream (control)',
    (function () {
      try { PT.export.assertTimeOrdered(session); return true; }
      catch (e) { return false; }
    })(),
    'a gate that refuses everything is not a gate either');

  /* `not attributed` is DERIVED (span − waits), so it inherits the span's sign.
   * Asserting it separately is not redundant: it is the number a reviewer uses
   * to decide whether the rows account for the window. */
  check('the unaccounted remainder is not negative either',
    (function () {
      const waits = session.reduce(function (a, r) {
        return a + (r.kind === 'ev' && r.dur > 0 ? r.dur : 0);
      }, 0);
      return realSpan.ms !== null && (realSpan.ms - waits) >= 0;
    })(),
    'a negative remainder means the rows reported more time than the window contained');

  /* The document declares how many periods it spans. That declaration is what a
   * reviewer trusts instead of re-deriving the chain, so it must match the rows
   * it was handed — and a multi-period window must not be presentable as one
   * undifferentiated run. */
  check('the declared period count is the one the rows carry',
    PT.export.source(session).count === new Set(evRows.map(function (r) { return r.source; })).size,
    JSON.stringify(PT.export.source(session)));

  check('a multi-period window says so, rather than reading as one run',
    md.indexOf('10 periods') !== -1,
    'the window line must name the periods it merged');

  /* ---- declared coverage == actual coverage, for the rows that are DROPPED --
   *
   * The export declares the kinds that are measured but not drawn. That table is
   * a claim about the CONTRACT; the window is merged from files written by more
   * than one process, so the set that actually reaches `buildSession` can be
   * larger. A kind in neither table is dropped by the render filter and the
   * declaration says nothing — declared coverage one level away from actual.
   *
   * Measured before the runtime declaration existed: the contract's 10 kinds are
   * exactly covered, so nothing is dropped today. That is precisely why this has
   * to be asserted rather than observed — the gap opens the day a new kind
   * arrives, which is the day nobody is looking.
   */
  check('the window carries no kind that no table accounts for (real chain)',
    PT.export.undeclaredKinds(session).length === 0,
    JSON.stringify(PT.export.undeclaredKinds(session)));

  /* The control runs on the RAW node stream, not on the session: `buildSession`
   * maps every node to the carrier kind `ev`, so on the session the alien's kind
   * is already gone. Asserting on the session would have been a control that
   * cannot fail — measured: it did not, and that is how this was found.
   *
   * `buildSession` filters on `R.SUMMARY[n.kind]` UPSTREAM of the export, so a
   * kind no table accounts for never reaches the exporter at all. The invariant
   * therefore lives one step earlier, in the render tables, and the real failure
   * mode is a NEW kind added to the contract and left in neither table. That is
   * what this control mutates. */
  check('a kind no table accounts for is caught where it can occur (control)',
    (function () {
      const R = PT.render;
      const underDeclared = {};
      Object.keys(R.NOT_DRAWN).forEach(function (k) { underDeclared[k] = R.NOT_DRAWN[k]; });
      /* The contract kind that today is declared-not-drawn is left undeclared —
       * exactly the state a new contract kind starts in. */
      Object.keys(R.NOT_DRAWN).forEach(function (k) { delete underDeclared[k]; });
      try {
        R.validateTables(R.SUMMARY, underDeclared);
        return false; // no throw ⇒ the checker does not check
      } catch (e) {
        return /neither drawn nor declared/.test(e.message);
      }
    })(),
    'a contract kind in neither table must fail loudly, and the declaration must be what fails it');

  check('the loaded tables pass that same check (assertion)',
    (function () {
      try { PT.render.validate(); return true; } catch (e) { return false; }
    })(),
    'if the shipped tables fail their own validator the page would not have loaded — this makes the pass explicit');

  check('and the carrier kinds the reducer itself introduces are not mistaken for drops (control)',
    (function () {
      const found = PT.export.undeclaredKinds(session);
      return found.indexOf('ev') === -1 && found.indexOf('turn') === -1;
    })(),
    'ev/turn are the session vocabulary, not data that went missing');
}

/* ---- the export's row count is the rows it was given, not the rows it drew --
 *
 * `rows: N over M turns` is a claim about the exhibit. If it is computed from
 * the same structure it is describing, the claim can never be checked against
 * the thing it claims to describe — the document would agree with itself. This
 * compares the CLAIM against the DRAWN table, which is what a reader sees.
 */
if (PT.export) {
  const session = NODE_SIDE.buildSession(snap.nodes);
  const md = PT.export.markdown(session, { name: 'chain' });
  const drawn = md.split('\n').filter(function (l) { return /^\| \d+ \|/.test(l); }).length;
  const m = md.match(/^- rows: (\d+) over /m);
  check('the header actually states a row count (so the next check can be judged)',
    !!m, 'no `- rows: N over` line found — the comparison below would be vacuous');
  const claimed = m ? Number(m[1]) : NaN;
  check('the row count claimed in the header equals the rows actually drawn',
    claimed === drawn, 'claimed ' + claimed + ', drew ' + drawn);
  check('the same comparison fails when a row is dropped from the table (control)',
    (function () {
      const onlyOne = md.split('\n').filter(function (l) { return !/^\| \d+ \|/.test(l) || /^\| 1 \|/.test(l); }).join('\n');
      const drawn2 = onlyOne.split('\n').filter(function (l) { return /^\| \d+ \|/.test(l); }).length;
      return drawn2 !== claimed;
    })(),
    'a comparison that holds for any document cannot catch a truncated one');
}

/* ---- P1-3: `when` is a function, never a string to evaluate ---- */
if (RENDER) {
  const stringWhen = [];
  Object.keys(RENDER.SUMMARY).forEach(function (k) {
    const spec = RENDER.SUMMARY[k];
    const variants = Object.prototype.toString.call(spec) === '[object Array]' ? spec : [spec];
    variants.forEach(function (v) {
      if (v.when !== undefined && typeof v.when !== 'function') { stringWhen.push(k); }
    });
  });
  check('every SUMMARY when is a function, not a string to evaluate',
    stringWhen.length === 0, JSON.stringify(stringWhen));
}

console.log('');
console.log(failures === 0 ? 'OK — all passed' : 'FAILED: ' + failures);
/* ---- the derivation: what each conclusion rests on ----------------------
 *
 * A timeline says when; a certificate says what supports what. `derivation()`
 * is the second half, and `dangling` is the assertion that matters: a check
 * citing evidence the window does not contain is the failure this structure
 * exists to make visible, and it is NOT the same as a check that passed.
 *
 * The fixture is written from the real event shape, measured in
 * `.helix/events/run-0212da5381eee6a3.events.jsonl`:
 *   check/status   { check_id, check, expect, actual, gate, judge, passed,
 *                    reason, evidence_id }
 *   tool/result    { tool, index, ok, duration_ms, outcome, outcome_sha }
 *   verdict/status { job_id, status, checks, reason }
 * and one property the synthetic chain cannot exercise: the real trajectory
 * fixture used elsewhere in this file has no CHECK or TOOL rows at all, so
 * "the citation resolves" was unverifiable there. That is why this fixture
 * exists rather than a longer assertion on the old one.
 *
 * A naming fact the fixture must respect, and the first version got wrong: the
 * exhibit id is DERIVED as `{source}#{index}`, where `source` is the period the
 * row came from — not the short node prefix (`run#6`). A fixture that invents
 * `source: "run"` produces a citation that cannot resolve and would read as a
 * dangling reference the page never had.
 */
const DERIV_PERIOD = 'run-0212da5381eee6a3';
function derivationFixture() {
  const ev = (id, cls, payload) => ({
    kind: 'ev', id: id, source: DERIV_PERIOD, turn: 't1', ord: 1,
    ts: '2026-09-07T18:17:00Z', cls: cls, lane: 'x', dur: 0, status: 'done',
    summary: cls + ' ' + id, tool: null, kindNote: '',
    fields: [], payload: JSON.stringify(payload), detail: '', term: false,
  });
  return [
    ev('p#5', 'TOOL', { stage: 'result', tool: 'calc', index: 0, ok: true, durationMs: 277 }),
    ev('p#6', 'TOOL', { stage: 'result', tool: 'fs.read', index: 1, ok: true, durationMs: 12 }),
    ev('p#7', 'CHECK', { checkId: DERIV_PERIOD + '#c0', check: 'exec_ok', expect: 'ok',
      actual: 'ok=true echo=false', gate: 'hard', judge: 'rule', passed: false,
      reason: 'ok=true echo=false', evidenceId: DERIV_PERIOD + '#0' }),
    ev('p#8', 'CHECK', { checkId: DERIV_PERIOD + '#c1', check: 'shape', expect: 'numbers',
      actual: '[1,2]', gate: 'soft', judge: 'model', passed: true,
      evidenceId: DERIV_PERIOD + '#1' }),
    ev('p#9', 'VERDICT', { jobId: DERIV_PERIOD, status: 'Unmet', checks: 2,
      reason: 'failed: exec_ok' }),
  ];
}

check('the derivation reads the conclusion, its checks and their exhibits',
  (function () {
    const d = PT.export.derivation(derivationFixture());
    if (!d.verdict || d.verdict.status !== 'Unmet') { return false; }
    if (d.checks.length !== 2) { return false; }
    // The two citation keys are DERIVED from source#index, not invented.
    if (!d.exhibits[DERIV_PERIOD + '#0'] || !d.exhibits[DERIV_PERIOD + '#1']) { return false; }
    return d.resolved.length === 2 && d.dangling.length === 0;
  })(),
  'conclusion, judgements and exhibits must come out of the rows already in hand');

check('a check whose evidence is not in the window is DANGING, not passed (control)',
  (function () {
    const rows = derivationFixture();
    // Drop the exhibit for #0 — the very failure a certificate must not hide.
    const trimmed = rows.filter((r) => r.id !== 'p#5');
    const d = PT.export.derivation(trimmed);
    if (d.dangling.length !== 1) { return false; }
    if (d.resolved.length !== 1) { return false; }
    return d.dangling[0].check === 'exec_ok' &&
      d.dangling[0].cites === DERIV_PERIOD + '#0';
  })(),
  'a citation that resolves to nothing must surface as dangling with its id named');

check('a check with no citation at all is also dangling, not assumed fine (control)',
  (function () {
    const rows = derivationFixture().map((r) => {
      if (r.id !== 'p#7') { return r; }
      const p = JSON.parse(r.payload); delete p.evidenceId;
      return Object.assign({}, r, { payload: JSON.stringify(p) });
    });
    const d = PT.export.derivation(rows);
    return d.dangling.length === 1 && d.resolved.length === 1;
  })(),
  'silence is not a passing citation');

/* ---- what the certificate shows WITHOUT being asked ---------------------
 *
 * The rule is one sentence: the conclusion, plus every check that does not
 * resolve; everything else folded. The assertions below exist because the
 * temptation is to make the default "everything", and a certificate that shows
 * everything has no default at all — the reader pays the same cost as the log
 * they were trying to avoid.
 */
check('the certificate shows the conclusion and the dangling checks, nothing else',
  (function () {
    const d = PT.export.derivation(derivationFixture());
    const st = PT.export.certificateState(d);
    if (!st.verdict || st.verdict.status !== 'Unmet') { return false; }
    // Two checks exist, both resolve, so the default head is empty — and that is
    // the honest answer, not a bug: nothing needs the reader's attention.
    return st.head.length === 0 && st.foldedChecks === 2 && st.foldedExhibits === 2 &&
      st.totals.checks === 2 && st.totals.dangling === 0;
  })(),
  'a clean chain folds entirely; the conclusion is the whole default');

check('and a broken citation is what gets promoted (control)',
  (function () {
    // Same fixture minus one exhibit: now exactly one check is dangling.
    const rows = derivationFixture().filter((r) => r.id !== 'p#5');
    const st = PT.export.certificateState(PT.export.derivation(rows));
    if (st.head.length !== 1) { return false; }
    if (st.foldedChecks !== 1) { return false; }
    // The promoted row must carry the citation the reader has to chase.
    return st.head[0].cites === DERIV_PERIOD + '#0' &&
      st.open[st.head[0].id] && st.open[st.head[0].id].exhibit === true;
  })(),
  'the dangling check is the only one unfolded, and it opens its (missing) exhibit');

check('the default is selective, not "everything" (control)',
  (function () {
    const rows = derivationFixture().filter((r) => r.id !== 'p#5');
    const d = PT.export.derivation(rows);
    const st = PT.export.certificateState(d);
    // If the default were "all checks", the head would equal every check and the
    // fold counts would be zero. Asserting the inequality is what makes the rule
    // falsifiable rather than decorative.
    return st.head.length !== d.checks.length && st.foldedChecks > 0;
  })(),
  'a default that promotes everything asserts nothing about what matters');

/* ---- a window with no judgement says so (K-114) -------------------------
 *
 * A `Met` verdict with no check row behind it is the ABSENCE of a finding, not a
 * finding — and an exhibit that prints only `Met` reads as "verified". Measured
 * in this workspace: 5 of the 6 most recent periods carry no check row, and a
 * wrong answer was stamped `success` in a window nothing had judged.
 *
 * The good case is asserted too, on purpose: a line that appears only when
 * something is wrong is itself a shape, and "verified" and "unverified" have to
 * look different at a glance. The criterion is the CHECK COUNT, not the verdict
 * string — no check row can support any conclusion.
 */
check('a window with no check row states that it is UNVERIFIED',
  (function () {
    const P = 'run-nc';
    const ev = (id, cls, pl) => ({
      kind: 'ev', id: id, source: P, cls: cls, ts: '2026-01-01T00:00:00Z',
      payload: JSON.stringify(pl), summary: '', status: '', dur: 0,
    });
    // A verdict and a tool result, and nothing that judged them.
    const md = PT.export.markdown([
      ev('p#1', 'TOOL', { stage: 'result', tool: 'calc', index: 0, ok: true, durationMs: 1 }),
      ev('p#9', 'VERDICT', { jobId: P, status: 'Met', checks: 0 }),
    ], null);
    const line = md.split('\n').find((l) => l.startsWith('- judged by:'));
    // Both the absence and the consequence have to be on the line.
    return !!line && /NOTHING/.test(line) && /UNVERIFIED/.test(line);
  })(),
  'the export must not print a conclusion without saying nothing judged it');

check('and a window that WAS judged states the count instead (control)',
  (function () {
    const md = PT.export.markdown(derivationFixture(), null);
    const line = md.split('\n').find((l) => l.startsWith('- judged by:'));
    // The fixture has exactly two check rows; anything else means the count is
    // being derived from something other than the checks themselves.
    return !!line && /judged by: 2 checks/.test(line) && !/NOTHING/.test(line);
  })(),
  'a judged window and an unjudged one must not read the same');

check('the distinction is not vacuous: both lines cannot appear (control)',
  (function () {
    const withTwo = PT.export.markdown(derivationFixture(), null)
      .split('\n').filter((l) => l.startsWith('- judged by:'));
    return withTwo.length === 1 && /UNVERIFIED/.test(withTwo[0]) === false;
  })(),
  'if both forms could appear the reader could not tell which applies');

/* ---- two indexes share one sign, and the document must say so -----------
 *
 * The `ref` column and an evidence citation both use `#`, for different keys:
 * `run#0` is the row's short id and points at a position in this document, while
 * `run-0212da5381eee6a3#0` is a job id and points at a tool result. A reader who
 * assumes one namespace points at the wrong line — which is exactly what an audit
 * cannot afford.
 *
 * The first assertion is the one that can go red: it fails if any row id is
 * shaped like an evidence citation (a `#` whose left side is a full job id), i.e.
 * if the two namespaces ever actually merge rather than merely sharing a sign.
 */
check('no row id is shaped like an evidence citation (namespaces stay separate)',
  (function () {
    const rows = derivationFixture().filter((r) => r.kind === 'ev');
    // Row ids in the fixture look like `p#5`; an evidence citation looks like
    // `<job id>#<n>`. The predicate is about SHAPE, so it also catches a future
    // change that starts emitting job-id-shaped row ids.
    return rows.every(function (r) {
      const left = String(r.id).split('#')[0];
      return !/^run-[0-9a-f]{6,}/.test(left);
    });
  })(),
  'a row id that starts with a job id cannot be told from a citation');

check('and the document states which namespace each sign belongs to (assertion)',
  (function () {
    const md = PT.export.markdown(derivationFixture(), null);
    return md.indexOf('`ref` is the row id') !== -1 &&
      md.indexOf('an evidence citation is a DIFFERENT key') !== -1;
  })(),
  'the reader must be told the two ids differ, since the document prints both');

check('the old claim that `ref` is `source#lineNo` is gone (control)',
  (function () {
    const md = PT.export.markdown(derivationFixture(), null);
    // That wording described a column this export does not emit; leaving it in
    // would be the declared-vs-actual slip the same file keeps recording.
    return md.indexOf('`source#lineNo`') === -1;
  })(),
  'a document may not describe its own column incorrectly');

/* ---- do the classes this page emits actually have styles?
 *
 * `renderCertificate` emitted seven class names and not one of them had a rule in
 * `prove_track.css`: the 推导 view drew as raw unstyled rows, and every check in
 * this file passed anyway, because they all asked about data or DOM and none
 * asked whether the thing had a look. A view whose markup is right and whose
 * styles are absent still renders — as a wall of text.
 *
 * The lesson generalises, so this check does too: it covers EVERY `e-` class the
 * page emits, from the markup and from the code that builds rows. Class names are
 * harvested from those sources and never hand-listed, because a hand-written copy
 * of "which classes exist" is exactly how the two halves drifted apart here.
 */
const CSS_PATH = path.join(A, 'prove_track.css');
const CSS_TEXT = fs.readFileSync(CSS_PATH, 'utf8');

/* Selectors are read from the text between rules, not line by line: this
 * stylesheet wraps selectors across lines, and the first version of this check
 * reported the styled `.e-cert-folded` as unstyled for that reason alone — a
 * check that lies in the safe direction is a check nobody ever notices. */
function selectorRules(css) {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const out = [];
  let i = 0;
  while (i < noComments.length) {
    const open = noComments.indexOf('{', i);
    if (open === -1) { break; }
    const close = noComments.indexOf('}', open);
    if (close === -1) { break; }
    const start = Math.max(noComments.lastIndexOf('}', open), noComments.lastIndexOf('{', open - 1));
    out.push(noComments.slice(start + 1, open));
    i = close + 1;
  }
  return out;
}
const CSS_RULES = selectorRules(CSS_TEXT);
/* The stylesheets that are not this file: base/tokens/components carry page-level
 * e- classes of their own, so a class defined there is styled, not missing. Only
 * their <style> bodies count — a class name mentioned in markup is not a rule,
 * and matching it as one is how the first version of this check passed `e-reply`
 * (which IS styled, in prove_track.css, though only ever as `tr.ev.e-reply`). */
function styleBlocks(html) {
  const out = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/g;
  let m;
  while ((m = re.exec(html))) { out.push(m[1]); }
  return out.join('\n');
}
const OTHER_CSS = fs.readdirSync(A)
  .filter(function (n) { return /\.html?$/.test(n); })
  .map(function (n) { return styleBlocks(fs.readFileSync(path.join(A, n), 'utf8')); })
  .join('\n');
const OTHER_RULES = selectorRules(OTHER_CSS);
/* Everything a rule in this page could come from — the corpus the controls below
 * strip from and re-read, so they test this check rather than half of it. */
const ALL_CSS = CSS_TEXT + '\n' + OTHER_CSS;

function isStyledIn(rules, cls) {
  const re = new RegExp('(^|[^a-zA-Z0-9_-])\\.' + cls.replace(/-/g, '\\-') + '([^a-zA-Z0-9_-]|$)');
  return rules.some(function (sel) { return re.test(sel); });
}
function isStyled(cls, rules) {
  const rs = rules || CSS_RULES.concat(OTHER_RULES);
  if (isStyledIn(rs, cls)) { return true; }
  /* A compound selector — `tr.ev.e-reply` — still styles the class, so look for
   * the class token anywhere in a selector, not only at its start. */
  const re = new RegExp('\\.' + cls.replace(/-/g, '\\-') + '(?![a-zA-Z0-9_-])');
  return isStyledIn(rs, cls) || rs.some(function (sel) { return re.test(sel); });
}

/* Every `e-` class the page can put on an element: literal class attributes in
 * the markup, `className = '…'` assignments (the cert row and its two cells), and
 * class-looking string literals in the scripts (table rows and turn headers are
 * built by concatenation, so the name never appears in a className assignment). */
function emittedClasses() {
  const out = {};
  const add = function (text, where) {
    text.split(/\s+/).forEach(function (c) {
      if (c.indexOf('e-') === 0 && /^e-[a-z0-9-]+$/.test(c)) {
        out[c] = out[c] || {};
        out[c][where] = true;
      }
    });
  };
  fs.readdirSync(A).forEach(function (n) {
    const full = path.join(A, n);
    const text = fs.readFileSync(full, 'utf8');
    let m;
    if (/\.html?$/.test(n)) {
      const re = /class="([^"]+)"/g;
      while ((m = re.exec(text))) { add(m[1], n); }
    } else if (/\.js$/.test(n)) {
      const re1 = /className\s*=\s*'([^']+)'/g;
      while ((m = re1.exec(text))) { add(m[1], n); }
      const re2 = /'((?:e-)[a-z0-9-]+)'/g;
      while ((m = re2.exec(text))) { add(m[1], n); }
    }
  });
  return out;
}

const EMITTED = emittedClasses();
const EMITTED_NAMES = Object.keys(EMITTED).sort();

/* Classes that intentionally carry no rule of their own. The bar for entry is
 * named in the reason: a plain grouping container whose children are the styled
 * ones, or an element styled inline in the markup it is declared in. "Nobody got
 * round to it" is not a reason, and the certificate's seven would all fail it. */
const STYLELESS_BY_DESIGN = [
  { cls: 'e-sr', why: 'visually-hidden caption, styled inline where it is declared (clip-rect pattern)' }
].reduce(function (a, e) { a[e.cls] = e.why; return a; }, {});

check('every e- class the page emits was found by this check (control)',
  EMITTED_NAMES.length >= 40 && EMITTED_NAMES.indexOf('e-cert-row') !== -1 &&
    EMITTED_NAMES.indexOf('e-trk') !== -1,
  'harvested ' + EMITTED_NAMES.length + ' classes; a harvest that finds nothing passes everything');

check('every e- class the page emits has a rule, or is styleless by design',
  EMITTED_NAMES.every(function (c) {
    return isStyled(c) || Object.prototype.hasOwnProperty.call(STYLELESS_BY_DESIGN, c);
  }),
  'unstyled and not declared: ' + EMITTED_NAMES.filter(function (c) {
    return !isStyled(c) && !Object.prototype.hasOwnProperty.call(STYLELESS_BY_DESIGN, c);
  }).join(', '));

/* The certificate is the reason this check exists, so it gets the strict form:
 * no allowance, since every one of its classes carries meaning a reader needs. */
const CERT_CLASSES = EMITTED_NAMES.filter(function (c) { return c.indexOf('e-cert') === 0; });
check('the certificate gets no styleless allowance at all',
  CERT_CLASSES.length >= 5 && CERT_CLASSES.every(function (c) { return isStyled(c); }),
  'unstyled certificate classes: ' + CERT_CLASSES.filter(function (c) { return !isStyled(c); }).join(', '));

/* And the whole thing must be able to fail: with every certificate rule stripped
 * the check has to report them unstyled, which is the exact state the file was in
 * before this layer existed. */
check('stripping the certificate rules makes this check report them (control)',
  (function () {
    /* Strip from the corpus AND re-run the whole reader over it, exactly as the
       assertion above does — otherwise this control tests a variable, not the
       check, and passes while the real check has stopped reading anything. */
    /* `\b`, not `[a-z-]+`: the bare class `.e-cert` has no letter after the
       hyphen, so the first version of this strip left its rule in place and the
       control passed while one certificate class was still styled. The regex now
       covers every `.e-cert…` form, next to a boundary or not. */
    const strippedRules = selectorRules(ALL_CSS.replace(/\.e-cert\b/g, '.gone'));
    return CERT_CLASSES.length >= 5 && CERT_CLASSES.every(function (c) {
      return !isStyled(c, strippedRules);
    });
  })(),
  'this is the state prove_track.css was in before the certificate layer was added');

/* ---- "有几条判断" 与 "有没有结论" 是两件事 --------------------------------
 *
 * 曾经的判定键在 `totals.checks` 上，于是同一个视图会说两句互相矛盾的话：
 * 选了周期、结论已记录，但窗口里没有判断行时，头部写 `no conclusion to read yet`，
 * 而同一张证书里正显示着结论（真浏览器实测那次是 `Met`）。
 *
 * 这条断言把三种状态钉死，并同时给出反向控制——只查"有结论时显示结论"是不够的，
 * 因为把判断数当成结论的开关恰好在那一种情形下看不出来。 */
function verdictOnlyFixture() {
  const ev = (id, cls, payload) => ({
    kind: 'ev', id: id, source: DERIV_PERIOD, turn: 't1', ord: 1,
    ts: '2026-09-07T18:17:00Z', cls: cls, lane: 'x', dur: 0, status: 'done',
    summary: cls + ' ' + id, tool: null, kindNote: '',
    fields: [], payload: JSON.stringify(payload), detail: '', term: false,
  });
  return [ev('p#9', 'VERDICT', { jobId: DERIV_PERIOD, status: 'Met', checks: 0, reason: 'all checks passed' })];
}
const CERT_HEAD = ['e-cert-verdict', 'e-cert-note'];

function headShape(session) {
  const st = PT.export.certificateState(PT.export.derivation(session));
  const hasVerdict = !!st.verdict;
  const checks = st.totals.checks;
  /* 与 view 的分支同构：结论存在则必出结论行；判断数为 0 时另加一行说明。 */
  return {
    verdict: hasVerdict, checks,
    rows: (hasVerdict ? ['verdict'] : []).concat(checks ? [] : ['note']),
    contradicts: hasVerdict && !checks,
  };
}

check('a recorded conclusion is shown even when nothing was judged (the fix)',
  (function () {
    const h = headShape(verdictOnlyFixture());
    // 修好之前这里就是那句自相矛盾：有结论却被写成"暂无结论"。
    return h.verdict === true && h.checks === 0 && h.rows.indexOf('verdict') > -1;
  })(),
  'a conclusion with no judgement rows must still be drawn as the conclusion');

check('and the reason it needed fixing is that the two facts can disagree (control)',
  (function () {
    const onlyVerdict = headShape(verdictOnlyFixture());
    const both = headShape(derivationFixture());          // 结论 + 判断都有
    const neither = headShape([]);                        // 既无结论也无判断
    return onlyVerdict.contradicts === true &&
      both.verdict === true && both.checks > 0 &&
      neither.verdict === false && neither.checks === 0 &&
      neither.rows.join() === 'note';
  })(),
  'three states, and the old branch would have shown a note INSTEAD of the conclusion in the first');

check('certificateState tolerates no session at all (control)',
  (function () {
    /* 上一条断言用的是"有结论"的夹具；没有它，一个只会读结论的实现看起来也全绿。
     * 这里确认空输入确实读到"没有结论"，而且不抛错。 */
    const st = PT.export.certificateState(PT.export.derivation(null));
    return st.verdict === null && st.totals.checks === 0 && st.totals.dangling === 0;
  })(),
  'a session-less call must yield an empty reading rather than an exception');

/* ---- 一个字段，两套词汇：attempt 的文本改变后，消费者必须同时读懂两边 -------
 *
 * K-116 把 `assistant/attempt` 的 text 从"模型原始输出"改成"尝试了什么"
 * （`planned calls: a/b` / `no calls planned — answered directly`）。摘要模板原本
 * 只会解析原始 JSON 取工具名，于是新语义一来就会被印成
 * `reply: planned calls: weather` —— 工具名还在，却被归到了错的那个词下面。
 * 导出读的是**改动两侧**写下的文件，旧的那批并不错，只是更旧。
 */
{
  /* 走真实路径：事件载荷 → `payloadOf` 投影 → `summarize` 摘要。
   * 直接手搓一个会话行会在 kind 上失配而回退成 "ev"，那是夹具的错、不是被测物的错。 */
  const PLAN = window.CxEventFamily.KINDS.PLAN;
  const summarize = (text) => {
    const node = { kind: PLAN, payload: { text: text, empty: false },
      source: 'run-x', node: 'run-x#5', turn: 't1', ord: 5, ts: '2026-09-22T02:09:51Z' };
    const projected = JSON.parse(PT.node.payloadOf(node));
    return PT.render.summarize({ ...node, payload: projected });
  };

  check('a new-vocabulary attempt keeps its own words (planned call)',
    summarize('planned calls: weather') === 'planned calls: weather',
    JSON.stringify(summarize('planned calls: weather')));

  check('and a tool-free attempt is not relabelled as a reply (control)',
    summarize('no calls planned — answered directly') === 'no calls planned — answered directly',
    'the old formatter printed "reply: no calls planned — answered directly"');

  check('an unreadable plan is passed through, not dressed up',
    summarize('unparseable plan') === 'unparseable plan',
    JSON.stringify(summarize('unparseable plan')));

  check('an OLD raw-output attempt still yields its tool names',
    summarize('{"calls":[{"tool":"calc"},{"tool":"weather"}]}') === 'planned calls: calc, weather',
    'older events are not wrong, just older; both vocabularies must read correctly');

  check('free prose still reads as a reply, which is what it is (control)',
    summarize('这是一段没有计划的直接回答') === 'reply: 这是一段没有计划的直接回答',
    JSON.stringify(summarize('这是一段没有计划的直接回答')));
}

process.exit(failures === 0 ? 0 : 1);

