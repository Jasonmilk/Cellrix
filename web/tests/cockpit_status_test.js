#!/usr/bin/env node
/* 账本状态列：未知不得冒充「通过」，也不得冒充「失败」（K-088 一族 / Q7 闭环）。
 *
 * ── 为什么这个套件必须存在于 JS 侧 ─────────────────────────────────────────
 *
 * `cockpit.js` 是经 `include_str!` **烧进二进制**的。所以 `cargo test` 只能对它
 * 做**子串断言**（`html.contains("window.CxCockpit")` 那种）—— 那证明的是"这段
 * 文字在不在"，**不是"这段逻辑对不对"**。这正是本目录 README 开篇那条鸿沟：
 * 静态比对 + `cargo test` 证明不了浏览器实际收到什么。
 *
 * 本套件把该资产**从磁盘取来、在 stub 过的 `window` 下真正执行**，因此它检查的是
 * 行为。这正是 Q7 之前缺失的那一环：四处"缺席被当成一个值"全都在 JS 里，
 * 而当时没有任何东西能执行它们。
 *
 * `cockpit.js` 暴露 `classifyStatus` / `statusOf` 就是为了这件事（IIFE 一行注入）。
 *
 * ── 非空转 ────────────────────────────────────────────────────────────────
 * 每条判据都取自**实测到过的**形状：Tuck `Decision` 的四个变体（逐字来自
 * `tuck-core/src/lib.rs`）、码注册表的 `E-*`/`W-*` 严重度前缀、以及
 * `Tuck/gateway-audit.jsonl` 里 1409 条真实记录的字段路径。
 * 边界匹配另有一组**反面用例**（`"HARDOVERRIDE"` 必须不是 ok），
 * 用来钉住"子串匹配会造出假阳性"这件事。
 *
 * Usage: node cockpit_status_test.js
 */
'use strict';
const path = require('path');

const ASSET = path.join(__dirname, '..', 'assets', 'cockpit.js');

/* 载入资产所需的**最小**宿主：IIFE 顶层只读 `window.Cx`（`render` 里用 `Cx.esc`，
 * 本套件不调用 render，故只需一个占位）。刻意不拉 jsdom —— 这里测的是纯分类逻辑，
 * 不需要 DOM；需要 DOM 的几何判据另有 `layout_test.js`（真浏览器）。 */
global.window = { Cx: { esc: function (s) { return String(s); } } };
require(ASSET);
const C = global.window.CxCockpit;

let pass = 0, fail = 0;
function check(label, cond, detail) {
  const tail = detail ? '  [' + detail + ']' : '';
  if (cond) { pass++; console.log('  PASS  ' + label + tail); }
  else { fail++; console.log('  FAIL  ' + label + tail); }
}

if (!C || typeof C.classifyStatus !== 'function' || typeof C.statusOf !== 'function') {
  console.log('  FAIL  资产未暴露 classifyStatus/statusOf —— 套件与资产脱节，拒绝给结论');
  process.exit(1);
}

/* ── 1. 真实判定词表：Tuck `Decision` 四变体逐字 ───────────────────────────── */
check('Pass ⇒ ok', C.classifyStatus('Pass') === 'ok');
check('HardOverridePass ⇒ ok（须显式列出：它以 HARDOVERRIDE 开头）',
  C.classifyStatus('HardOverridePass') === 'ok');
check('Reject ⇒ bad', C.classifyStatus('Reject') === 'bad');
check('NeedHumanConfirm ⇒ warn（真实判定、需要人看，不是"判不出"）',
  C.classifyStatus('NeedHumanConfirm') === 'warn');

/* ── 2. 码注册表 `E-*`/`W-*`：子串猜测必漏 ────────────────────────────────── */
check('E-RISK-MISSING ⇒ bad（既不含 ERR 也不含 WARN）',
  C.classifyStatus('E-RISK-MISSING') === 'bad');
check('W-RISK-UNKNOWN ⇒ warn', C.classifyStatus('W-RISK-UNKNOWN') === 'warn');
check('W-VERSION-MISMATCH ⇒ warn', C.classifyStatus('W-VERSION-MISMATCH') === 'warn');
check('E-META-FIELD ⇒ bad', C.classifyStatus('E-META-FIELD') === 'bad');

/* ── 3. 未知一律 unknown，**绝不落绿**（K-088 的核心） ────────────────────── */
check('空串 ⇒ unknown', C.classifyStatus('') === 'unknown');
check("'?' ⇒ unknown（原实现正是把 '?' 渲染成绿）", C.classifyStatus('?') === 'unknown');
check('无意义串 ⇒ unknown', C.classifyStatus('whatever') === 'unknown');
check('undefined ⇒ unknown', C.classifyStatus(undefined) === 'unknown');

/* ── 4. 边界匹配：不得在**词中间**找到"证据" ──────────────────────────────────
 *
 * 判据是「整个串相等，或串**以**词条开头」。刻意**不做**任意位置子串匹配 ——
 * 原实现在这里出过错：`"HARDOVERRIDEPASS".indexOf("E-")` 能命中（`OVERRIDE-`
 * 里那个 `E-`），把 Tuck 的合法判定判成"坏"。
 *
 * ⚠️ 注意**前缀命中是刻意的、也是对的**：`REJECTED` 以 `REJECT` 开头 ⇒ bad，
 * `WARNING` 以 `WARN` 开头 ⇒ warn。这不是漏判，而是这类有版本/后缀的码的正常
 * 匹配方式（注册表码是 `E-*`/`W-*`，判定码可带后缀）。**写本套件时我先把这两条
 * 期望写成了 unknown，是期望错了，不是代码错了** —— 记此以免下一人"修"回去。 */
check('"HARDOVERRIDE" 不得是 ok（它不以 PASS 开头，且 E- 在词中间不算证据）',
  C.classifyStatus('HARDOVERRIDE') !== 'ok');
check('"REJECTED" ⇒ bad（以 REJECT 开头 = 前缀命中，刻意）',
  C.classifyStatus('REJECTED') === 'bad');
check('"WARNING" ⇒ warn（以 WARN 开头 = 前缀命中，刻意）',
  C.classifyStatus('WARNING') === 'warn');
/* 反面：`E-` 只认**串首**，不在词中间认 */
check('"SOME-E-THING" ⇒ unknown（E- 在词中间，不算证据）',
  C.classifyStatus('SOME-E-THING') === 'unknown');

/* ── 5. `statusOf` 走**真实**记录形状（Tuck gateway-audit.jsonl） ──────────── */
const REAL_REQ = {
  seq: 0, ts: '2026-09-07T05:28:00Z',
  payload: {
    kind: 'request',
    data: { action: 'forward', messages: [{ action: 'pass' }] },
    trace_id: 'live#1'
  }
};
check('真实请求记录 ⇒ 取到判定而非事件类型',
  C.statusOf(REAL_REQ) === 'forward', 'got ' + JSON.stringify(C.statusOf(REAL_REQ)));
check('真实请求记录 ⇒ ok', C.classifyStatus(C.statusOf(REAL_REQ)) === 'ok');

/* `payload.kind` 是**事件类型**，不是判定 —— 它必须排在 `messages[].action` 之后。
 * 这一条是回归网：初版把 kind 排在前面，1409 条真实记录**全判 unknown**。 */
const KIND_ONLY = { seq: 1, payload: { kind: 'response', data: {}, trace_id: 't' } };
check('只有 kind 时 ⇒ 仍返回判定槽位的角度上是"没有判定"（kind 不当判定用）',
  C.classifyStatus(C.statusOf(KIND_ONLY)) === 'unknown',
  'got ' + JSON.stringify(C.statusOf(KIND_ONLY)));

/* 顶层**没有** status/record_type 是原实现恒绿的根因；这里钉住"取不到就是空"。 */
check('空记录 ⇒ 空串，不猜', C.statusOf({}) === '', 'got ' + JSON.stringify(C.statusOf({})));

/* 显式字段优先于启发式 */
check('顶层 status 优先', C.statusOf({ status: 'Reject' }) === 'Reject');
check('顶层 decision 亦被接受', C.statusOf({ decision: 'Pass' }) === 'Pass');

console.log('');
console.log((fail ? 'FAILED' : 'OK') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
