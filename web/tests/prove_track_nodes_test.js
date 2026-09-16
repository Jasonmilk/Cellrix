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
 * So: run the real 10-period chain through the tape, take the snapshot's nodes,
 * and require that the Node-side consumption layer handles all of them — and
 * that the defects the comparison found cannot come back.
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
  const jobId = name.slice(0, -'.events.jsonl'.length);
  const rows = fs.readFileSync(path.join(EV, name), 'utf8').trim()
    .split('\n').filter(Boolean).map(JSON.parse);
  if (!rows.length) { return; }
  byJob[jobId] = rows;
  let parent = null;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].type === 'context/inject') {
      parent = (rows[i].data || {}).resume_from || null;
      break;
    }
  }
  periods.push({ job_id: jobId, parent: parent, first_ts: rows[0].time || '' });
});

const ids = NORM.chainJobIds(periods, 'run-9e901b965a772d51');
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

  /* 3. The context row lost the node hits it was given. */
  const ctxNode = snap.nodes.filter(function (n) { return n.kind === 'context'; })[0];
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
process.exit(failures === 0 ? 0 : 1);
