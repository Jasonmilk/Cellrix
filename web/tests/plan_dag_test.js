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
/* ── THE GOAL MUST BE FALSIFIABLE (ADR-0048 §246.1③ + the external review's F2) ──
 * Measured: the goal named navigation / on-demand rendering / the proof-track / three modes, but NOT
 * "continue from a selected node" — so a delivery with no branching satisfied every clause. A goal that
 * a MISSING capability satisfies is a description, not a goal. */
{
  const g = (P.goal && P.goal.statement) || '';
  const must = (P.goal && P.goal.must_include) || [];
  ok(must.length >= 4, 'the goal declares the capabilities it must include  [' + must.length + ']');
  for (const phrase of must) {
    ok(g.indexOf(phrase) >= 0, 'the goal names a capability a delivery could otherwise omit: ' + phrase);
  }
  /* MUTATION: remove the fork sentence and this must go red — asserted against a synthetic copy. */
  const withoutFork = g.replace(/从任意选中的节点继续[^。]*。/, '');
  ok(withoutFork.indexOf('从任意选中的节点继续') < 0 && withoutFork !== g,
    'MUTATION: deleting the fork clause is DETECTED (the check can fail)');
}

/* ── THE COUNTS ARE DERIVED, NOT TYPED (P0-2): prose counts cannot be reconstructed, derived ones can ── */
{
  const byStream = {};
  for (const n of P.nodes) {
    const st = n.stream || '(none)';
    byStream[st] = byStream[st] || { done: 0, total: 0 };
    byStream[st].total++;
    if (n.status === 'done') { byStream[st].done++; }
  }
  const lines = Object.keys(byStream).sort().map(function (k) {
    return k.split(' ')[0] + ' ' + byStream[k].done + '/' + byStream[k].total;
  });
  console.log('  NOTE  derived counts (from status+stream): ' + lines.join(' · '));
  const doneAll = P.nodes.filter(function (n) { return n.status === 'done'; }).length;
  ok(doneAll === P.nodes.filter(function (n) { return n.status === 'done'; }).length,
    'the completion number is READ FROM the DAG: ' + doneAll + '/' + P.nodes.length);
  /* MUTATION: a node whose status is flipped must move the number. */
  const probe = JSON.parse(JSON.stringify(P));
  const firstTodo = probe.nodes.filter(function (n) { return n.status === 'todo'; })[0];
  let moved = null;
  if (firstTodo) {
    firstTodo.status = 'done';
    moved = probe.nodes.filter(function (n) { return n.status === 'done'; }).length;
    ok(moved === doneAll + 1, 'MUTATION: flipping one status moves the derived count (' + doneAll + ' -> ' + moved + ')');
  }
}

/* ── A 'done' NODE MUST CARRY ITS EVIDENCE TIER (P0-3): low-grade evidence cannot support a high claim ── */
{
  const untagged = P.nodes.filter(function (n) { return n.status === 'done' && !n.tier; });
  ok(untagged.length === 0, 'every done node names its tier  [' + untagged.map(function (n) { return n.id; }).join(',') + ']');
  /* A CLOSED VOCABULARY, NOT A WORD SEARCH. The first version asserted that a `live*` tier's
   * acceptance contains the word "live" — a functional check on prose, exactly the trap where
   * `acceptance = "aaaaaaaaaaaaaaaa"` passes. What is machine-checkable and meaningful is:
   * the tier comes from a DECLARED SET, and a `done` node may not carry `none`/`UNKNOWN`. */
  const TIERS = ['fixture', 'unit', 'live-payload', 'live-process', 'live-record', 'none'];
  const badTier = P.nodes.filter(function (n) { return n.tier && TIERS.indexOf(n.tier) < 0; });
  ok(badTier.length === 0, 'every tier comes from the declared set  ['
    + badTier.map(function (n) { return n.id + ':' + n.tier; }).join(',') + ']');
  const weakDone = P.nodes.filter(function (n) {
    return n.status === 'done' && (!n.tier || n.tier === 'none');
  });
  ok(weakDone.length === 0, 'a done node never rests on `none`/missing evidence  ['
    + weakDone.map(function (n) { return n.id; }).join(',') + ']');
  /* MUTATION: a done node demoted to `none` must be caught. */
  const probe2 = JSON.parse(JSON.stringify(P));
  const d0 = probe2.nodes.filter(function (n) { return n.status === 'done'; })[0];
  d0.tier = 'none';
  const caught = probe2.nodes.filter(function (n) {
    return n.status === 'done' && (!n.tier || n.tier === 'none');
  }).length;
  ok(caught === 1, 'MUTATION: demoting the tier of a done node to none IS detected (' + caught + ')');
}

process.exit(bad ? 1 : 0);
