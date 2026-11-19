#!/usr/bin/env node
/**
 * agui_conformance.js —— 拿**官方** AG-UI 1.0 schema 副本量我们自己的投影读数。
 *
 * ★ 它是什么 / 不是什么（写在最前面，免得被当成合规证明）
 *   · 是：一个**自写的最小校验器**（不是官方 validator，也没有装官方 SDK）。
 *     规则只有两条：① 该事件定义的 `required` 是否齐；② `unevaluatedProperties:false` 下是否有额外键。
 *   · 不是：完整 JSON Schema 校验（不处理 oneOf/allOf/$ref 解析、类型/格式/枚举值）。
 *   ⇒ 任何"通过/不通过"的读数都必须带上「自写最小校验器 + schema sha」这两个限定。
 *
 * 用法：
 *   node tools/agui_conformance.js <events.jsonl>        # 报告（默认 rc=0，读数不是门）
 *   node tools/agui_conformance.js <events.jsonl> --fail-on-deviation   # 有偏离 ⇒ rc=1
 *
 * schema 来源：docs/observations/refs/ag-ui-1.0-schema.json（冻结副本，README 里写了取用命令与 sha）
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SCHEMA = path.join(ROOT, 'docs', 'observations', 'refs', 'ag-ui-1.0-schema.json');
const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const failOnDeviation = args.includes('--fail-on-deviation');

if (!file) {
  console.error('UNMEASURABLE: 需要 <events.jsonl>（bin/agui 的输出）');
  process.exit(4);
}
if (!fs.existsSync(SCHEMA)) {
  console.error('UNMEASURABLE: 缺官方副本 ' + path.relative(ROOT, SCHEMA) + '（见 refs/README.md 的取用命令）');
  process.exit(4);
}

const schemaRaw = fs.readFileSync(SCHEMA, 'utf8');
const schemaSha = crypto.createHash('sha256').update(schemaRaw).digest('hex').slice(0, 16);
const schema = JSON.parse(schemaRaw);
const defs = schema.$defs || schema.definitions || {};

/** 按 `properties.type.const` 把一条事件对到官方定义上；对不到 ⇒ null（不猜） */
function definitionFor(ev) {
  const t = ev && ev.type;
  for (const [name, def] of Object.entries(defs)) {
    const c = ((def.properties || {}).type || {}).const;
    if (c !== undefined && c === t) return { name, def };
  }
  return null;
}

function checkOne(ev) {
  const hit = definitionFor(ev);
  if (!hit) return { type: ev && ev.type, def: null, missing: null, extra: null, verdict: 'NO_DEFINITION' };
  const props = Object.keys(hit.def.properties || {});
  const required = hit.def.required || [];
  const missing = required.filter(k => !(k in ev));
  const extraAll = Object.keys(ev).filter(k => !props.includes(k));
  /* 只有当该定义显式禁止额外键时，额外键才算偏离；否则如实标「未声明禁止」 */
  const forbidsExtra = hit.def.unevaluatedProperties === false || hit.def.additionalProperties === false;
  const extra = forbidsExtra ? extraAll : [];
  const verdict = missing.length || extra.length ? 'DEVIATES' : 'OK';
  return { type: ev.type, def: hit.name, missing, extra, extraUndeclared: forbidsExtra ? [] : extraAll, verdict };
}

const lines = fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim());
const events = lines.map(l => JSON.parse(l));
const rows = events.map(checkOne);
const ok = rows.filter(r => r.verdict === 'OK').length;

console.log(`schema: ${path.relative(ROOT, SCHEMA)} · sha256_16=${schemaSha} · defs=${Object.keys(defs).length}`);
console.log(`校验器: 自写最小校验器（required + unevaluatedProperties:false），**非官方实现**`);
console.log(`输入: ${file} · 事件 ${rows.length} 条`);
for (const r of rows) {
  const bits = [];
  if (r.verdict === 'NO_DEFINITION') bits.push('官方 schema 里没有该 type 的定义');
  if (r.missing && r.missing.length) bits.push('缺必填=' + JSON.stringify(r.missing));
  if (r.extra && r.extra.length) bits.push('额外键=' + JSON.stringify(r.extra));
  if (r.extraUndeclared && r.extraUndeclared.length) bits.push('额外键（该定义未声明禁止）=' + JSON.stringify(r.extraUndeclared));
  console.log(`  ${String(r.type).padEnd(24)} def=${String(r.def || '—').padEnd(24)} ${r.verdict}${bits.length ? ' · ' + bits.join(' · ') : ''}`);
}
console.log(`结果: ${ok}/${rows.length} 通过（**这是自写校验器对官方副本的读数，不是官方判定**）`);

if (failOnDeviation && ok !== rows.length) process.exit(1);
process.exit(0);
