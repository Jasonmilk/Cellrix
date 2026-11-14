/* D3 对照（死亡判据的渲染层）：把 **web/ 侧独立派生出的字段** 与 **L2 案卷** 逐项比。
 * 对照物由 web 代码机检提取（不是 L2 自己算一份再比自己——那是"自己对照自己"）。
 * 用法：node tools/d3_compare.js --baseline        # 产出/刷新对照表（web 侧唯一来源）
 *       node tools/d3_compare.js <casefile.json>   # 拿 L2 案卷与对照表比 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web', 'assets', 'prove_track.js');
const BASE = path.join(ROOT, 'docs', 'observations', 'd3-baseline.json');

function extract() {
  const src = fs.readFileSync(WEB, 'utf8');
  const derived = [...src.matchAll(/\bS\.([a-zA-Z]+)\s*=/g)].map(m => m[1]);
  const helpers = [...src.matchAll(/\bN\.([a-zA-Z]+)\(/g)].map(m => m[1]);
  const lanes = [...src.matchAll(/render(Lanes|Table|Stats)\(/g)].map(m => 'render' + m[1]);
  return {
    source: 'web/assets/prove_track.js',
    sha256_16: crypto.createHash('sha256').update(src).digest('hex').slice(0, 16),
    lines: src.split('\n').length,
    derived_fields: [...new Set(derived)].sort(),
    node_helpers: [...new Set(helpers)].sort(),
    renderers: [...new Set(lanes)].sort(),
    note: '只读提取：这些是 web 侧**从同一份 snapshot 派生**出来的字段（tape target，无自有数据源）'
  };
}

if (process.argv.includes('--baseline')) {
  const b = extract();
  fs.mkdirSync(path.dirname(BASE), { recursive: true });
  fs.writeFileSync(BASE, JSON.stringify(b, null, 1));
  console.error('已写入 ' + path.relative(ROOT, BASE) + ' · derived=' + b.derived_fields.length +
                ' helpers=' + b.node_helpers.length + ' renderers=' + b.renderers.length +
                ' · web sha ' + b.sha256_16);
  process.exit(0);
}

const casefile = process.argv[2];
if (!casefile || !fs.existsSync(casefile)) {
  console.error('UNMEASURABLE: 需要 L2 案卷 JSON（先跑 l2_casefile.js）');
  process.exit(4);
}
if (!fs.existsSync(BASE)) {
  console.error('UNMEASURABLE: 对照表缺失 ⇒ 先跑 --baseline（不允许 L2 自算一份对照物）');
  process.exit(4);
}
const base = JSON.parse(fs.readFileSync(BASE, 'utf8'));
const cf = (JSON.parse(fs.readFileSync(casefile, 'utf8')).casefile) || {};

/* 逐项对照：web 侧派生的字段 ←→ L2 案卷提供的键。**不做映射美化**，只报有/无/缺口。 */
const pairs = [
  ['选中边', 'selected_edges', 'steps'],
  ['时间/区间', 'support_reading', 'session'],
  ['用量', 'support_reading', 'usage'],
  ['按 turn 索引', 'selected_edges', 'turnIndex'],
  ['候选选择', 'candidate_edges', 'openTurns'],
  ['重复检测', 'unselected_reason', 'repeats']
];
const rows = pairs.map(([label, l2key, webKey]) => {
  const l2 = cf[l2key];
  const hasL2 = l2 !== undefined && l2 !== null;
  const namedGap = typeof l2 === 'string' && l2.startsWith('UNMEASURABLE');
  return {
    label,
    web_field: webKey,
    web_has: base.derived_fields.includes(webKey),
    l2_field: l2key,
    l2: hasL2 ? (namedGap ? 'UNMEASURABLE（具名缺口）' : '有') : '缺',
    verdict: hasL2 && !namedGap ? '对得上' : (namedGap ? '如实标缺（不假装完整）' : 'L2 缺')
  };
});
console.log(JSON.stringify({ baseline_sha: base.sha256_16, rows }, null, 1));
const bad = rows.filter(r => r.l2 === '缺');
if (bad.length) { console.error('RED: L2 有 ' + bad.length + ' 项连"具名缺口"都没写（静默缺失）'); process.exit(1); }
console.error('OK D3 对照：' + rows.length + ' 项逐条有交代（有 / 具名缺），无静默缺失');
