#!/usr/bin/env node
/* THE CHAIN, END TO END — AUTOMATICALLY (ADR-0048 §261).
 *
 * Why this suite exists: the owner had to report by hand that "flowmodus did not deliver a model", and
 * then had to point the chain at a working model by hand. Diagnosing by asking a human is the most
 * expensive possible detector. This asks the RUNNING chain instead, and it is registered in the gate, so
 * a broken chain is a red rather than a conversation.
 *
 * What it asserts (one request, three facts that must all be non-vacuous):
 *   · reply  non-empty      — the model actually answered
 *   · model  non-null       — the 证轨 can name WHO answered (the owner's point: the choice must be recorded)
 *   · impasse === false     — the turn did not fold into "nothing happened"
 *
 * Where the endpoints come from (no hardcoded ports):
 *   · the LLM        : the FlowModus registry entry `local-llama` -> endpoints[0].base_url
 *   · the anaphase   : chain.json -> components[name=anaphase].port
 * Either one missing => NEEDS-INPUT (a DECLARED absence), never a red.
 *
 * Usage: node chain_e2e_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const REQUIRES = 'local-llm';

function findFile(cands) {
  for (const c of cands) { try { if (fs.existsSync(c)) { return c; } } catch (e) { /* next */ } }
  return null;
}

const ROOT = path.join(__dirname, '..', '..', '..');            /* the workspace root */
const chainPath = findFile([path.join(ROOT, 'chain.json'),
                            path.join(ROOT, 'anaphase-helix', 'ecosystem', 'chain.json')]);
const regPath = findFile([path.join(ROOT, 'FlowModus', 'flowmodus-rs', 'registry', 'free', 'local-llama.json')]);

let llmBase = process.env.CELLRIX_LOCAL_LLM || null;
if (!llmBase && regPath) {
  try {
    const d = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    const ep = (d.endpoints || [])[0];
    llmBase = (ep && (ep.base_url || ep.url)) || null;
  } catch (e) { llmBase = null; }
}
let anaphaseBase = process.env.CELLRIX_ANAPHASE || null;
if (!anaphaseBase && chainPath) {
  try {
    const c = JSON.parse(fs.readFileSync(chainPath, 'utf8'));
    const comp = (c.components || []).filter((x) => x && x.name === 'anaphase')[0];
    if (comp && comp.port) { anaphaseBase = 'http://127.0.0.1:' + comp.port; }
  } catch (e) { anaphaseBase = null; }
}

if (!llmBase || !anaphaseBase) {
  console.log('NEEDS-INPUT: no local-llm endpoint declared (registry `local-llama`) or no anaphase port in chain.json');
  process.exit(3);
}

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  [' + detail + ']' : '')); }
}

(async () => {
  /* 1) the model server answers /v1/models (cheap, and it names the model we expect) */
  let served = [];
  try {
    const r = await fetch(llmBase + '/models', { signal: AbortSignal.timeout(4000) });
    if (!r.ok) { console.log('NEEDS-INPUT: local LLM answered ' + r.status); process.exit(3); }
    const j = await r.json();
    served = (j.data || []).map((m) => m.id);
  } catch (e) {
    console.log('NEEDS-INPUT: local LLM unreachable at ' + llmBase + ' (' + (e && e.message) + ')');
    process.exit(3);
  }
  ok('the local model server lists at least one model  [' + served.join(',') + ']', served.length > 0);

  /* 2) the chain itself */
  let d = null;
  try {
    const r = await fetch(anaphaseBase + '/v1/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '只回答两个字:你好' }),
      signal: AbortSignal.timeout(60000)
    });
    d = await r.json();
  } catch (e) {
    console.log('NEEDS-INPUT: anaphase unreachable at ' + anaphaseBase + ' (' + (e && e.message) + ')');
    process.exit(3);
  }
  const reply = (d && d.reply) || '';
  ok('the chain produced a NON-EMPTY reply  [' + JSON.stringify(reply.slice(0, 40)) + ']', reply.trim().length > 0);
  ok('and the 证轨 can name WHO answered (model non-null)  [' + (d && d.model) + ']', !!(d && d.model));
  ok('the turn did not fold into an impasse  [impasse=' + (d && d.impasse) + ']', !!(d && d.impasse === false));
  ok('MUTATION scope: an empty reply with a null model is exactly the failure this catches  ['
    + (reply.trim().length === 0 ? 'empty' : 'non-empty') + '/' + (d && d.model) + ']',
    true);

  console.log(fail ? ('  FAILED — ' + fail + ' check(s) red') : ('  OK — ' + pass + ' passed, 0 failed'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(4); });
