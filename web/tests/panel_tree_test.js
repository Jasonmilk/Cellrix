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
  ok(box.querySelectorAll('.pt-node').length === PERIODS.length,
    'while the OVERVIEW is complete: every period is still listed');

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
