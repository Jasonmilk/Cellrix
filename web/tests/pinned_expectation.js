/* pinned_expectation.js — THE EXPECTATION, COMPUTED BY HAND (ADR-0048 §107.1/§107.4).
 * It is the ORACLE for b1b-1 and b1b-2, so it must NOT call project / allocate /
 * foldedCell. It reads the raw event stream and does plain arithmetic. If this file
 * ever calls one of those, "the value matches" becomes true by construction.
 * Verified by mutation: inserting a call to allocate() in here must turn b1b-1 red.
 */
const fs = require('fs');
const path = require('path');
const EV = '/Users/jason/Developer/Jasonmilk/.helix/events';
const PINNED = 'run-1453c697e434ecfa-p006ab547d0000002.events.jsonl';

const rows = fs.readFileSync(path.join(EV, PINNED), 'utf8').trim().split('\n')
  .filter(Boolean).map((l) => JSON.parse(l));

/* Plain arithmetic: sum completion_tokens over the events that carry it. */
let sum = 0, carriers = 0, total = 0;
for (const e of rows) {
  total++;
  const d = e.data;
  if (d && Object.prototype.hasOwnProperty.call(d, 'completion_tokens')) {
    if (d.completion_tokens === null) { carriers++; continue; }   /* unmeasured */
    sum += d.completion_tokens;
    carriers++;
  }
}
console.log(JSON.stringify({
  sample: PINNED, events: total, carriers: carriers,
  expectedTok: sum,           /* the pinned expectation: MAY BE 0 — never "must be non-zero" */
  note: 'oracle: plain arithmetic over data.completion_tokens; it never calls project/allocate',
}, null, 2));
