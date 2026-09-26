/* wordlist_parity_test — THE DOC'S VOCABULARY MUST EQUAL THE CODE'S (ADR-0048 §121 / A1-a).
 * Bidirectional on purpose: one-way containment only guards half (a doc type the code does
 * not accept would stay green). The diff is PRINTED when it fails, because a red that
 * cannot name what is missing says nothing. Both sides are parsed mechanically: hand-keeping
 * a second copy of the list would be a second source of truth.
 * Sibling repos are a DECLARED input; absent ⇒ declared SKIP with exit 4 (never a crash
 * that reads as a red — §118.1).
 */
const fs = require('fs');
const path = require('path');
const ANA = process.env.ANA_ROOT || path.join(__dirname, '..', '..', '..', 'Anaphase-Helix');
const CODE = path.join(ANA, 'src', 'session_events', 'types_and_stream.rs');
const DOC = path.join(ANA, 'docs', 'decisions', 'ADR-0026-session-event-stream.md');
const SKIP = 4;

function skip(msg) {
  console.log('  SKIPPED (declared): ' + msg);
  console.log('  This assertion reads the Anaphase checkout; set ANA_ROOT to it. Exit ' + SKIP + '.');
  process.exit(SKIP);
}
if (!fs.existsSync(CODE) || !fs.existsSync(DOC)) { skip('Anaphase sources not present at ' + ANA); }

/* CODE side: EventType::X => "type" */
const code = fs.readFileSync(CODE, 'utf8');
const codeTypes = Array.from(new Set((code.match(/EventType::\w+\s*=>\s*"([^"]+)"/g) || [])
  .map(function (m) { return /"([^"]+)"/.exec(m)[1]; })));

/* DOC side: table rows inside the §D2 section: | `type` | ... */
const doc = fs.readFileSync(DOC, 'utf8');
const d2 = doc.split('### D2')[1].split(/\n### /)[0];
const docTypes = Array.from(new Set((d2.match(/^\|\s*`([^`]+)`\s*\|/gm) || [])
  .map(function (m) { return /`([^`]+)`/.exec(m)[1]; })));

let bad = 0;
const say = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) bad++; };

/* SCOPE NON-EMPTY first: a parser that matched nothing would otherwise be "equal". */
say(codeTypes.length >= 11, 'scope: code vocabulary parsed >= 11 types (got ' + codeTypes.length + ')');
say(docTypes.length >= 11, 'scope: doc vocabulary parsed >= 11 types (got ' + docTypes.length + ')');

const missingInDoc = codeTypes.filter(function (t) { return docTypes.indexOf(t) === -1; });
const extraInDoc = docTypes.filter(function (t) { return codeTypes.indexOf(t) === -1; });
say(missingInDoc.length === 0, 'DOC ⊇ CODE' + (missingInDoc.length ? ' — missing in doc: ' + missingInDoc.join(', ') : ''));
say(extraInDoc.length === 0, 'CODE ⊇ DOC' + (extraInDoc.length ? ' — only in doc: ' + extraInDoc.join(', ') : ''));

if (process.argv[2]) {   /* mutation mode: compare against an alternative doc */
  const altDoc = fs.readFileSync(process.argv[2], 'utf8');
  const altD2 = altDoc.split('### D2')[1].split(/\n### /)[0];
  const altTypes = Array.from(new Set((altD2.match(/^\|\s*`([^`]+)`\s*\|/gm) || [])
    .map(function (m) { return /`([^`]+)`/.exec(m)[1]; })));
  const altMissing = codeTypes.filter(function (t) { return altTypes.indexOf(t) === -1; });
  console.log((altMissing.length ? '  ok   ' : '  FAIL ')
    + 'MUTATION PROBE — an alternative doc is detected as incomplete'
    + (altMissing.length ? ' (missing: ' + altMissing.join(', ') + ')' : ' (NOT detected!)'));
  process.exit(altMissing.length ? 0 : 1);
}
console.log(bad === 0 ? 'OK — the doc vocabulary equals the code vocabulary' : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
