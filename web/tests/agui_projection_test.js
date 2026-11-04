/* 拿**真实生产路径**的一轮（10 行，LLM 为桩）做消费：断言投影形状与三层死亡判据的 L1/L3。 */
const fs = require('fs');
const assert = require('assert');
const { projectAll } = require('../assets/agui_projection.js');

const dir = process.argv[2];
assert.ok(dir, 'usage: node agui_projection_test.js <session-events-dir>');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.events.jsonl'));
assert.ok(files.length > 0, '读到空：目录里没有 events.jsonl（不是通过）');

let best = null;
for (const f of files) {
  const rows = fs.readFileSync(dir + '/' + f, 'utf8').trim().split('\n').map(JSON.parse);
  if (!best || rows.length > best.rows.length) best = { f, rows };
}
const out = projectAll(best.rows);
const types = out.map(e => e.type);

// L1 线层：五条标准事件齐、首尾正确
assert.strictEqual(types[0], 'RUN_STARTED', 'L1: 首条必须是 RUN_STARTED');
assert.strictEqual(types[types.length - 1], 'RUN_FINISHED', 'L1: 末条必须是 RUN_FINISHED');
for (const t of ['TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END']) {
  assert.ok(types.includes(t), 'L1: 缺 ' + t);
}
// 不预画工具事件（本轮真实行里没有 tool/call）
assert.ok(!types.some(t => t.startsWith('TOOL_CALL')), 'L1: 无工具段却出现 TOOL_CALL_*');
// metadata 只挂 verdict
const fin = out[out.length - 1];
assert.deepStrictEqual(Object.keys(fin.metadata), ['verdict'], 'L3: metadata 只许有 verdict');
// L3 渲染层：能从投影恢复出文本内容
const content = out.find(e => e.type === 'TEXT_MESSAGE_CONTENT');
assert.ok(content && typeof content.delta === 'string', 'L3: 取不到正文增量');

console.log(JSON.stringify({
  file: best.f, rows: best.rows.length, agui_events: out.length,
  types, verdict: fin.metadata.verdict
}, null, 0));
console.log('OK: L1/L3 通过 · ' + out.length + ' 条 AG-UI 事件');
