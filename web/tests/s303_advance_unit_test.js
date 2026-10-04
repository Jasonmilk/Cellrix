#!/usr/bin/env node
/* LAYER A — THE RULE, WITHOUT A PANEL, A CHAIN OR A BROWSER (ADR-0048 §303, owner ruling 1a).
 *
 * `advancePointer` decides WHERE the next message attaches after a reply lands. Its rule is pure — dual key,
 * bounded retry, no "newest" fallback — so it is judged here with injected effects. Each guardrail carries the
 * mutation that would break it, so a passing run means the RULE is pinned, not that a fixture agrees with it.
 *
 * Usage: node s303_advance_unit_test.js          (jsdom for the asset only; never a network call)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const RETRIES = 3;             /* declared threshold (owner guardrail 1: "3 × 2s" = 1 initial + 3 retries) */

let pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log('  ok   ' + n + (d ? '  [' + d + ']' : '')); } else { fail++; console.log('  FAIL ' + n + (d ? '  [' + d + ']' : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
const w = dom.window;
for (const f of ['three_state.js', 'event_family.js', 'cell_metering.js', 'chat.js']) {
  try { w.eval(fs.readFileSync(path.join(__dirname, '..', 'assets', f), 'utf8')); } catch (e) {}
}
const advance = w.CxAdvancePointer;
ok('the rule is exported as an injectable seam', typeof advance === 'function');

/* A stub world: the list the re-read returns, and the effects observed. */
function world(rowsSeq, opts) {
  const o = opts || {};
  const seen = { calls: 0, note: [], moved: [], warned: [] };
  return {
    seen,
    deps: {
      fetchJson: function () {
        seen.calls++;
        const idx = Math.min(seen.calls, rowsSeq.length) - 1;
        if (o.reject) { return Promise.reject(new Error(o.reject)); }
        return Promise.resolve({ periods: rowsSeq[idx] });
      },
      setPointer: function (pid, cid) { seen.moved.push(pid); },
      note: function (st) { seen.note.push(st); },
      warn: function (m) { seen.warned.push(m); }
    }
  };
}
const P = (n) => 'run-aaaaaaaaaaaaaaaa-p' + String(n).padStart(16, '0');

(async function main() {
  /* GUARDRAIL 2 — dual key: only a row matching BOTH the job and the sent parent counts. */
  /* DECOYS THAT MISS ON EITHER KEY — measured lesson: my first fixture labelled a row with the MATCHING job
   * as a decoy, and the rule (correctly) picked it because its -p serial was higher. A decoy must miss. */
  const decoys = [
    { period_id: P(9), job_id: 'run-bbbbbbbbbbbbbbbb', parent: P(1) },   /* right parent, WRONG JOB   */
    { period_id: P(8), job_id: 'run-eeeeeeeeeeeeeeee', parent: P(1) },   /* right parent, WRONG JOB   */
    { period_id: P(7), job_id: 'run-cccccccccccccccc', parent: P(2) }    /* right job,    WRONG PARENT*/
  ];
  const hitRows = decoys.concat([{ period_id: P(3), job_id: 'run-cccccccccccccccc', parent: P(1) }]);
  let x = world([hitRows]);
  const t1 = await advance({ job_id: 'run-cccccccccccccccc' }, P(1), x.deps);
  ok('dual key: the pointer lands on the row matching job_id AND parent',
    t1 === P(3) && x.seen.moved.length === 1 && x.seen.moved[0] === P(3), String(t1));

  /* GUARDRAIL 3 — NO "newest" fallback: a list whose only rows are NOT matches must not move the pointer. */
  x = world([[{ period_id: P(50), job_id: 'run-cccccccccccccccc', parent: P(49) }]]);
  const t2 = await advance({ job_id: 'run-cccccccccccccccc' }, P(1), x.deps);
  ok('GUARDRAIL 3: with no dual-key match the pointer DOES NOT MOVE (no newest fallback)',
    t2 === null && x.seen.moved.length === 0, 'moved=' + x.seen.moved.length);
  ok('MUTATION 3: a newest-fallback implementation would have moved it to ' + P(50),
    x.seen.moved.indexOf(P(50)) < 0);

  /* GUARDRAIL 1 — bounded retry, and the miss is RECORDED (a silent null is the forbidden state). */
  x = world([[], [], []]);
  await advance({ job_id: 'run-cccccccccccccccc' }, P(1), x.deps);
  ok('GUARDRAIL 1: the re-read is bounded (1 initial + ' + RETRIES + ' retries)',
    x.seen.calls === 1 + RETRIES, 'calls=' + x.seen.calls);
  ok('GUARDRAIL 1: the miss is RECORDED (resolved:false) instead of a silent null',
    x.seen.note.length === 1 && x.seen.note[0].resolved === false && x.seen.moved.length === 0,
    JSON.stringify(x.seen.note[0] || null).slice(0, 90));
  ok('MUTATION 1: a silent-null implementation would leave the record EMPTY',
    x.seen.note.length > 0);

  /* GUARDRAIL 1b — an EXCEPTION is a named miss too (measured need: it used to be invisible). */
  x = world([[]], { reject: 'boom' });
  await advance({ job_id: 'run-cccccccccccccccc' }, P(1), x.deps);
  ok('GUARDRAIL 1b: a rejected re-read is RECORDED with its reason, pointer unmoved',
    x.seen.note.length === 1 && /re-read failed: boom/.test(x.seen.note[0].reason) && x.seen.moved.length === 0,
    String(x.seen.note[0] && x.seen.note[0].reason));

  /* GUARDRAIL 2/4 — several matches: highest `-p` serial wins AND the multiplicity is REPORTED. */
  const multi = [
    { period_id: P(4), job_id: 'run-dddddddddddddddd', parent: P(1) },
    { period_id: P(11), job_id: 'run-dddddddddddddddd', parent: P(1) },
    { period_id: P(7), job_id: 'run-dddddddddddddddd', parent: P(1) }
  ];
  x = world([multi]);
  const t4 = await advance({ job_id: 'run-dddddddddddddddd' }, P(1), x.deps);
  ok('GUARDRAIL 2/4: several matches ⇒ the highest -p serial wins', t4 === P(11), String(t4));
  ok('GUARDRAIL 4: and the multiplicity is REPORTED, not silently broken as a tie',
    x.seen.warned.length === 1 && /3 periods matched/.test(x.seen.warned[0]), String(x.seen.warned[0]).slice(0, 60));
  ok('MUTATION 4: a silent tie-break would warn zero times', x.seen.warned.length > 0);

  console.log(fail ? ('  FAILED — ' + fail + ' check(s) red') : ('  OK — ' + pass + ' passed, 0 failed'));
  process.exit(fail ? 1 : 0);
})();
