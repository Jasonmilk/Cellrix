#!/usr/bin/env node
/* PLAN PRINTER — NOT A CRITERION (owner's decision, 2026-09-29).
 *
 * This file used to enforce the plan's FORMAT (single focus, tier vocabulary, stream tags, acyclicity).
 * Measured cost: five blocking reds and two script crashes from JSON quoting — every one of them cost a
 * round trip, and none of them made the owner's panel behave differently. The plan is a COORDINATION
 * SURFACE, not a deliverable, so its format must never occupy the gate.
 *
 * What remains is the part that earned its keep: print the frontier and the DERIVED counts, so
 * "what is next" comes out of the artifact instead of memory. It always exits 0.
 *
 * The plan itself is now markdown: ../../../Cellrix-Plan-DAG.md (human-readable, hand-editable).
 * Usage: node plan_dag_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const MD = path.join(__dirname, '..', '..', '..', 'Cellrix-Plan-DAG.md');
const JSON_PLAN = path.join(__dirname, '..', '..', '..', 'Cellrix-Plan-DAG.json');

let nodes = null;
try {
  const d = JSON.parse(fs.readFileSync(JSON_PLAN, 'utf8'));
  nodes = d.nodes;
} catch (e) { nodes = null; }

if (!nodes) {
  console.log('NOTE  plan artifact not found (working artifact, kept outside the repo) — nothing to print');
  process.exit(0);
}
const by = {};
for (const n of nodes) { by[n.id] = n; }
const done = nodes.filter((n) => n.status === 'done');
const doing = nodes.filter((n) => n.status === 'doing').map((n) => n.id);
const frontier = nodes.filter((n) => n.status === 'todo'
  && n.deps.every((d) => by[d] && by[d].status === 'done')).map((n) => n.id);
const per = {};
for (const n of nodes) {
  const s = String(n.stream || '?').split(' ')[0];
  per[s] = per[s] || { d: 0, t: 0 };
  per[s].t++;
  if (n.status === 'done') { per[s].d++; }
}
console.log('  derived counts: ' + Object.keys(per).sort().map((k) => k + ' ' + per[k].d + '/' + per[k].t).join(' · '));
console.log('  doing   : ' + (doing.join(', ') || '(none)'));
console.log('  frontier: ' + (frontier.join(', ') || '(none)'));
console.log('  markdown: ' + (fs.existsSync(MD) ? MD : '(not written yet)'));
process.exit(0);
