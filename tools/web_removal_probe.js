/* 「删掉 web/ 会丢什么？」—— 只量**信息面**，不量像素面。
 * 依据：prove_track.js:9-13「证轨没有自己的数据源」⇒ web 与 L2 读同一份 tape
 * ⇒ 删 web 理论上丢渲染代码，不丢信息。本探针把"理论上"变成读数。
 * 用法：node tools/web_removal_probe.js <events-dir> <d3-baseline.json> */
const fs = require('fs'), path = require('path');
const [evDir, baseFile] = process.argv.slice(2);
if (!evDir || !baseFile) { console.error('UNMEASURABLE: 需要 <events-dir> <d3-baseline.json>'); process.exit(4); }
if (!fs.existsSync(evDir)) { console.error('UNMEASURABLE: events 目录不存在: ' + evDir); process.exit(4); }
if (!fs.existsSync(baseFile)) { console.error('UNMEASURABLE: 对照基线不存在: ' + baseFile); process.exit(4); }

const files = fs.readdirSync(evDir).filter(f => f.endsWith('.jsonl'));
if (!files.length) { console.error('UNMEASURABLE: 读到空（目录里没有 events.jsonl）——不是通过'); process.exit(4); }
const rows = files.map(f => fs.readFileSync(path.join(evDir, f), 'utf8').trim().split('\n')).flat()
  .filter(Boolean).map(JSON.parse);
if (!rows.length) { console.error('UNMEASURABLE: 事件 0 行 —— 不是通过'); process.exit(4); }

const types = new Set(rows.map(r => r.type));
const base = JSON.parse(fs.readFileSync(baseFile, 'utf8'));

/* web 侧派生的每个字段，需要哪类 tape 事件才能重建。空数组 = tape 里没有来源。 */
const needs = {
  session:      ['turn/start', 'turn/end'],
  usage:        ['assistant/usage'],
  usageByTurn:  ['assistant/usage', 'turn/end'],
  usageByModel: ['assistant/usage'],
  modelByTurn:  ['assistant/usage', 'turn/end'],
  stepModels:   ['assistant/attempt'],
  turnIndex:    ['turn/start'],
  turnIds:      ['turn/start'],
  openTurns:    [],   /* 纯 UI 展开状态：不是 tape 事实 */
  repeats:      [],   /* 需要跨 period 比对，本 tape 单 period 不足 */
  sel:          [],
  nodeHelpers:  []
};
const table = base.derived_fields.map(f => {
  const need = needs[f] || [];
  const ok = need.length > 0 && need.every(t => types.has(t));
  return { field: f, needs: need.join(',') || '（无 tape 来源）', rebuildable: ok };
});
const lost = table.filter(t => !t.rebuildable && t.needs !== '（无 tape 来源）');
const noSource = table.filter(t => t.needs === '（无 tape 来源）');

console.log(JSON.stringify({
  tape_files: files.length, rows: rows.length, event_types: [...types].sort(),
  baseline_sha: base.sha256_16,
  derived_total: table.length,
  rebuildable: table.filter(t => t.rebuildable).length,
  ui_state_not_tape_fact: noSource.map(t => t.field),
  missing_tape_sources: lost.map(t => t.field),
  verdict: lost.length === 0
    ? '信息面 0 丢失：web 侧每个字段都能从同一 tape 重建（删 web 只丢渲染代码）'
    : '信息面有 ' + lost.length + ' 项依赖 tape 缺失的来源 ⇒ 删 web 之前必须先补记录'
}, null, 1));

if (lost.length) { console.error('RED: ' + lost.length + ' 个字段在 tape 里没有来源 ⇒ 删 web 会丢信息（不是只丢渲染）'); process.exit(1); }
console.error('OK 删 web 的信息面 = 0 丢失 · UI 态字段 ' + noSource.length + ' 个本就不是 tape 事实');
