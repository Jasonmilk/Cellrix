/* pinned_expectation.js — THE EXPECTATION, COMPUTED BY HAND (ADR-0048 §107.1/§107.4).
 * It is the ORACLE for b1b-1 and b1b-2, so it must NOT call project / allocate /
 * foldedCell. It reads the raw event stream and does plain arithmetic. If this file
 * ever calls one of those, "the value matches" becomes true by construction.
 * Verified by mutation: inserting a call to allocate() in here must turn b1b-1 red.
 */
const fs = require('fs');
const path = require('path');
/* declared input (ADR-0048 §130) — no host absolute literal */
const EV = process.env.VALUE_CORPUS
  || require('path').join(__dirname, '..', '..', '..', '.helix', 'events');
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
  /* The note names no banned symbol: this check is about CODE, and prose in a string
   * literal is not a call (the first draft tripped over its own sentence). */
  note: 'oracle: plain arithmetic over data.completion_tokens; it never calls the projection or the allocator',
}, null, 2));

/* SELF-CHECK (ADR-0048 §107.4): the oracle must NOT call the thing under test.
 * Comments are stripped first — the gate learned the same lesson, and a check that counts
 * words in prose is a check that can never fail. */
(function () {
  /* ONLY the oracle's own body is scanned: the first draft read the whole file, which
   * included this check's own banned-name list, so it detected ITSELF and was red even
   * when nothing was wrong (a check that can never be green is as useless as one that can
   * never be red). Baseline must be green for the mutation below to mean anything. */
  var src = require('fs').readFileSync(__filename, 'utf8').split('/* SELF-CHECK')[0]
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
  var banned = ['project', 'allocate', 'foldedCell'].filter(function (n) {
    return new RegExp('\\b' + n + '\\b').test(src);
  });
  console.log((banned.length ? '  FAIL ' : '  ok   ')
    + 'ORACLE INDEPENDENCE — does not call the code under test'
    + (banned.length ? ' (calls: ' + banned.join(', ') + ')' : ''));
  if (banned.length) { process.exit(1); }
}());
