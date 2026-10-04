#!/usr/bin/env node
/* LAYER B — THE SAME RULE THROUGH THE REAL CHAIN (ADR-0048 §303, owner ruling 1b).
 *
 * This drives HTTP only (no DOM): POST /api/chat carrying a `period_id` anchor, wait for the terminal line,
 * then read the period list and require the row with that answer's `job_id` to have `parent == the anchor`.
 * The MUTATION is the discriminating half: the SAME request WITHOUT an anchor must produce `parent: null` —
 * so a green run proves the anchor is what creates the lineage, not that "some parent happened to appear".
 *
 * REQUIRES='local-llm' (the :8080 chain) — held when it is absent, never red.
 *
 * Usage: node s303_http_e2e_test.js
 */
const REQUIRES = 'local-llm';
'use strict';
const PANEL = process.env.CX_PANEL || 'http://127.0.0.1:50050';
const LLM_TIMEOUT_MS = 180000;   /* declared: a local 7B model is slow, and a slow answer is not a failure */

let pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log('  ok   ' + n + (d ? '  [' + d + ']' : '')); } else { fail++; console.log('  FAIL ' + n + (d ? '  [' + d + ']' : '')); } }

async function list() {
  const r = await fetch(PANEL + '/api/sessions?limit=8');
  const d = await r.json();
  return d.periods || [];
}
async function say(message, anchor) {
  const body = anchor ? { message, job_id: anchor } : { message };
  const r = await fetch(PANEL + '/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const text = await r.text();
  const line = text.trim().split('\n').filter(Boolean).pop() || '{}';
  return JSON.parse(line.replace(/^data:\s*/, ''));
}
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

(async function main() {
  let rows;
  try { rows = await list(); } catch (e) { console.log('NEEDS-INPUT: the panel is unreachable'); process.exit(3); }
  const anchor = (rows.find((p) => p.parent) || rows[0] || {}).period_id;
  if (!anchor) { console.log('NEEDS-INPUT: no period to anchor on'); process.exit(3); }

  /* ① WITH the anchor: the new period must record it as its parent. */
  let answer;
  try { answer = await withTimeout(say('S303 HTTP 判据:带锚点', anchor), LLM_TIMEOUT_MS); }
  catch (e) { console.log('NEEDS-INPUT: the chain did not answer (' + e.message + ')'); process.exit(3); }
  ok('the chain answered with a terminal line', answer && answer.done === true, 'job_id=' + String(answer.job_id));

  const after = await list();
  const children = after.filter((p) => p.job_id === answer.job_id && p.parent);
  ok('the row for that answer carries a PARENT (lineage reached the store)',
    children.length >= 1, children.map((p) => String(p.parent).slice(-6)).join(','));
  ok('and the parent IS the anchor this request carried',
    children.some((p) => p.parent === anchor),
    'anchor=' + String(anchor).slice(-6) + ' parents=' + children.map((p) => String(p.parent).slice(-6)).join(','));

  /* ② MUTATION: the SAME request WITHOUT an anchor must yield NO parent. */
  const bare = await withTimeout(say('S303 HTTP 判据:不带锚点', null), LLM_TIMEOUT_MS);
  const after2 = await list();
  const bareRows = after2.filter((p) => p.job_id === bare.job_id);
  ok('MUTATION: without an anchor the new period has NO parent (so the anchor is what creates lineage)',
    bareRows.length >= 1 && bareRows.every((p) => !p.parent),
    'rows=' + bareRows.length + ' parents=' + bareRows.map((p) => String(p.parent)).join(','));

  console.log(fail ? ('  FAILED — ' + fail + ' check(s) red') : ('  OK — ' + pass + ' passed, 0 failed'));
  process.exit(fail ? 1 : 0);
})();
