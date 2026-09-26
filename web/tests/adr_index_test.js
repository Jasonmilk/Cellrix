/* adr_index_test — THE ADR'S NAVIGATION LAYER, GENERATED FROM THE ADR (ADR-0048 §143).
 *
 * The problem this solves is CONTEXT ATTENTION, not disk: ADR-0048 is past 1400 lines, and a
 * review that re-reads it pays for every line. The fix is the same shape as the view layer:
 *   navigation (always loaded, one line per section)  +  detail (fetched by EXACT anchor §N).
 * By rule ⑰ the index must NOT be hand-written — a hand-kept index is a second source of truth
 * and drifts silently. So this suite GENERATES it from the ADR and reds when the committed copy
 * is stale. `--write` regenerates; without it, drift is a failure.
 */
const fs = require('fs');
const path = require('path');
const ADR = path.join(__dirname, '..', '..', 'docs', 'decisions',
  'ADR-0048-panel-state-owner-and-render-contract.md');
/* NOT under docs/decisions/ (ADR-0048 §145): that directory is for DECISIONS, and the repo
 * hook rejects a non-ADR there (it caught this file as "a reply pasted into an ADR"). The
 * index is a GENERATED artifact, so it lives beside the docs, not among the decisions. */
const OUT = path.join(__dirname, '..', '..', 'docs', 'ADR-0048.index.md');
const SRC = fs.readFileSync(ADR, 'utf8');

/* One line per `## N. Title`. The claim is the first sentence of the section (trimmed), so the
 * index answers "what does §N say" without loading §N. */
function build(src) {
  const lines = src.split('\n');
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^## (\d+)\.\s*(.+)$/.exec(lines[i]);
    if (!m) { continue; }
    let claim = '';
    for (let j = i + 1; j < lines.length && j < i + 12; j++) {
      const t = lines[j].trim();
      if (!t || t.startsWith('#') || t.startsWith('|') || t.startsWith('```')) { continue; }
      claim = t.replace(/\*\*/g, '').replace(/`/g, '').slice(0, 110);
      break;
    }
    /* Shape tag comes from the section body: the chain's three roots A/B/C + the recurrence R. */
    const body = lines.slice(i, Math.min(i + 40, lines.length)).join('\n');
    const tags = [];
    if (/逐位相同|可分辨|同形/.test(body)) { tags.push('C'); }
    if (/派生|单一来源|手写|第二份真相|表/.test(body)) { tags.push('B'); }
    if (/住在|DOM|输出|可观测/.test(body)) { tags.push('A'); }
    if (/治疗自己|下一个实例|新墙|复发/.test(body)) { tags.push('R'); }
    rows.push([m[1], m[2].trim(), tags.join('') || '-', claim]);
  }
  return rows;
}
const rows = build(SRC);
let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) { bad++; } };

const header = '# ADR-0048 索引（由 adr_index_test.js 生成，勿手改）\n\n'
  + '用法：按 **精确 §号** 取细则；本文件是常驻的导航层，不替代正文。\n\n'
  + '| § | 标题 | 形状 | 一句话 |\n|---|---|---|---|\n';
const text = header + rows.map(function (r) { return '| ' + r[0] + ' | ' + r[1] + ' | ' + r[2] + ' | ' + r[3] + ' |'; }).join('\n') + '\n';

if (process.argv[2] === '--write') { fs.writeFileSync(OUT, text); console.log('  wrote ' + OUT + ' (' + rows.length + ' sections)'); process.exit(0); }

ok(rows.length >= 20, 'scope: the ADR has >= 20 numbered sections (got ' + rows.length + ')');
ok(new Set(rows.map(function (r) { return r[0]; })).size === rows.length,
  'anchors: every § number is UNIQUE (an address must resolve to exactly one place)');
ok(fs.existsSync(OUT), 'the index exists (run with --write to generate it)');
if (fs.existsSync(OUT)) {
  const committed = fs.readFileSync(OUT, 'utf8');
  ok(committed === text, 'the committed index is UP TO DATE (a new § must regenerate it — no hand-kept list)');
}
/* MUTATION PROBE: a section added to a copy must make the generated index differ. */
const grown = SRC + '\n## 999. A section that only exists in this probe\n\nbody\n';
ok(build(grown).length === rows.length + 1,
  'MUTATION PROBE: adding a § is DETECTED (the index is generated, so growth cannot hide)');
console.log(bad === 0 ? 'OK — the ADR navigation layer is generated and current'
  : 'FAILED — ' + bad + ' check(s) red');
process.exit(bad ? 1 : 0);
