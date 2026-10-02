#!/usr/bin/env node
/* M4⓪ — THE CAPABILITY SOURCE MUST BE FILLED, NAMESPACED, AND THREE-STATE (ADR-0048 §356).
 *
 * MEASURED BEFORE THIS SUITE: `capability_tags` was `vec![]` in THREE code sites, while the OTHER tag field
 * (`semantic_tags`) carried `local` / `fast` / `reasoning`. So "filter by tag presence" would have PASSED
 * while selecting `agnes-video-2.5` — the filter would have been green and wrong. The criterion therefore
 * refuses a capability declaration that is not NAMESPACED, and refuses absence (absence is `unknown`, and
 * `unknown` must be written, never defaulted to text).
 *
 * Usage: node capability_source_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const MIN_CLASSES = 2;   /* declared threshold (ADR-0022 §2.5): at least text and non-text must exist */
const REGISTRY = path.join(__dirname, '..', '..', '..', 'FlowModus', 'flowmodus-rs', 'registry', 'free');
const NAMESPACE = 'modality:';
const STATES = ['text', 'non-text', 'unknown'];

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  [' + detail + ']' : '')); }
}

if (!fs.existsSync(REGISTRY)) { console.log('NEEDS-INPUT: the FlowModus registry is not present'); process.exit(3); }
const files = fs.readdirSync(REGISTRY).filter((f) => f.endsWith('.json'));
ok('the registry is readable', files.length >= 1, files.join(','));

const problems = [];
const classes = new Set();
const samples = {};
for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(REGISTRY, f), 'utf8'));
  for (const m of (d.models || [])) {
    const id = m.model_id || '(no id)';
    const tags = m.capability_tags;
    if (!Array.isArray(tags) || tags.length === 0) {
      problems.push(f + ':' + id + ' has NO capability declaration (absence is not `unknown`)');
      continue;
    }
    const namespaced = tags.filter((t) => String(t).indexOf(NAMESPACE) === 0);
    if (namespaced.length === 0) {
      problems.push(f + ':' + id + ' declares only ' + JSON.stringify(tags)
        + ' — a capability MUST be namespaced (' + NAMESPACE + '…), because `local`/`fast` are not modality');
      continue;
    }
    const state = String(namespaced[0]).slice(NAMESPACE.length);
    if (STATES.indexOf(state) < 0) {
      problems.push(f + ':' + id + ' has an unknown capability state ' + JSON.stringify(state));
      continue;
    }
    classes.add(state);
    samples[state] = samples[state] || [];
    if (samples[state].length < 3) { samples[state].push(id + ' (' + f + ')'); }
  }
}
ok('every model carries an EXPLICIT, NAMESPACED capability state', problems.length === 0,
  problems.slice(0, 3).join(' | ') || 'all models classified');
ok('the mixed case really exists: text AND non-text have NAMED samples',
  classes.has('text') && classes.has('non-text') && classes.size >= MIN_CLASSES,
  'text=' + (samples['text'] || []).join(',') + ' | non-text=' + (samples['non-text'] || []).join(','));
/* MUTATIONS: each of the three ways to fake this must be detected. */
const fake = [
  { model_id: 'x', capability_tags: [] },                       /* absent */
  { model_id: 'x', capability_tags: ['local', 'fast'] },        /* un-namespaced: presence ≠ modality */
  { model_id: 'x', capability_tags: ['modality:maybe'] }        /* a state outside the three */
];
const detected = fake.map((m) => {
  const tags = m.capability_tags;
  if (!Array.isArray(tags) || tags.length === 0) { return 'absent'; }
  const ns = tags.filter((t) => String(t).indexOf(NAMESPACE) === 0);
  if (ns.length === 0) { return 'unnamespaced'; }
  return STATES.indexOf(String(ns[0]).slice(NAMESPACE.length)) < 0 ? 'unknown-state' : 'accepted';
});
ok('MUTATION: absence, an un-namespaced tag, and a fourth state are ALL rejected',
  detected.join(',') === 'absent,unnamespaced,unknown-state', detected.join(','));

console.log(fail ? ('  FAILED — ' + fail + ' check(s) red') : ('  OK — ' + pass + ' passed, 0 failed'));
process.exit(fail ? 1 : 0);
