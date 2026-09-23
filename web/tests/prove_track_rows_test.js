#!/usr/bin/env node
/* 证轨**局部渲染**：轨迹表按 key 复用行，不整表重建（`prove_track.view.js`）。
 *
 * ── 为什么需要这条判据 ────────────────────────────────────────────────────
 *
 * 证轨此前是 `$('eTbody').innerHTML = h` —— 数据每 2 秒到一次，每次清空重造
 * **全部**行。代价不只是 CPU：展开的 turn、滚动位置、焦点都会丢（与账本同病，
 * 见 `ledger_rows_test.js`）。本仓已有正确范式（账本 keyed 复用），照它做实。
 *
 * ── 判据的技巧 ──────────────────────────────────────────────────────────
 *
 * 同账本：`renderTable` 重建一行会 `createElement('tbody')` 一次（临时模板容器），
 * 包住 `document.createElement` 数 `tbody` 就是"重建了几行"的直接证据。
 * 另有更硬的判据：**既有行的节点对象必须不变**（`===`）——只数次数会漏掉
 * "拆掉又原样建回来"的伪复用。
 *
 * ── 两条独立的事，两条都要断言 ────────────────────────────────────────────
 *
 * "节点有没有被重建"与"它排在哪里"无关：复用正确也可能把顺序排错（账本初版把
 * 旧→新插反、套件还是绿的，因为没有顺序断言）。本套件顺序用显式 id 序列断言。
 *
 * ── 判据必须真实咬合（变异注入） ──────────────────────────────────────────
 *
 * 若把 `renderTable` 退回整块重建（`$('eTbody').innerHTML = rows.join('')`），
 * 本套件「同数据 ⇒ 零重建」与「既有行节点 === 不变」两条判据**必红** ——
 * 判据是对"该重建的建、不该重建的不碰"的直接度量，不是对行为的转述。
 *
 * 纯逻辑 + jsdom，不需要真浏览器与活面板（与 `ledger_rows_test.js` 同款）。
 *
 * Usage: node prove_track_rows_test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (e) {
  console.log('  FAIL  jsdom 不可用：' + e.message + '（见 README 的 NODE_PATH 说明）');
  process.exit(2);
}

const ASSET = path.join(__dirname, '..', 'assets', 'prove_track.view.js');
if (!fs.existsSync(ASSET)) { console.log('  FAIL  找不到 ' + ASSET); process.exit(2); }

/* 证轨所需的最小 DOM（updTbl/updInsp 在加载时就绑 scroll/resize）：
 * eTblVp+eTblScroll、eTbody、eStats、eOvNote、三条 lane、eInspB（需父节点） */
const PAGE = '<!DOCTYPE html><html><body>' +
  '<div id="eTblVp"><div id="eTblScroll"></div></div>' +
  '<table><tbody id="eTbody"></tbody></table>' +
  '<div id="eStats"></div><div id="eOvNote"></div>' +
  '<div id="eLaneTool"></div><div id="eLaneCheck"></div><div id="eLaneVerdict"></div>' +
  '<div id="eInsp"><div id="eInspB"></div></div>' +
  '</body></html>';

const dom = new JSDOM(PAGE, { runScripts: 'outside-only' });
const w = dom.window;
w.matchMedia = undefined;   /* 关掉窄屏模态分支，jsdom 的 MediaQueryList 不可靠 */

/* 资产依赖的最小契约：PT.data / PT.render / CxEventFamily / CxWayout。
 * 全部手写 mock —— 本套件只测 view 的局部渲染，不代跑 data/render 层。 */
w.eval('window.CxEventFamily = { KIND_CLASS: { tool: "tool", reply: "reply", reasoning: "reasoning", plan: "plan" } };');
w.eval('window.CxWayout = { build: function () { return window.document.createElement("div"); } };');
w.eval('window.CxProveTrack = { data: {' +
  '  $: function (id) { return window.document.getElementById(id); },' +
  '  esc: function (s) { return String(s); },' +
  '  STATUS: { done: { c: "c-ok", t: "done" }, ok: { c: "c-ok", t: "ok" },' +
  '            fail: { c: "c-bad", t: "fail" }, pending: { c: "c-wait", t: "wait" } },' +
  '  fmtDur: function (d) { return (d || 0) + "s"; },' +
  '  fmtTok: function (t) { return (t || 0) + "t"; }' +
  '}, render: { LANE_OF: { tool: "tool", check: "check", verdict: "verdict" } } };');

/* 数"重建了几行"（同账本技巧：重建一行 = 一个 createElement('tbody')） */
let tbodies = 0;
const origCreate = w.document.createElement.bind(w.document);
w.document.createElement = function (t) {
  if (String(t).toLowerCase() === 'tbody') { tbodies++; }
  return origCreate(t);
};

w.eval(fs.readFileSync(ASSET, 'utf8'));
const C = w.CxProveTrack;
if (!C || typeof C.renderTable !== 'function' || typeof C.renderStats !== 'function') {
  console.log('  FAIL  资产未暴露 renderTable/renderStats —— 套件与资产脱节，拒绝给结论');
  process.exit(1);
}

const box = w.document.getElementById('eTbody');
const statsEl = w.document.getElementById('eStats');
const lanesEl = (name) => w.document.getElementById('eLane' + name.charAt(0).toUpperCase() + name.slice(1));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
const turn = (id, index) => ({ kind: 'turn', id, index, note: 'turn ' + index });
const ev = (id, o) => Object.assign({
  kind: 'ev', id, turn: 't1', cls: 'tool', status: 'done', summary: 'op ' + id, dur: 1, tok: 2,
  lane: 'tool', payload: null, full: null, repeat: 0, tool: 'op'
}, o || {});
const rowsSeq = () => [].map.call(box.querySelectorAll('tr'), function (tr) {
  var t = tr.getAttribute('data-e-ev');
  if (t) return 'e:' + t;
  var btn = tr.querySelector('[data-e-turntoggle]');
  return btn ? 't:' + btn.getAttribute('data-e-turntoggle') : '?';
}).join(',');
const set = (session) => { C.S.session = session; C.S.compact = false; C.S.openTurns = { t1: true, t2: true }; C.S.q = ''; };

/* ── 建立基线 ───────────────────────────────────────────────────────────── */
set([turn('t1', 1), ev('e1', {}), ev('e2', {})]);
C.renderTable();
check('一 turn 两 ev ⇒ 3 行（turn 头 + 2 ev）', box.querySelectorAll('tr').length === 3, 'got ' + box.querySelectorAll('tr').length);
check('顺序：turn 头在前，ev 依次在后', rowsSeq() === 't:t1,e:e1,e:e2', rowsSeq());

/* ── 数据未变：一个节点都不该碰 ─────────────────────────────────────────── */
const anchorEv = box.querySelector('tr[data-e-ev="e1"]');
const anchorTurn = box.querySelector('tr[data-e-turntoggle="t1"]');
tbodies = 0;
C.renderTable();
check('同一份数据再渲染 ⇒ 零行重建', tbodies === 0, '重建 ' + tbodies + ' 行');
check('既有行**节点对象未变**（DOM 状态得以保留）',
  box.querySelector('tr[data-e-ev="e1"]') === anchorEv && box.querySelector('tr[data-e-turntoggle="t1"]') === anchorTurn,
  'ev/turn 均在原位置找到同一节点');

/* ── 追加一条：只重建受影响的行 ───────────────────────────────────────────
   * turn 头显示 "· N events"，追加后计数变了 ⇒ 头必然重建（1）+ 新行（1）= 2；
   * 关键判据是**没变的那两行 ev 一个都不碰**。 */
const anchorEv2 = box.querySelector('tr[data-e-ev="e2"]');
tbodies = 0;
set([turn('t1', 1), ev('e1', {}), ev('e2', {}), ev('e3', {})]);
C.renderTable();
check('追加一条 ⇒ 4 行', box.querySelectorAll('tr').length === 4, 'got ' + box.querySelectorAll('tr').length);
check('只重建 2 行（turn 头计数变了 + 新增行）', tbodies === 2, '重建 ' + tbodies + ' 行');
check('未变的 ev 行节点不变 ⇒ 展开态/焦点可保留',
  box.querySelector('tr[data-e-ev="e1"]') === anchorEv && box.querySelector('tr[data-e-ev="e2"]') === anchorEv2,
  'e1/e2 复用，e3 新建');

/* ── 顺序是独立于复用的一件事：按显式 id 序列断言 ─────────────────────────── */
set([turn('t1', 1), ev('e1', {}), turn('t2', 2), ev('e2', { turn: 't2' }), ev('e3', { turn: 't2' })]);
C.renderTable();
check('顺序：turn/ev 交错仍按 session 顺序', rowsSeq() === 't:t1,e:e1,t:t2,e:e2,e:e3', rowsSeq());
tbodies = 0;
C.renderTable();
check('再次未变 ⇒ 仍零重建（交错数据也复用）', tbodies === 0, '重建 ' + tbodies + ' 行');

/* ── 单行内容变化：只重建那一条 ─────────────────────────────────────────── */
const anchorE2 = box.querySelector('tr[data-e-ev="e2"]');
tbodies = 0;
set([turn('t1', 1), ev('e1', {}), turn('t2', 2), ev('e2', { turn: 't2', summary: 'op e2 changed' }), ev('e3', { turn: 't2' })]);
C.renderTable();
check('单条内容变化 ⇒ 只重建那一条', tbodies === 1, '重建 ' + tbodies + ' 行');
check('内容变化的那条节点被替换、未变的那条仍是同一节点',
  box.querySelector('tr[data-e-ev="e2"]') !== anchorE2 && box.querySelector('tr[data-e-ev="e1"]') === anchorEv,
  'e2 重建、e1 复用');

/* ── 记录减少 / 空态往返 ────────────────────────────────────────────────── */
set([turn('t1', 1), ev('e1', {})]);
C.renderTable();
check('记录减少 ⇒ 行数跟随', box.querySelectorAll('tr').length === 2, 'got ' + box.querySelectorAll('tr').length);

let builds = 0;
const origBuild = w.CxWayout.build;
w.CxWayout.build = function (o) { builds++; return origBuild(o); };
set([]);
C.renderTable();
check('空表 ⇒ 恰好 1 个占位行', box.querySelectorAll('tr').length === 1, 'got ' + box.querySelectorAll('tr').length);
check('空态占位行**不是**数据行', !box.querySelector('tr[data-e-ev]'), '无 data-e-ev');
const buildsAfterEmpty = builds;
C.renderTable();
check('空态没变 ⇒ 占位行不重建', builds === buildsAfterEmpty, 'build 调用 ' + builds + ' 次');
set([turn('t1', 1), ev('e1', {})]);
C.renderTable();
check('空态后回来 ⇒ 行恢复且无旧占位叠加', box.querySelectorAll('tr').length === 2, 'got ' + box.querySelectorAll('tr').length);

/* ── 统计条与三根 lane：同数据轮询也不该重写 ─────────────────────────────── */
set([turn('t1', 1), ev('e1', {}), ev('e2', {})]);
C.S.usage = { total: 4, cached: 1, input: 3 };
C.renderStats(); C.renderLanes();
const statsSnapshot = statsEl.innerHTML;
const laneSnapshot = lanesEl('tool').innerHTML;
C.renderStats(); C.renderLanes();
check('同数据 ⇒ eStats 不重写', statsEl.innerHTML === statsSnapshot, '');
check('同数据 ⇒ lane 不重写', lanesEl('tool').innerHTML === laneSnapshot, '');
set([turn('t1', 1), ev('e1', {}), ev('e2', {}), ev('e3', {})]);
C.S.usage = { total: 6, cached: 2, input: 4 };
C.renderStats(); C.renderLanes();
check('数据变化 ⇒ eStats 更新', statsEl.innerHTML !== statsSnapshot, '');
check('数据变化 ⇒ lane 更新', lanesEl('tool').innerHTML !== laneSnapshot, '');

console.log('');
console.log((fail ? 'FAILED' : 'OK') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
