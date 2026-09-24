#!/usr/bin/env node
/* The Anaphase <-> FlowModus reasoning contract, asserted as a CONTRACT.
 *
 * Why this suite exists (measured 2026-09-24):
 *
 * `flowmodus.proto` documents field 2 as the COGNITIVE MODE —
 *   "The cognitive mode requested by Anaphase: auto / left_brain / ..."
 * — but names it `model`. Anaphase's adapter takes a parameter called `model`
 * and passes `reasoning_mode` into it; FlowModus reads `mode_to_role(&mode)`.
 * Both sides are internally consistent, so NOTHING errored: every turn simply
 * routed Auto -> agnes-ai -> 403, and the symptom (`model: null`, `impasse`) read
 * as "no supplier key" for several rounds.
 *
 * A field whose name disagrees with its meaning is not a style question here: it
 * cost a full chain's worth of diagnosis. So the contract is asserted directly —
 * a request must be able to carry BOTH facts, under names that mean them.
 *
 * Two copies of the .proto exist (anaphase vendors FlowModus's). That is a second
 * source of truth by construction, so the copies are also asserted identical: a
 * contract that drifts between repos drifts silently, which is the same failure
 * mode one level up.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WS = path.resolve(__dirname, '..', '..', '..');
const COPIES = [
  { who: 'anaphase (client)', rel: 'anaphase-helix/proto/flowmodus.proto' },
  { who: 'FlowModus (server)', rel: 'FlowModus/flowmodus-rs/proto/flowmodus.proto' },
];

let pass = 0, fail = 0, skipped = 0;
function check(label, cond, detail) {
  const tail = detail ? '  [' + detail + ']' : '';
  if (cond) { pass++; console.log('  PASS  ' + label + tail); }
  else { fail++; console.log('  FAIL  ' + label + tail); }
}
function skip(label, why) { skipped++; console.log('  SKIP  ' + label + '  -> ' + why); }

/* ── the fields each message must be able to carry ──────────────────────── */
const REQUIRED = ['prompt', 'cognitive_mode', 'model', 'max_tokens'];
/* The RESPONSE side owes the caller two facts it cannot derive: how many tokens
 * the round trip cost, and which model actually served it (ADR-0036 — the routed
 * fact, not the declared name). Both were being dropped, so a turn that succeeded
 * still reported `model: null` and produced no `assistant/usage`. */
const REQUIRED_RESPONSE = ['content', 'tokens_consumed', 'model'];

/* Parse one message block's field names. Deliberately small: this reads a
 * contract, it is not a protobuf compiler. */
function fieldsOf(src, message) {
  const m = src.match(new RegExp('message\\s+' + message + '\\s*\\{([\\s\\S]*?)\\n\\}'));
  if (!m) return null;
  return m[1].split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').trim())
    .filter(Boolean)
    .map((l) => (l.match(/^(?:repeated\s+|optional\s+)?[\w.<>]+\s+(\w+)\s*=/) || [])[1])
    .filter(Boolean);
}

console.log('-- the contract --');
const missingFile = COPIES.filter((c) => !fs.existsSync(path.join(WS, c.rel)));
if (missingFile.length) {
  console.log('NEEDS-INPUT: 找不到 ' + missingFile.map((c) => c.rel).join(', '));
  process.exit(3);
}
const srcs = COPIES.map((c) => ({ ...c, src: fs.readFileSync(path.join(WS, c.rel), 'utf8') }));

/* 1. Both copies declare every fact each message must carry. */
for (const c of srcs) {
  for (const [msg, want] of [['ReasonRequest', REQUIRED], ['ReasonResponse', REQUIRED_RESPONSE]]) {
    const fields = fieldsOf(c.src, msg);
    if (!fields) { check(`${c.who}: ${msg} is parseable`, false); continue; }
    const absent = want.filter((f) => fields.indexOf(f) === -1);
    check(`${c.who}: ${msg} carries ${want.join(' + ')}`,
      absent.length === 0,
      absent.length ? 'missing ' + absent.join(', ') + ' (has ' + fields.join(',') + ')'
                    : fields.join(', '));
  }
}

/* 2. `model` must not be documented as the mode any more — the doc comment is
 *    what made this contract readable-but-wrong. */
for (const c of srcs) {
  const m = c.src.match(/message\s+ReasonRequest\s*\{([\s\S]*?)\n\}/);
  const block = m ? m[1] : '';
  /* The annotation that made this contract readable-but-wrong sits in the
   * comment block ABOVE the field, not on the field's own line — checking only
   * the line made this assertion pass on the broken contract (measured). */
  const lines = block.split('\n');
  const idx = lines.findIndex((l) => /^\s*string\s+model\s*=/.test(l));
  let j = idx - 1; const above = [];
  while (j >= 0 && /^\s*\/\//.test(lines[j])) { above.unshift(lines[j]); j--; }
  check(`${c.who}: \`model\` is not annotated as a cognitive mode`,
    idx > -1 && !/cognitive mode/i.test(above.join(' ')),
    idx === -1 ? 'no `string model` field' : (above.length ? above[0].trim() : 'no doc comment'));
}

/* 3. The two vendored copies must not drift. */
const same = srcs[0].src === srcs[1].src;
check('the two vendored copies are identical (no silent drift)', same,
  same ? 'byte-identical' : 'anaphase and FlowModus disagree');

/* ── 4. non-vacuity: the field scanner can fail ─────────────────────────── */
const synthetic = 'message ReasonRequest {\n  string prompt = 1;\n  string model = 2;\n}';
const synFields = fieldsOf(synthetic, 'ReasonRequest');
const synMissing = REQUIRED.filter((f) => synFields.indexOf(f) === -1);
check('the field scanner reports a missing field (synthetic bad input)',
  synMissing.length === 2 && synMissing.indexOf('cognitive_mode') > -1,
  'detected: ' + synMissing.join(', '));
check('the field scanner sees a present field (synthetic good input)',
  synFields.indexOf('prompt') > -1 && synFields.indexOf('model') > -1);

console.log('');
console.log(fail === 0
  ? 'OK — ' + pass + ' checks green' + (skipped ? ', ' + skipped + ' skipped' : '')
  : 'FAILED — ' + fail + ' of ' + (pass + fail) + ' red');
process.exit(fail === 0 ? 0 : 1);
