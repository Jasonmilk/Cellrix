/* plan_dag_test — THE PLAN IS A DAG, AND IT IS ENFORCED (ADR-0048 §228).
 *
 * The owner asked for a plan that behaves like the DAG it describes, so that a forgotten item is a
 * FAILING CRITERION rather than a memory lapse. This suite checks the structure (acyclic, every
 * dependency exists, statuses from the closed set, every node carries a visible acceptance), and it
 * prints the FRONTIER — the todo nodes whose dependencies are all done — so "what is next" is read
 * from the artifact instead of recalled.
 */
const fs = require('fs'), path = require('path');
let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };

/* The plan is a SESSION WORKING ARTIFACT and lives OUTSIDE the repository (workspace root), so the
 * project is not polluted. Its absence is a DECLARED absence (exit 3), never a red: a fresh clone
 * has no plan file and must not fail because a temporary artifact is missing. */
const PLAN = path.join(__dirname, '..', '..', '..', 'Cellrix-Plan-DAG.json');
if (!fs.existsSync(PLAN)) {
  console.log('NEEDS-INPUT: no session plan file at ' + PLAN + ' (working artifact, kept outside the repo)');
  process.exit(3);
}
const P = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
const byId = {};
P.nodes.forEach((n) => { byId[n.id] = n; });

ok(P.nodes.length > 0, 'the plan has nodes (' + P.nodes.length + ')');
ok(P.nodes.every((n) => P.statuses.indexOf(n.status) >= 0),
  'every status is from the closed set [' + P.statuses.join('|') + ']');
ok(P.nodes.every((n) => (n.deps || []).every((d) => byId[d])),
  'every dependency EXISTS (a dangling dep would be a forgotten item)');
ok(P.nodes.every((n) => typeof n.acceptance === 'string' && n.acceptance.length > 10),
  'every node names a VISIBLE acceptance (never a bare count)');

/* Single focus: two "doing" nodes means the plan is already drifting. */
const doing = P.nodes.filter((n) => n.status === 'doing');
ok(doing.length <= 1, 'at most ONE node is `doing`  [' + doing.map((n) => n.id).join(',') + ']');

/* Acyclic: DFS with a colour mark. */
const colour = {};
let cycle = null;
const visit = (id, stack) => {
  if (colour[id] === 'black') { return; }
  if (colour[id] === 'grey') { cycle = stack.concat(id); return; }
  colour[id] = 'grey';
  (byId[id].deps || []).forEach((d) => visit(d, stack.concat(id)));
  colour[id] = 'black';
};
P.nodes.forEach((n) => visit(n.id, []));
ok(!cycle, 'the plan is ACYCLIC  [' + (cycle ? cycle.join(' -> ') : 'no cycle') + ']');

/* The frontier: what can start now. Printed, not remembered. */
const frontier = P.nodes.filter((n) => n.status === 'todo'
  && (n.deps || []).every((d) => byId[d].status === 'done')).map((n) => n.id);
console.log('  NOTE  frontier (todo with all deps done): ' + (frontier.join(', ') || '(none)'));
console.log('  NOTE  doing: ' + (doing.map((n) => n.id).join(', ') || '(none)'));
const blockedNow = P.nodes.filter((n) => n.status === 'todo'
  && (n.deps || []).some((d) => byId[d].status !== 'done')).map((n) => n.id);
console.log('  NOTE  waiting on deps: ' + (blockedNow.join(', ') || '(none)'));

/* MUTATION: a dependency cycle must be detectable by exactly the check above. */
const cyclic = { a: { deps: ['b'] }, b: { deps: ['a'] } };
const colour2 = {}; let cyc2 = null;
const visit2 = (id, stack) => {
  if (colour2[id] === 'black') { return; }
  if (colour2[id] === 'grey') { cyc2 = stack.concat(id); return; }
  colour2[id] = 'grey';
  (cyclic[id].deps || []).forEach((d) => visit2(d, stack.concat(id)));
  colour2[id] = 'black';
};
visit2('a', []);
ok(!!cyc2, 'MUTATION: a cycle IS detected by this check (so the acyclicity claim can fail)');

console.log(bad === 0 ? 'OK — the plan is a DAG: acyclic, complete, single-focus, with a visible frontier'
  : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
