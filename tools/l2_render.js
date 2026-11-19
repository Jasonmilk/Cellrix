/* L2 渲染（tape 的只读 target，纯函数）：把 casefile + D3 对照渲染成一页证轨。
 * 铁律：不新增数据源（只吃 l2_casefile 的输出）· 缺口如实标"本 tape 未记录"· 不手填。
 * 用法：node tools/l2_render.js <casefile.json> <d3-compare.json> <out.html> */
const fs = require('fs');
const [cfPath, d3Path, out] = process.argv.slice(2);
if (!cfPath || !d3Path || !out) { console.error('UNMEASURABLE: 需要 <casefile> <d3> <out>'); process.exit(4); }
for (const p of [cfPath, d3Path]) if (!fs.existsSync(p)) { console.error('UNMEASURABLE: 缺 ' + p); process.exit(4); }
const cf = JSON.parse(fs.readFileSync(cfPath, 'utf8'));
const d3 = JSON.parse(fs.readFileSync(d3Path, 'utf8'));
const c = cf.casefile || {};

const isGap = v => typeof v === 'string' && v.startsWith('UNMEASURABLE');
const cell = v => isGap(v)
  ? '<span class="gap">本 tape 未记录<span class="why">' + v.replace(/^UNMEASURABLE\s*/, '') + '</span></span>'
  : (Array.isArray(v) ? v.map(x => '<li>' + x + '</li>').join('') : String(typeof v === 'object' ? JSON.stringify(v) : v));

const lanes = [
  ['抉择（候选→选中）', [['选中边', c.selected_edges || 'UNMEASURABLE'], ['候选边', c.candidate_edges || 'UNMEASURABLE']]],
  ['支撑读数', [['verdict', (c.support_reading || {}).verdict], ['session 行数', (c.support_reading || {}).session_rows]]],
  ['未选原因', [['为什么没走另一条边', c.unselected_reason || 'UNMEASURABLE']]],
  ['判定（verdict/status）', [['status', c.verdict_status && c.verdict_status.status ? c.verdict_status.status : c.verdict_status], ['checks/reason', c.verdict_status && c.verdict_status.reason ? (c.verdict_status.checks + ' · ' + c.verdict_status.reason) : '—']]],
  ['工具段（tool/call → TOOL_CALL_*）', [['本轮调用的工具', c.tool_calls || 'UNMEASURABLE']]],
  ['门与审计', [['HITL 四态（源=' + (((c.hitl || cf.hitl) && (c.hitl || cf.hitl)._source) || 'none') + '）', JSON.stringify(c.hitl || cf.hitl || {})], ['收尾', JSON.stringify(cf.end || {})]]]
];
const d3rows = (d3.rows || []).map(r => {
  const l2cell = String(r.l2 || '');
  const gap = l2cell.startsWith('UNMEASURABLE');
  return '<tr><td>' + r.label + '</td><td>' + r.web_field + (r.web_has ? ' ✓' : ' —') + '</td><td>' +
    (gap ? '<span class="gap">本 tape 未记录<span class="why">' + l2cell.replace(/^UNMEASURABLE[^）]*）?/, '') + '</span></span>'
         : l2cell) +
    '</td><td>' + r.verdict + '</td></tr>';
}).join('\n');

const html = `<!doctype html><meta charset="utf-8"><title>证轨 · ${cf.tape || ''}</title>
<style>body{font:14px/1.6 system-ui;margin:28px;color:#1d2733;background:#f7f9fa}
h1{font-size:17px;margin:0 0 4px}h2{font-size:12px;color:#8793a1;margin:22px 0 8px;letter-spacing:.4px}
.card{background:#fff;border:1px solid #e9edf0;border-radius:12px;padding:14px 18px;margin-bottom:12px}
.kv{display:grid;grid-template-columns:150px 1fr;gap:6px 14px}.kv dt{color:#8793a1}
li{margin:2px 0}.gap{color:#b8860b;background:#fdf6e3;border:1px dashed #e5c97b;border-radius:6px;padding:1px 7px}
.gap .why{color:#a08430;font-size:12px;margin-left:6px}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{border-bottom:1px solid #eef2f4;padding:5px 8px;text-align:left}
.foot{color:#aab4bf;font-size:12px;margin-top:16px}</style>
<h1>证轨 · 抉择案卷</h1>
<div style="color:#8793a1;font-size:12.5px">tape: ${cf.tape} · 只读投影，无编辑入口</div>
<div style="color:#8793a1;font-size:12.5px">period_id: ${cf.period_id || 'UNMEASURABLE（casefile 未带 period_id）'} · tape 行数: ${cf.tape_rows ?? 'UNMEASURABLE'} · begin/end 源: ${(cf._source && cf._source.begin) || '—'}</div>
${lanes.map(([name, rows]) => `<div class="card"><h2 style="margin:0 0 10px">${name}</h2><dl class="kv">` +
  rows.map(([k, v]) => `<dt>${k}</dt><dd>${cell(v)}</dd>`).join('') + '</dl></div>').join('\n')}
<div class="card"><h2 style="margin:0 0 10px">D3 对照（web 侧独立提取 · sha ${d3.baseline_sha || '?'}）</h2>
<table><tr><th>项</th><th>web 字段</th><th>L2</th><th>判定</th></tr>${d3rows}</table></div>
<div class="foot">缺口如实标注，不假装完整（VISION.md:408-410）。本页由 tools/l2_render.js 生成，勿手改。</div>`;
fs.writeFileSync(out, html);
const gaps = (html.match(/本 tape 未记录/g) || []).length;
console.error('已生成 ' + out + ' · 缺口标注 ' + gaps + ' 处 · D3 行 ' + (d3.rows || []).length);
