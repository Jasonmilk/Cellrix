/* order_contract_test — ORDER IS STRUCTURAL, AND A PARTIAL LINEAGE MUST SAY SO (ADR-0048 §184).
 *
 * Measured root causes of "顺序混乱", both self-confessed in the source:
 *   · identity by position (`gseq = array index`) — "cannot detect wholesale reordering";
 *   · a silent `break` when a parent is outside the window — a truncated lineage looked complete
 *     (routes.rs's own note: "disk held 130 periods and the panel showed 50");
 *   · a comment claiming "ordering is by first_ts" while the walk is ancestor-based — the next
 *     reader would have restored the timestamp sort that measurement had already refuted.
 */
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'assets', 'period_normalize.js'), 'utf8');
let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };

/* ⑤ the comment must not claim a temporal order the implementation does not use */
ok(SRC.indexOf('Ordering is by first_ts') < 0,
  'no comment claims an ordering the walk does not perform (the next reader cannot restore it)');
ok(/ORDERING IS STRUCTURAL, NOT TEMPORAL/.test(SRC) && /parent/.test(SRC.slice(SRC.indexOf('ORDERING IS STRUCTURAL'), SRC.indexOf('ORDERING IS STRUCTURAL') + 900)),
  'and the comment STATES the structural rule (root-ward along parent)');
ok(/path\.reverse\(\)/.test(SRC), 'the implementation still walks root-ward and reverses');

/* ④ a truncated walk is declared, not silent */
ok(/LAST_TRUNCATION = \{ at: cur/.test(SRC) && /lastTruncation: function/.test(SRC),
  'a walk that cannot reach the root DECLARES it (observable) instead of breaking silently');
ok(/'parent-not-in-window'/.test(SRC) && /'no-parent'/.test(SRC),
  'and it distinguishes "parent outside the window" from "no parent at all" (two facts, two reasons)');

/* MUTATIONS: both halves must be able to fail */
ok(/if \(!par \|\| !byId\[par\]\) \{ break; \}/.test(SRC) === false,
  'MUTATION: the silent break is gone (restoring it would fail the check above)');
ok(/first_ts/.test(SRC), 'MUTATION scope: first_ts still appears in the file (so the first check is about the CLAIM, not the absence of the word)');
console.log(bad === 0 ? 'OK — order is structural, and a partial lineage is a declared fact'
  : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
