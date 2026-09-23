#!/usr/bin/env node
/* 账本**局部渲染**：按 key 复用行，不整表重建（`cockpit.js`）。
 *
 * ── 为什么需要这条判据 ────────────────────────────────────────────────────
 *
 * 账本此前是 `box.innerHTML = rows` —— 每次清空重造**全部**行。代价不只是 CPU：
 * **它抹掉 DOM 状态** —— 展开的 `<tr class="lt-open">`、滚动位置、焦点都会丢。
 * 数据每 2 秒到一次，于是用户展开一行后很难读下去。
 *
 * 本仓早有正确范式（`chat.js`：逐条 `createElement`、从不整块重建），这里把它
 * 按 key 做实，好让"数据到达"只影响**变了的那些行**。
 *
 * ── 判据的技巧：数 `tbody` 创建次数 ──────────────────────────────────────
 *
 * "重建了几行"很难直接观察，但 `cockpit.js` 每建一行都会 `createElement('tbody')`
 * 一次（用它当临时容器解析行 HTML）。于是**包住 `document.createElement` 计数**
 * 就是"重建了几行"的直接证据。
 *
 * ⚠️ 另有一条更硬的判据：**既有行的节点对象必须不变**（`===`）。只数重建次数
 * 会漏掉"拆掉又原样建回来"这种伪复用。
 *
 * 纯逻辑 + jsdom，**不需要真浏览器与活面板**（与 `hash_state_test.js` 同款）。
 *
 * Usage: node ledger_rows_test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (e) {
  console.log('  FAIL  jsdom 不可用：' + e.message + '（见 README 的 NODE_PATH 说明）');
  process.exit(2);
}

const ASSET = path.join(__dirname, '..', 'assets', 'cockpit.js');
if (!fs.existsSync(ASSET)) { console.log('  FAIL  找不到 ' + ASSET); process.exit(2); }

const PAGE = '<!DOCTYPE html><html><body>' +
  '<div id="episode"></div><div id="nledger"></div><div id="tick"></div>' +
  '<table><tbody id="entries"></tbody></table></body></html>';

const dom = new JSDOM(PAGE, { runScripts: 'outside-only' });
const w = dom.window;
w.Cx = { esc: (s) => String(s) };
w.CxWayout = { build: () => w.document.createElement('div') };

/* 数"重建了几行" */
let tbodies = 0;
const origCreate = w.document.createElement.bind(w.document);
w.document.createElement = function (t) {
  if (String(t).toLowerCase() === 'tbody') { tbodies++; }
  return origCreate(t);
};

w.eval(fs.readFileSync(ASSET, 'utf8'));
const C = w.CxCockpit;
if (!C || typeof C.render !== 'function') {
  console.log('  FAIL  资产未暴露 render —— 套件与资产脱节，拒绝给结论');
  process.exit(1);
}
const box = w.document.getElementById('entries');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
const rec = (id, st) => ({ entry_id: id, status: st, ts: '2026-09-23T00:00:00Z', payload: { data: { status: st } } });
const rows = () => box.querySelectorAll('tr.lt-row').length;
const snapOf = (list) => ({ episode: 'e', ledger: list });

/* ── 建立基线 ───────────────────────────────────────────────────────────── */
const two = [rec('a', 200), rec('b', 200)];
C.render(snapOf(two));
check('两条记录 ⇒ 两个数据行', rows() === 2, 'got ' + rows());

/* ── 数据未变：一个节点都不该碰 ─────────────────────────────────────────── */
tbodies = 0;
C.render(snapOf(two));
check('同一份数据再渲染 ⇒ 零行重建', tbodies === 0, '重建 ' + tbodies + ' 行');

/* ── 追加一条：只建新增的那一行 ─────────────────────────────────────────── */
const anchorRow = box.querySelectorAll('tr.lt-row')[1];   /* 数据里的 'a'（最新在前） */
tbodies = 0;
C.render(snapOf([rec('a', 200), rec('b', 200), rec('c', 400)]));
check('追加一条 ⇒ 三个数据行', rows() === 3, 'got ' + rows());
check('只重建 1 行（新增的那条）', tbodies === 1, '重建 ' + tbodies + ' 行');
check('既有行**节点对象未变**（DOM 状态得以保留）',
  box.querySelectorAll('tr.lt-row')[2] === anchorRow,
  anchorRow ? '在 index2 找到了同一个节点' : '无基线行');

/* 顺序是**独立于复用**的一件事：初版复用正确却把顺序插反了（旧→新），
 * 而当时没有断言顺序，所以套件是绿的。补上 —— 用显式 trace_id 才好读。 */
const withTid = (tid, st) => ({
  entry_id: tid, trace_id: tid, status: st, ts: '2026-09-23T00:00:00Z',
  payload: { data: { status: st } }
});
C.render(snapOf([withTid('r1', 200), withTid('r2', 200), withTid('r3', 400)]));
check('顺序：最新在前', (function () {
  var tids = box.querySelectorAll('tr.lt-row .lt-c-tid');
  return tids.length === 3 && tids[0].textContent === 'r3' && tids[2].textContent === 'r1';
})(), (function () {
  return [].map.call(box.querySelectorAll('tr.lt-row .lt-c-tid'), function (x) { return x.textContent; }).join(',');
})());

/* ── 再不变 ─────────────────────────────────────────────────────────────── */
/* 必须与上一条**同一批记录**（同一个 helper）才谈得上"未变"：
 * 先前这里用了另一个 helper（key 与 trace_id 都不同），缓存当然不命中 ——
 * 那是**测试写错**，不是实现有问题。 */
tbodies = 0;
C.render(snapOf([withTid('r1', 200), withTid('r2', 200), withTid('r3', 400)]));
check('再次未变 ⇒ 仍零重建', tbodies === 0, '重建 ' + tbodies + ' 行');

/* ── 单条判定变化：只重建那一条 ─────────────────────────────────────────── */
tbodies = 0;
C.render(snapOf([withTid('r1', 200), withTid('r2', 400), withTid('r3', 400)]));
check('单条内容变化 ⇒ 只重建那一条', tbodies === 1, '重建 ' + tbodies + ' 行');

/* ── 记录减少 / 空态往返 ────────────────────────────────────────────────── */
C.render(snapOf([rec('a', 200)]));
check('记录减少 ⇒ 行数跟随', rows() === 1, 'got ' + rows());
C.render(snapOf([]));
check('空账本 ⇒ 无数据行', rows() === 0, 'got ' + rows());
C.render(snapOf([rec('z', 200)]));
check('空态后回来 ⇒ 恰好 1 行（占位行已撤，未与旧行叠加）', rows() === 1, 'got ' + rows());

/* ── 判定仍按已修的语义渲染（K-088 一族的回归位） ───────────────────────── */
C.render(snapOf([rec('r', 400)]));
const chipCls = (box.querySelector('.chip') || {}).className || '';
check('被拒的记录 ⇒ 红色 chip（不是绿）', chipCls.indexOf('e-bad') > -1, chipCls);

console.log('');
console.log((fail ? 'FAILED' : 'OK') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
