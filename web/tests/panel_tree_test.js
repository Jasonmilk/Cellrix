/* panel_tree_test — the DAG navigation core (ADR-0048 §227).
 * The criterion that matters: the tree's EDGES are exactly the non-null parents (one fact, one
 * host), the ancestor closure is structural, and an unknown run mode is a NAMED absence.
 */
/* Machine-readable requirement (§203): the DOM section needs jsdom. */
const REQUIRES = 'jsdom';

const fs = require('fs'), path = require('path'), vm = require('vm');
let bad = 0;
/* Deferred assertions (promise microtasks settle after the DOM block closes). */
const asyncCases = [];
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };

const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'panel_tree.js'), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const PT = sandbox.window.CxPanelTree;
ok(!!PT, 'panel_tree.js loads and exports CxPanelTree');

/* fixture: one root, a linear run, and a fork with two children */
const PERIODS = [
  { period_id: 'r', parent: null, name: 'root', mode: 'Partner' },
  { period_id: 'a', parent: 'r', name: 'a' },
  { period_id: 'b', parent: 'a', name: 'b' },
  { period_id: 'c', parent: 'a', name: 'c-fork' },
  { period_id: 'd', parent: 'c', name: 'd' },
  { period_id: 'x', parent: 'ghost', name: 'truncated' }
];
const t = PT.buildTree(PERIODS);
const nonNullParents = PERIODS.filter((p) => p.parent).length;
ok(t.edges.length === nonNullParents,
  'EDGES == non-null parents (' + t.edges.length + ' == ' + nonNullParents + ') — one fact, one host');
ok(t.roots.length === 1 && t.roots[0] === 'r', 'exactly one root  [' + JSON.stringify(t.roots) + ']');
ok(t.byId.a.children.join(',') === 'b,c', 'the fork has two children (a ⇒ b,c)');
ok(t.byId.x.truncated === 'ghost',
  'a parent outside the list is a TRUNCATED walk, not a second root (declared)');

const cl = PT.ancestorClosure(t, 'd');
ok(cl.path.join('>') === 'r>a>c>d', 'ancestor closure is the single root path, root-first  [' + cl.path.join('>') + ']');
ok(cl.truncated === null && cl.cycle === false, 'and it is neither truncated nor cyclic');
const clX = PT.ancestorClosure(t, 'x');
ok(clX.truncated === 'ghost', 'the truncated node DECLARES its missing ancestor  [' + clX.truncated + ']');

const sel = PT.selection(t, 'a');
ok(sel.kind === 'node' && sel.children.join(',') === 'b,c',
  'a selection shows its own children only — never the whole graph');
ok(sel.rows === null, 'and its rows are NOT pulled until the reader selects it (on demand)');
ok(PT.selection(t, 'nope').kind === 'missing', 'selecting an unknown id is a named state');

/* ── the run modes: three declared, and absence is NAMED ── */
ok(PT.modeFacts('Drive').label.indexOf('harness') >= 0, 'Drive ⇒ Anaphase Only (harness)');
ok(PT.modeFacts('Partner').writesExperience === true, 'Partner ⇒ memory-bearing (writes experience)');
const sv = PT.modeFacts('Survive');
ok(sv.kind === 'declared' && sv.implemented === false && /保留|未实现/.test(sv.note || ''),
  'Survive ⇒ DECLARED but unimplemented (enum reserved): ' + sv.note);
const un = PT.modeFacts(undefined);
ok(un.kind === 'undeclared' && un.label === '模式未声明' && un.note.indexOf('do not read this as mode') >= 0,
  'an absent mode is a NAMED absence, never a blank and never a default');
ok(PT.modeFacts('Nonsense').kind === 'undeclared', 'a made-up mode is undeclared, not silently accepted');

/* MUTATION: claiming an edge that no parent justifies must be visible to this criterion */
const broken = PT.buildTree(PERIODS.concat([{ period_id: 'z', parent: null }]));
ok(broken.edges.length === nonNullParents && broken.roots.length === 2,
  'MUTATION scope: adding a root changes roots, not edges — so the edge equality is about parents');

/* ── DOM: overview first, details ON DEMAND (§227 / Shneiderman) ── */
{
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch (e) { console.log('NEEDS-INPUT: jsdom not installed'); process.exit(3); }
  const dom = new JSDOM('<!doctype html><div id="host"></div>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(fs.readFileSync(path.join(__dirname, '..', 'assets', 'panel_tree.js'), 'utf8'));
  const T = w.CxPanelTree;
  const host = w.document.getElementById('host');
  let calls = [];
  const view = T.render(host, PERIODS, { fetchRows: (id) => { calls.push(id); return [{ step: 1 }]; } });

  ok(host.querySelectorAll('.pt-node').length === PERIODS.filter((p) => p.period_id).length,
    'overview: one row per period (' + host.querySelectorAll('.pt-node').length + ')');
  ok(calls.length === 0, 'ON DEMAND: rendering the overview fetches NO period rows');
  ok(host.querySelector('[data-period="d"]').getAttribute('data-depth') === '3',
    'depth comes from the structural closure (d is 3 levels below the root)');
  ok(host.querySelector('[data-period="x"]').getAttribute('data-truncated') === 'ghost',
    'a truncated lineage is marked on the row itself (declared, not hidden)');

  host.querySelector('[data-period="d"]').dispatchEvent(new w.Event('click'));
  ok(calls.length === 1 && calls[0] === 'd', 'ONE click ⇒ ONE fetch, for that period only  [' + calls + ']');
  ok(host.querySelector('.pt-context').getAttribute('data-path') === 'r>a>c>d',
    'the detail shows the ancestor chain (how this experience came to be)');
  ok(host.querySelector('.pt-mode').getAttribute('data-mode-kind') === 'undeclared',
    'a period with no run mode says UNDECLARED — never a blank, never a default');
  ok(host.querySelector('[aria-selected="true"]').getAttribute('data-period') === 'd',
    'the selected node is marked for assistive tech as well as visually');

  const host2 = w.document.createElement('div');
  w.document.body.appendChild(host2);
  T.render(host2, [{ period_id: 'p1', parent: null, name: 'one', mode: 'Survive' }], { selected: 'p1' });
  ok(host2.querySelector('.pt-mode').textContent.indexOf('reserved') >= 0
    || host2.querySelector('.pt-mode').textContent.indexOf('\u4fdd\u7559') >= 0,
    'mode ③ renders as DECLARED BUT UNIMPLEMENTED: ' + host2.querySelector('.pt-mode').textContent);

  /* MUTATION: if the renderer fetched every period up front, the "no calls" assertion must break. */
  let calls2 = [];
  const host3 = w.document.createElement('div');
  w.document.body.appendChild(host3);
  const v3 = T.render(host3, PERIODS, { fetchRows: (id) => { calls2.push(id); return []; } });
  PERIODS.forEach((p) => { try { v3.select(p.period_id); } catch (e) { /* named miss */ } });
  ok(calls2.length === PERIODS.length,
    'MUTATION scope: selecting every node DOES fetch every period — so the lazy assertion is real');

  /* ASYNC rows: the real loader is a fetch, so pending/count/error must be three names. */
  {
    const host4 = w.document.createElement('div');
    w.document.body.appendChild(host4);
    let resolveIt;
    const p4 = new w.Promise(function (res) { resolveIt = res; });
    T.render(host4, [{ period_id: 'q1', parent: null, name: 'q' }],
      { selected: 'q1', fetchRows: function () { return p4; } });
    const box4 = host4.querySelector('.pt-rows');
    ok(box4.getAttribute('data-count') === 'pending',
      'ASYNC: while the fetch travels the state is NAMED `pending` (not 0, not blank)');
    resolveIt([{ a: 1 }, { a: 2 }]);
  }
  {
    const host5 = w.document.createElement('div');
    w.document.body.appendChild(host5);
    const rejected = w.Promise.reject(new Error('boom'));
    T.render(host5, [{ period_id: 'q2', parent: null, name: 'q2' }],
      { selected: 'q2', fetchRows: function () { return rejected; } });
    const box5 = host5.querySelector('.pt-rows');
    /* CAPTURE AT SETTLE TIME, not after `window.close()`: reading a closed document throws, and a
     * criterion that throws is a red that carries no information about what it named. */
    let settled = null;
    rejected.catch(function () {
      settled = box5.getAttribute('data-count') + ' / ' + (box5.getAttribute('data-error') || '');
    });
    asyncCases.push(function () {
      ok(settled !== null && settled.indexOf('error') === 0 && /boom/.test(settled),
        'ASYNC: a FAILED fetch is a NAMED `error` with its reason — never a silent blank  [' + settled + ']');
    });
  }
  /* MUTATION: a synchronous loader must still produce a COUNT — the async branch is not the only one. */
  {
    const host6 = w.document.createElement('div');
    w.document.body.appendChild(host6);
    T.render(host6, [{ period_id: 'q3', parent: null, name: 'q3' }],
      { selected: 'q3', fetchRows: function () { return [{ a: 1 }]; } });
    ok(host6.querySelector('.pt-rows').getAttribute('data-count') === '1',
      'MUTATION scope: a synchronous loader still yields a count (so the async assertions are about async)');
  }

  dom.window.close();
}

/* ── OPTION A: a CLICK navigates; opening the panel does not (P1-1a) ── */
{
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch (e) { console.log('NEEDS-INPUT: jsdom not installed'); process.exit(3); }
  const dom = new JSDOM('<!doctype html><div id="host"></div>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(fs.readFileSync(path.join(__dirname, '..', 'assets', 'panel_tree.js'), 'utf8'));
  const T = w.CxPanelTree;
  const host = w.document.getElementById('host');
  const seen = [];
  T.render(host, PERIODS, { onSelect: function (id) { seen.push(id); } });
  ok(seen.length === 0,
    'opening the panel does NOT navigate (the markup keeps its own default view)');
  host.querySelector('[data-period="c"]').dispatchEvent(new w.Event('click'));
  ok(seen.length === 1 && seen[0] === 'c',
    'ONE click ⇒ ONE navigation signal, carrying that period  [' + seen + ']');
  host.querySelector('[data-period="c"]').dispatchEvent(new w.Event('click'));
  ok(seen.length === 2, 'each click signals again (the signal is per interaction, not cached)');

  /* MUTATION: without the callback the click must still select locally — the two are separate facts. */
  const host2 = w.document.createElement('div');
  w.document.body.appendChild(host2);
  T.render(host2, PERIODS, {});
  host2.querySelector('[data-period="a"]').dispatchEvent(new w.Event('click'));
  ok(host2.querySelector('[aria-selected="true"]').getAttribute('data-period') === 'a',
    'MUTATION scope: selection happens even with no onSelect — navigation and selection are distinct');
  dom.window.close();
}

/* ── WIRING CONTRACT (P1-1b): the sidebar binds the period into the view's OWN declared input ──
 * This is a CONTRACT assertion, not a behaviour proof: it checks that the wiring passes the period
 * to the shell's single writer. The end-to-end behaviour (the view then showing THAT period) needs
 * the live panel and is the acceptance for this node, verified separately. */
{
  const wiring = fs.readFileSync(path.join(__dirname, '..', 'assets', 'session_list.js'), 'utf8');
  ok(/setNav\(\{[^}]*view:[^}]*period:/.test(wiring),
    'the click wiring passes BOTH the view and the period to the shell single writer');
  ok(/Cx\.state\.nav\.period/.test(fs.readFileSync(path.join(__dirname, '..', 'assets', 'prove_track.js'), 'utf8')),
    'and the consumer of that input existed BEFORE the writer (no zero-consumer field)');
  ok(wiring.indexOf("showView('prove-track')") < 0,
    'MUTATION scope: switching the view WITHOUT the period is gone (that was the half-truth)');
}

/* ── ROOTS ARE THE SIDEBAR'S ENTRY SET (ADR-0048 §240): opt-in, so nothing old changes ── */
{
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch (e) { console.log('NEEDS-INPUT: jsdom not installed'); process.exit(3); }
  const dom = new JSDOM('<!doctype html><div id="s-side"><div class="legacy">flat cards</div></div>',
    { runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(fs.readFileSync(path.join(__dirname, '..', 'assets', 'panel_tree.js'), 'utf8'));
  const T = w.CxPanelTree;
  const P = [
    { period_id: 'r1', parent: null, job_id: 'j1' },
    { period_id: 'r1a', parent: 'r1', job_id: 'j1' },
    { period_id: 'r1b', parent: 'r1', job_id: 'j1' },
    { period_id: 'r2', parent: null, job_id: 'j2' },
    { period_id: 'r3', parent: null, job_id: 'j3' }
  ];
  const host = w.document.getElementById('s-side');
  T.mountSidebar(P, {});
  const rows = host.querySelectorAll('.pt-node');
  ok(rows.length === 3, 'THE SIDEBAR LISTS THE ROOTS: 3 rows for 5 periods  [' + rows.length + ']');
  ok(rows.length !== P.length, 'MUTATION scope: listing every period would be ' + P.length + ' rows');
  ok(host.querySelector('[data-period="r1"]').getAttribute('data-descendants') === '3',
    'a root states how much lives under it (3 = itself + two continuations)');
  ok(host.querySelectorAll('.pt-node[data-period="r1a"]').length === 0,
    'a continuation is NOT a top-level card (the "many duplicates" the owner saw)');
  /* §242: a header that does not map to a conversation is noise — measured 9 headers for 13 jobs. */
  ok(host.querySelectorAll('.pt-group').length === 0,
    'roots-only list has NO group headers (the root IS the entry)  [' + host.querySelectorAll('.pt-group').length + ']');
  ok(host.querySelector('[data-period="r1"]').getAttribute('data-descendants') === '3',
    'and each root still states its own size, which is the fact a header was trying to carry');
  /* RESTORED CO-EXISTENCE (§267): the tree does NOT remove the host's rows — the card list stays
   * clickable (100% of rounds reachable) while the tree adds the conversation view. */
  ok(host.querySelector('.legacy') !== null,
    'the tree leaves the sidebar card list ALONE (co-existence, not replacement)');
  /* The generic contract is unchanged: `render` still draws every node unless asked otherwise. */
  const h2 = w.document.createElement('div');
  w.document.body.appendChild(h2);
  T.render(h2, P, {});
  ok(h2.querySelectorAll('.pt-node').length === P.length,
    'MUTATION guard: `render` without the option still draws EVERY node (' + h2.querySelectorAll('.pt-node').length + ')');
  const h3 = w.document.createElement('div');
  w.document.body.appendChild(h3);
  T.render(h3, P, { rootsOnly: true });
  ok(h3.querySelectorAll('.pt-node').length === 3, 'and with `rootsOnly:true` exactly the roots');
  dom.window.close();
}

/* ── THE STEP BOUNDARY (ADR-0048 §239): one turn, several steps, each shown as itself ──
 * An Agent Loop runs N steps inside ONE turn. The acceptance is not "the turn has a token total" but
 * "each step is visible as its own row, with its OWN model and its OWN tokens" — a single mixed row
 * would satisfy every total and still lose the pairing (§190/§213). */
{
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch (e) { console.log('NEEDS-INPUT: jsdom not installed'); process.exit(3); }
  const dom = new JSDOM('<!doctype html><div id="steps"></div>', { runScripts: 'outside-only' });
  const w = dom.window;
  const A = (f) => fs.readFileSync(path.join(__dirname, '..', 'assets', f), 'utf8');
  w.eval(A('three_state.js'));
  w.eval(A('cell_metering.js'));
  w.eval(A('panel_tree.js'));
  const T = w.CxPanelTree;
  /* The Loop's real shape: one turn, three steps, three models, three token counts. */
  const EV = [
    { kind: 'assistant/usage', data: { completion_tokens: 20, model: 'planner-strong' }, seq: 1 },
    { kind: 'assistant/usage', data: { completion_tokens: 7, model: 'executor-cheap' }, seq: 2 },
    { kind: 'assistant/usage', data: { completion_tokens: 11, model: 'executor-cheap' }, seq: 3 }
  ];
  const host = w.document.getElementById('steps');
  T.renderRows(host, EV);
  const rows = host.querySelectorAll('.pt-step');
  ok(rows.length === EV.length, 'ONE ROW PER STEP, not one row per turn  [' + rows.length + ']');
  const steps = Array.prototype.map.call(rows, (r) => r.getAttribute('data-step'));
  ok(steps.join(',') === '1,2,3', 'and they are numbered in order  [' + steps.join(',') + ']');
  const toks = Array.prototype.map.call(rows, (r) => r.querySelector('.pt-tok').textContent);
  ok(toks.join(',') === '20,7,11',
    'EACH STEP SHOWS ITS OWN TOKENS (a mixed row would pass every total and lose the pairing)  [' + toks.join(',') + ']');
  const models = Array.prototype.map.call(rows, (r) => (r.querySelector('.pt-model') || {}).textContent);
  ok(models.join(',') === 'planner-strong,executor-cheap,executor-cheap',
    'and each step names its own model  [' + models.join(',') + ']');
  ok(rows[0].querySelector('.pt-tok').getAttribute('data-state') === 'p'
    && rows[0].querySelector('.pt-tok').getAttribute('data-state') === 'p',
    'three measured steps stay three measured states (no collapse to a summary)');
  dom.window.close();
}

/* ── THE MARKER MUST LAND ON A RENDERED ROW (ADR-0048 §249) ──
 * Measured live: the newest period can be a continuation while the entry set is the roots, so the
 * default selection marked NOTHING (`[0 marked]`) and the detail described a node the list lacked. */
{
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch (e) { console.log('NEEDS-INPUT: jsdom not installed'); process.exit(3); }
  const dom = new JSDOM('<!doctype html><div id="s-side"></div>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(fs.readFileSync(path.join(__dirname, '..', 'assets', 'panel_tree.js'), 'utf8'));
  const P3 = [
    { period_id: 'newest-continuation', parent: 'root-1', job_id: 'run-a' },  /* newest-first payload */
    { period_id: 'root-1', parent: null, job_id: 'run-a' },
    { period_id: 'root-2', parent: null, job_id: 'run-b' }
  ];
  const host = w.document.getElementById('s-side');
  w.CxPanelTree.mountSidebar(P3, {});
  const marked = host.querySelectorAll('.ses-item[aria-current="true"]');
  ok(marked.length === 1, 'exactly ONE rendered row carries aria-current at load  [' + marked.length + ']');
  ok(marked.length === 1 && marked[0].getAttribute('data-period') === 'root-1',
    'and it is the ROOT of the newest continuation — a row that is actually rendered  ['
    + (marked[0] && marked[0].getAttribute('data-period')) + ']');
  const naive = host.querySelectorAll('.ses-item[data-period="newest-continuation"]');
  ok(naive.length === 0 && marked.length === 1,
    'MUTATION: the naive default (newest period) would give 0 marked rows here');
  dom.window.close();
}

/* ── THE SELECTION CONTRACT IS INHERITED (ADR-0048 §247) ──
 * The app drives this sidebar through `#s-side .ses-item` + `data-job` (all_views_test.js:488).
 * A replacement that carries only its OWN names satisfies its own tests and removes the app's only way
 * to pick a period — measured live as "sidebar rows available to drive prove-track [0 rows]". */
{
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch (e) { console.log('NEEDS-INPUT: jsdom not installed'); process.exit(3); }
  const dom = new JSDOM('<!doctype html><div id="s-side"></div>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(fs.readFileSync(path.join(__dirname, '..', 'assets', 'panel_tree.js'), 'utf8'));
  const P2 = [
    { period_id: 'run-a-p1', parent: null, job_id: 'run-a' },
    { period_id: 'run-b-p1', parent: null, job_id: 'run-b' }
  ];
  const host = w.document.getElementById('s-side');
  w.CxPanelTree.mountSidebar(P2, {});
  const drivable = host.querySelectorAll('.ses-item');
  ok(drivable.length === 2, 'every tree row is drivable through the APP contract (#s-side .ses-item)  ['
    + drivable.length + ']');
  ok(host.querySelector('.ses-item').getAttribute('data-job') === 'run-a-p1',
    'and it carries data-job = period_id, the identity the legacy card carried');
  ok(host.querySelectorAll('.pt-node').length === 2,
    'while keeping this module own name, so its own criteria keep working');
  const renamed = host.querySelectorAll('.pt-row-instead');
  ok(renamed.length === 0 && drivable.length > 0,
    'MUTATION: a row carrying only an invented name would give 0 drivable rows here');
  dom.window.close();
}

/* ── CONVERSATIONS OVER PERIODS (ADR-0048 §238) ── */
{
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch (e) { console.log('NEEDS-INPUT: jsdom not installed'); process.exit(3); }
  const dom = new JSDOM('<!doctype html><div id="host"></div>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(fs.readFileSync(path.join(__dirname, '..', 'assets', 'panel_tree.js'), 'utf8'));
  const T = w.CxPanelTree;
  /* The SHAPE is the live one: one job carrying several periods, ids run-<job>-p<period>. */
  const P = [];
  [['j1', 4], ['j2', 3], ['j3', 1]].forEach(([job, n]) => {
    for (let i = 0; i < n; i++) {
      P.push({ period_id: 'run-' + job + '-p' + i, job_id: 'run-' + job, parent: i === 0 ? null : 'run-' + job + '-p' + (i - 1),
        first_ts: '2026-09-28T14:0' + i + ':00Z', last_ts: '2026-09-28T14:0' + i + ':10Z', reply: i === 0 ? 'ok' : '' });
    }
  });
  const groups = T.groupByConversation(P);
  ok(groups.length === 3, 'THREE conversations, not eight periods  [' + groups.length + ']');
  ok(groups.reduce((a, g) => a + g.count, 0) === P.length,
    'and the children add up to every period (bidirectional: ' + groups.map((g) => g.count).join('+') + ')');
  ok(groups.every((g) => /with reply/.test(g.label)),
    'every group states a DISTINGUISHING fact: ' + groups.map((g) => g.label).join(' | '));
  ok(new Set(groups.map((g) => g.label)).size === 3, 'no two group labels are identical');

  const host = w.document.getElementById('host');
  T.render(host, P, {});
  const heads = host.querySelectorAll('.pt-group');
  const rows = host.querySelectorAll('.pt-node');
  ok(heads.length === 3, 'the sidebar renders 3 conversation headers  [' + heads.length + ']');
  ok(rows.length === P.length, 'and every period as a child  [' + rows.length + ']');
  ok(host.querySelector('.pt-group').getAttribute('data-count') === '4',
    'each header carries its own size (the fact that makes neighbours distinguishable)');
  const kids = Array.prototype.filter.call(rows, (r) => r.getAttribute('data-conversation') === 'run-j1');
  ok(kids.length === 4, 'children are attributed to their conversation  [' + kids.length + ']');
  dom.window.close();
}

/* ── THE REPLY'S THREE STATES (ADR-0048 §237): measured 18 of 52 live cards carry reply:"" ── */
{
  const T2 = (function () {
    const vm2 = require('vm');
    const sb = { window: {} };
    vm2.createContext(sb);
    vm2.runInContext(fs.readFileSync(path.join(__dirname, '..', 'assets', 'panel_tree.js'), 'utf8'), sb);
    return sb.window.CxPanelTree;
  })();
  const present = T2.replyState('pong', 'agnes-3.0-flash');
  const empty = T2.replyState('', null);
  const absent = T2.replyState(undefined, null);
  ok(present.kind === 'present' && present.label === null, 'a real reply is `present` with no label');
  ok(empty.kind === 'empty' && /\u65e0\u4ea7\u51fa/.test(empty.label) && /\u6a21\u578b\u672a\u62a5/.test(empty.label),
    'an EMPTY reply is a NAMED state that carries the model fact: ' + empty.label);
  ok(absent.kind === 'absent' && absent.label === '\u00b7 \u65e0\u6570\u636e',
    'an ABSENT field is the other named state: ' + absent.label);
  ok(new Set([present.kind, empty.kind, absent.kind]).size === 3,
    'THREE kinds stay three (mutation: merging empty into absent makes this 2 and fails)');
  ok(T2.replyState('   ', 'm').kind === 'empty', 'whitespace counts as empty, not as a reply');
  ok(T2.replyState('', 'agnes-3.0-flash').label === '\u672c\u8f6e\u65e0\u4ea7\u51fa',
    'when the model IS reported, the label does not claim it was not');
}

/* ── ALIVE: a refresh updates in place, it does not rebuild (owner's requirement) ── */
{
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch (e) { console.log('NEEDS-INPUT: jsdom not installed'); process.exit(3); }
  const dom = new JSDOM('<!doctype html><div id="live"></div>', { runScripts: 'outside-only' });
  const w = dom.window;
  const A = (f) => fs.readFileSync(path.join(__dirname, '..', 'assets', f), 'utf8');
  w.eval(A('three_state.js'));
  w.eval(A('cell_metering.js'));
  w.eval(A('panel_tree.js'));
  const T = w.CxPanelTree;
  const host = w.document.getElementById('live');

  const v1 = [
    { kind: 'assistant/usage', data: { completion_tokens: 20, duration_ms: 7, model: 'planner' } },
    { kind: 'assistant/usage', data: { prompt_tokens: 5, completion_tokens: null } }
  ];
  T.renderRows(host, v1);
  const firstRow = host.querySelector('.pt-step');
  firstRow.__sentinel = 'kept';           /* a stand-in for focus / scroll / transient UI state */

  const v2 = v1.concat([{ kind: 'tool/result', data: { duration_ms: 3, model: 'executor' } }]);
  T.renderRows(host, v2);
  const rowsNow = host.querySelectorAll('.pt-step');
  ok(rowsNow.length === 3, 'a refresh ADDS the new step (' + rowsNow.length + ' rows)');
  ok(rowsNow[0] === firstRow && firstRow.__sentinel === 'kept',
    'ALIVE: the first row is the SAME DOM NODE after a refresh (identity preserved)');
  ok(rowsNow[0].querySelector('.pt-tok').textContent === '20',
    'and its value is updated in place, not re-created');

  T.renderRows(host, v1);
  ok(host.querySelectorAll('.pt-step').length === 2,
    'a refresh that SHRANK removes the surplus row from the end');
  ok(host.querySelector('.pt-step') === firstRow && firstRow.__sentinel === 'kept',
    'MUTATION scope: a wholesale rebuild would have destroyed the sentinel (caught above)');

  /* Absence must not leave a stale value behind. */
  T.renderRows(host, [{ kind: 'assistant/usage', data: { completion_tokens: 5, model: 'planner' } }]);
  T.renderRows(host, [{ kind: 'assistant/usage', data: { completion_tokens: 5 } }]);
  ok(host.querySelectorAll('.pt-model').length === 0,
    'a model that stops being declared STOPS being shown (no stale cell)');
  dom.window.close();
}

/* ── MOUNT: one default detail, fetched exactly once (P0-2g) ── */
{
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch (e) { console.log('NEEDS-INPUT: jsdom not installed'); process.exit(3); }
  const dom = new JSDOM('<!doctype html><div id="s-side"></div>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(fs.readFileSync(path.join(__dirname, '..', 'assets', 'panel_tree.js'), 'utf8'));
  const T = w.CxPanelTree;
  const calls = [];
  T.mountSidebar(PERIODS, { fetchRows: function (id) { calls.push(id); return []; } });
  const box = w.document.querySelector('[data-panel-tree]');
  ok(!!box, 'the mount creates its OWN container under the host (the list is untouched)');
  ok(calls.length === 1, 'opening the panel fetches detail for EXACTLY ONE period  [' + calls + ']');
  const selected = box.querySelector('[aria-selected="true"]');
  ok(!!selected && selected.getAttribute('data-period') === PERIODS[0].period_id,
    'and the default selection is the newest experience  [' + (selected && selected.getAttribute('data-period')) + ']');
  /* SEMANTICS UPDATED WITH THE CODE (§240.3 ⑤): the SIDEBAR's entry set is the forest's ROOTS —
   * the full DAG is still one call away (`render(..., {rootsOnly:false})`), and that is asserted in
   * the block below. Exactly ONE assertion moved, because the change was confined to ONE caller. */
  const rootCount = PERIODS.filter((p) => !p.parent).length;
  ok(box.querySelectorAll('.pt-node').length === rootCount,
    'the sidebar lists the ROOTS (' + rootCount + ' of ' + PERIODS.length + ' periods) — the entry set, declared');

  /* MUTATION: an explicit selection must be honoured instead of the default. */
  const host2 = w.document.createElement('div');
  host2.id = 's-side2';
  w.document.body.appendChild(host2);
  const calls2 = [];
  T.mountSidebar(PERIODS, { hostId: 's-side2', selected: 'c', fetchRows: function (id) { calls2.push(id); return []; } });
  ok(calls2.length === 1 && calls2[0] === 'c', 'an explicit selection wins over the default  [' + calls2 + ']');
  dom.window.close();
}

/* ── STEP ROWS: the period's facts rendered locally, three states preserved (P0-2f) ── */
{
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch (e) { console.log('NEEDS-INPUT: jsdom not installed'); process.exit(3); }
  const dom = new JSDOM('<!doctype html><div id="rows"></div>', { runScripts: 'outside-only' });
  const w = dom.window;
  const A = (f) => fs.readFileSync(path.join(__dirname, '..', 'assets', f), 'utf8');
  /* Load in dependency order: the algebra, then the readers, then the view. */
  w.eval(A('three_state.js'));
  w.eval(A('cell_metering.js'));
  w.eval(A('panel_tree.js'));
  const T = w.CxPanelTree, M = w.CxCellMetering;
  ok(!!(M && M.tokOf && M.foldedCell && M.semOf), 'the readers exist and are shared (no local copy)');

  const ROWS = [
    { kind: 'assistant/usage', data: { completion_tokens: 20, duration_ms: 7, model: 'planner-strong' } },
    { kind: 'assistant/usage', data: { prompt_tokens: 5, completion_tokens: null } },
    { kind: 'assistant/usage', data: {} }
  ];
  const host = w.document.getElementById('rows');
  const list = T.renderRows(host, ROWS);
  const steps = host.querySelectorAll('.pt-step');
  ok(steps.length === 3, 'one row per event (' + steps.length + ')');
  const tok0 = steps[0].querySelector('.pt-tok'), tok1 = steps[1].querySelector('.pt-tok'), tok2 = steps[2].querySelector('.pt-tok');
  ok(tok0.getAttribute('data-state') === 'p' && tok0.textContent === '20',
    'measured step: state p, value 20  [' + tok0.getAttribute('data-state') + ' ' + tok0.textContent + ']');
  ok(tok1.getAttribute('data-state') === 'n', 'unreported-but-legal step: state n (never collapsed to 0)');
  ok(tok2.getAttribute('data-state') === 'a', 'no measurement at all: state a');
  const texts = [tok0.textContent, tok1.textContent, tok2.textContent];
  ok(texts[0] !== texts[1] && texts[1] !== texts[2] && texts[0] !== texts[2],
    'THE THREE STATES STAY THREE TEXTS  [' + texts.join(' | ') + ']');
  ok(texts[1].indexOf('0') < 0 || texts[1] === '20',
    'MUTATION scope: a `|| 0` that collapsed "unmeasured" into "0" would make these texts equal (caught above)');
  ok(host.querySelectorAll('.pt-model').length === 1,
    'the model column exists ONLY when declared (one of three rows declares it)');
  ok(host.querySelector('.pt-model').textContent === 'planner-strong', 'and it carries the declared name');
  ok(steps[0].querySelector('.pt-dur').getAttribute('data-state') === 'p'
    && steps[1].querySelector('.pt-dur').getAttribute('data-state') === 'a',
    'duration uses the same three-state discipline (p where measured, a where not)');
  dom.window.close();
}

/* Run the deferred assertions, then judge. `setTimeout 0` lets the promise microtasks settle. */
setTimeout(function () {
  asyncCases.forEach(function (f) { f(); });
  console.log(bad === 0 ? 'OK — the DAG tree, its closures, the three modes and the async states are all named'
    : 'FAILED — ' + bad + ' check(s) red');
  process.exit(bad ? 1 : 0);
}, 0);
