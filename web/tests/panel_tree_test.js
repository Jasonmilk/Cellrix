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

console.log(bad === 0 ? 'OK — the DAG tree, its closures, and the three modes are all named'
  : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
