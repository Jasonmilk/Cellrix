#!/usr/bin/env node
/* A CONVERSATION IS ITS LINEAGE ROOT — NEVER A CONTENT DIGEST (§297).
 *
 * Why: `job_id` is a hash of the first input, so two conversations that OPEN WITH THE SAME WORDS share
 * it. The reader documents it as "NOT usable as a list key" (query.rs:113), yet the panel grouped the
 * sidebar by it — measured: 11 roots fused into one "conversation". The fixture below is exactly that
 * case: two chains whose every period shares a job_id with its counterpart in the other chain.
 *
 * Usage: node conversation_identity_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const REQUIRES = 'jsdom';   /* no live panel: the fixture is the evidence */

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  [' + detail + ']' : '')); }
}

const dom = new JSDOM('<!doctype html><div id="s-side"></div>', { runScripts: 'outside-only' });
const w = dom.window;
w.eval(fs.readFileSync(path.join(__dirname, '..', 'assets', 'panel_tree.js'), 'utf8'));
const T = w.CxPanelTree;

/* TWO conversations, SAME opening words ⇒ SAME job_id on both roots (and on both children). */
const P = [
  { period_id: 'a1', parent: null, job_id: 'J-same', preview: 'hello', first_ts: '2026-09-30T01:00:00Z', reply: 'r' },
  { period_id: 'a2', parent: 'a1', job_id: 'J-same2', preview: 'again', first_ts: '2026-09-30T01:01:00Z', reply: 'r' },
  { period_id: 'b1', parent: null, job_id: 'J-same', preview: 'hello', first_ts: '2026-09-30T02:00:00Z', reply: 'r' },
  { period_id: 'b2', parent: 'b1', job_id: 'J-same2', preview: 'again', first_ts: '2026-09-30T02:01:00Z', reply: 'r' }
];

const groups = T.groupByConversation(P);
ok('two conversations that OPEN WITH THE SAME WORDS stay TWO (not fused on a shared job_id)',
  groups.length === 2, 'groups=' + groups.length + ' ids=' + groups.map((g) => g.conversation_id).join(','));
ok('the group key is `conversation_id`, not `job_id` (one name, one fact)',
  groups.every((g) => g.conversation_id && g.job_id === undefined),
  JSON.stringify(Object.keys(groups[0] || {})));
ok('a conversation is named by its LINEAGE ROOT (root id first)',
  groups.map((g) => g.conversation_id).sort().join(',') === 'a1,b1',
  groups.map((g) => g.conversation_id).join(','));

const host = w.document.getElementById('s-side');
T.mountSidebar(P, {});
const rowOf = (id) => Array.from(host.querySelectorAll('.ses-item')).filter((e) => e.getAttribute('data-period') === id)[0];
ok('a continuation carries its root as `data-conversation`',
  rowOf('a2') && rowOf('a2').getAttribute('data-conversation') === 'a1',
  rowOf('a2') && rowOf('a2').getAttribute('data-conversation'));
ok('a root is its own conversation (conversation_id == period_id)',
  rowOf('a1').getAttribute('data-conversation') === 'a1');
/* MEMBERSHIP IS THE DISCRIMINATOR (the fixture's two chains share the SAME job_id set, so a count
 * alone cannot tell the two groupings apart — measured: job-keying also yields 2 groups, but its
 * members are {a1,b1} and {a2,b2}: two conversations CROSSED, which is the real defect). */
const members = groups.map((g) => g.periods.map((p) => p.period_id).sort().join('+')).sort();
ok('membership: each conversation holds a WHOLE chain',
  members.join(' | ') === 'a1+a2 | b1+b2', members.join(' | '));
const byJob = {};
P.forEach((p) => { (byJob[p.job_id] = byJob[p.job_id] || []).push(p.period_id); });
const jobMembers = Object.keys(byJob).map((k) => byJob[k].sort().join('+')).sort().join(' | ');
ok('MUTATION: keying by job_id CROSSES the two conversations (membership differs)',
  jobMembers !== members.join(' | '), 'by job_id: ' + jobMembers);

/* SINGLE-ROUND CONVERSATIONS ARE ONE CLASS, NOT N ROWS (§302). Measured in the owner's own view: ~45
 * visible rows were the same one-round conversation repeated, so the sidebar read as noise. */
{
  const host3 = w.document.createElement('div');
  host3.id = 'host-fixture-302';
  w.document.body.appendChild(host3);
  const S = [
    { period_id: 'm1', parent: null, job_id: 'A', reply: 'r', first_ts: '2026-09-30T05:00:00Z' },
    { period_id: 'm2', parent: 'm1', job_id: 'A2', reply: 'r', first_ts: '2026-09-30T05:01:00Z' },
    { period_id: 's1', parent: null, job_id: 'B', reply: 'r', first_ts: '2026-09-30T06:00:00Z' },
    { period_id: 's2', parent: null, job_id: 'C', reply: 'r', first_ts: '2026-09-30T07:00:00Z' },
    { period_id: 's3', parent: null, job_id: 'D', reply: 'r', first_ts: '2026-09-30T08:00:00Z' }
  ];
  w.CxPanelTree.mountSidebar(S, { hostId: host3.id });
  const box = host3.querySelector('.pt-singles');
  const head = host3.querySelector('[data-single-rounds-toggle]');
  const outside = Array.from(host3.querySelectorAll('.ses-item')).filter((r) => !box || !box.contains(r));
  ok('single-round conversations are folded under ONE declared header (§302)',
    !!box && !!head && box.getAttribute('data-single-rounds') === '3',
    'box=' + !!box + ' declared=' + (box && box.getAttribute('data-single-rounds')));
  ok('and they are COLLAPSED by default, so the list is at conversation scale',
    !!box && box.hasAttribute('hidden') && outside.length === 2,
    'hidden=' + (box && box.hasAttribute('hidden')) + ' visible=' + outside.length);
  ok('one click reveals them (and relabels the header)',
    (function () { if (!head) { return false; } head.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); return !box.hasAttribute('hidden'); })(),
    head && head.textContent);
  ok('MUTATION: without folding all five rows would be visible (the noise the owner saw)',
    outside.length !== S.length, 'visible=' + outside.length + ' of ' + S.length);
  if (host3.parentNode) { host3.parentNode.removeChild(host3); }
}

/* A ONE-ROUND CONVERSATION MUST OCCUPY ONE LINE (§301). Measured live: 49 headers + 50 rows for 50
 * conversations — a header saying "1 period · 1 with reply" above the only row it described. */
{
  const host2 = w.document.createElement('div');
  host2.id = 'host-fixture-301';
  w.document.body.appendChild(host2);
  const F = [
    { period_id: 'solo', parent: null, job_id: 'J', preview: 'one round', reply: 'r', first_ts: '2026-09-30T03:00:00Z' },
    { period_id: 'c1', parent: null, job_id: 'K', preview: 'two rounds', reply: 'r', first_ts: '2026-09-30T04:00:00Z' },
    { period_id: 'c2', parent: 'c1', job_id: 'K2', preview: 'second', reply: 'r', first_ts: '2026-09-30T04:01:00Z' }
  ];
  w.CxPanelTree.mountSidebar(F, { hostId: host2.id });
  const groups2 = host2.querySelectorAll('.pt-group').length;
  const rows2 = host2.querySelectorAll('.ses-item').length;
  ok('a one-round conversation gets NO redundant header (one line per conversation)',
    rows2 === 3 && groups2 === 1, 'rows=' + rows2 + ' headers=' + groups2);
  ok('MUTATION: emitting a header per conversation would print them twice  [naive headers=2]',
    groups2 !== 2, 'the check above would fail if headers were unconditional');
  if (host2.parentNode) { host2.parentNode.removeChild(host2); }
}

/* CONTRACT (source-level, labelled): the conversation key must never come from `job_id`. */
const SRC = fs.readFileSync(path.join(__dirname, '..', 'assets', 'panel_tree.js'), 'utf8');
ok('the sortable key is not taken from `job_id` anywhere in the grouping path',
  !/var key = p\.job_id/.test(SRC) && !/var conv = \(n\.row && \(n\.row\.job_id/.test(SRC));
dom.window.close();

console.log(fail ? ('  FAILED — ' + fail + ' check(s) red') : ('  OK — ' + pass + ' passed, 0 failed'));
process.exit(fail ? 1 : 0);
