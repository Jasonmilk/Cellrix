/* panel_tree_test — the DAG navigation core (ADR-0048 §227).
 * The criterion that matters: the tree's EDGES are exactly the non-null parents (one fact, one
 * host), the ancestor closure is structural, and an unknown run mode is a NAMED absence.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
let bad = 0;
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

  dom.window.close();
}

console.log(bad === 0 ? 'OK — the DAG tree, its closures, and the three modes are all named'
  : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
