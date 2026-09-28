/* code_language_test — CODE AND COMMENTS ARE ENGLISH (owner's standing rule).
 *
 * The rule is not "we will remember": it is enforced here for the files this workstream authors,
 * and the un-cleaned remainder is REPORTED rather than silently tolerated. UI strings are out of
 * scope: the panel is Chinese-facing, so user-visible text keeps the product's language while
 * identifiers and comments stay English.
 *
 * Hermetic by design: it reads only Cellrix-owned files (no sibling repo, no live stack).
 */
const fs = require('fs'), path = require('path');
const ASSETS = path.join(__dirname, '..', 'assets');

/* Files whose comments this workstream has made English. The list GROWS as the backlog is paid
 * down; every entry is asserted clean, so a regression in any of them fails this criterion. */
const CLEAN = ['panel_tree.js'];

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };
const CJK = /[\u4e00-\u9fff]/;
const isCommentLine = (l) => {
  const s = l.trim();
  return s.startsWith('//') || s.startsWith('/*') || s.startsWith('*');
};
const cjkCommentLines = (text) => text.split('\n')
  .map((l, i) => ({ n: i + 1, l: l }))
  .filter((x) => CJK.test(x.l) && isCommentLine(x.l));

CLEAN.forEach((f) => {
  const text = fs.readFileSync(path.join(ASSETS, f), 'utf8');
  const hits = cjkCommentLines(text);
  ok(hits.length === 0, f + ': no non-English COMMENT lines'
    + (hits.length ? '  [' + hits.map((h) => h.n).join(',') + ']' : ''));
});

/* The backlog is a number, printed every run — a count that is never read is how a rule dies. */
const all = fs.readdirSync(ASSETS).filter((f) => f.endsWith('.js'));
let backlog = 0, backlogFiles = [];
all.forEach((f) => {
  const hits = cjkCommentLines(fs.readFileSync(path.join(ASSETS, f), 'utf8'));
  if (hits.length) { backlog += hits.length; backlogFiles.push(f + '(' + hits.length + ')'); }
});
console.log('  NOTE  backlog: ' + backlog + ' non-English comment line(s) remain in ' + backlogFiles.length
  + ' asset file(s) [' + backlogFiles.slice(0, 6).join(' ') + (backlogFiles.length > 6 ? ' …' : '') + ']');

/* MUTATION: the detector must be able to fail — inject one non-English comment into a clean file. */
const sample = '/* ' + '\u6d4b\u8bd5' + ' */\n';   /* "test" in Chinese, built from escapes */
/* RELATIVE, not absolute: the first version asserted `=== 1`, which silently assumed the file was
 * already clean — so the criterion broke the moment it correctly found something. A criterion that
 * assumes its own premise cannot report a regression in that premise. */
const base = cjkCommentLines(fs.readFileSync(path.join(ASSETS, CLEAN[0]), 'utf8')).length;
const withSample = cjkCommentLines(fs.readFileSync(path.join(ASSETS, CLEAN[0]), 'utf8') + sample).length;
ok(withSample === base + 1,
  'MUTATION: an injected non-English comment IS detected (' + base + ' -> ' + withSample + ')');

console.log(bad === 0 ? 'OK — the declared files keep English comments; the remaining backlog is counted'
  : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
