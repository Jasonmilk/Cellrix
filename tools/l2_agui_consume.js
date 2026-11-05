/* L2 薄消费层：**不复制投影规则**，只消费 anaphase 投影出的标准事件
 * （唯一真源 = anaphase `src/agui.rs`，经 `cargo run --bin agui` 产出 JSONL）。
 * 判据：改 Rust 映射 ⇒ 本文件不动也跟着变（单源验证）。 */
const fs = require('fs');
const assert = require('assert');
const file = process.argv[2];
assert.ok(file, 'usage: node l2_agui_consume.js <agui-events.jsonl>');
const events = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const types = events.map(e => e.type);
assert.strictEqual(types[0], 'RUN_STARTED', 'L1: 首条 RUN_STARTED');
assert.strictEqual(types[types.length - 1], 'RUN_FINISHED', 'L1: 末条 RUN_FINISHED');
for (const t of ['TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END'])
  assert.ok(types.includes(t), 'L1: 缺 ' + t);
assert.ok(!types.some(t => t.startsWith('TOOL_CALL')), 'L1: 无工具段却出现 TOOL_CALL_*');
const fin = events[events.length - 1];
const keys = Object.keys(fin.metadata || {});
assert.ok(keys.length === 0 || (keys.length === 1 && keys[0] === 'verdict'), 'L3: metadata 只许为空或仅 verdict');
// 从已删的 l2_evidence_test.js 并进来两条有价值断言（其余"5 条/每条时间·阶段·一句话"是第二份定义，删）：
// ① 空输入必须非零退出（读到空不是通过）② 末条必须是 RUN_FINISHED（证轨必须收尾）
if (events.length === 0) { console.error('RED: 空投影 ⇒ 不是通过'); process.exit(1); }
const c = events.find(e => e.type === 'TEXT_MESSAGE_CONTENT');
assert.ok(c && typeof c.delta === 'string', 'L3: 取不到正文');
assert.strictEqual(types[types.length - 1], 'RUN_FINISHED', '证轨收尾: 末条必须是 RUN_FINISHED');
console.log('OK L2 消费 · ' + events.length + ' 条 · types=' + types.join(','));
