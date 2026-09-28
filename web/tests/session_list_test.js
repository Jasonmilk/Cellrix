#!/usr/bin/env node
/* 经历列表**局部渲染**：侧栏按 period_id 复用卡片，不整块重建
 * （`session_list.js` 的 renderOne）。
 *
 * ── 为什么需要这条判据 ────────────────────────────────────────────────────
 *
 * 侧栏此前每次数据到达都 `box.innerHTML = head` 再重造**全部**卡片 —— 即
 * `setNav` 注释里记的旧 bug："每点一次卡就重建整个侧栏"（实测点卡会打两次
 * /api/sessions、列表滚回顶部、刚点的卡甩出视野）。卡片键 = `data-job`
 * （period_id，行自带身份），头部是独立键、只在计数变化时重建。
 *
 * ── 判据的技巧 ──────────────────────────────────────────────────────────
 *
 * 数 `document.createElement('div')`：重建一张卡 = 一个 div。头部按钮重绑、
 * 卡片 innerHTML 重写都会经同一计数器 —— 判据数的是"建了几个 div"，
 * 与账本数 tbody 同一思路。另有硬判据：既有卡片**节点对象必须不变**（`===`）。
 *
 * ── 判据必须真实咬合（变异注入） ──────────────────────────────────────────
 *
 * 若把 renderOne 退回整块重建（每次 `box.innerHTML = ...` + 重造全部卡片），
 * 本套件「同数据 ⇒ 零新建」与「卡片节点 === 不变」两条判据**必红**。
 * 套件内还用**同一份数据、新旧两个容器**做了对照：新容器首次渲染 = 全新建、
 * 旧容器再渲染 = 零新建 —— 判据分得清"该建的建了、不该建的不碰"。
 *
 * 纯逻辑 + jsdom，不需要真浏览器与活面板（与 `ledger_rows_test.js` 同款）。
 *
 * Usage: node session_list_test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (e) {
  console.log('  FAIL  jsdom 不可用：' + e.message + '（见 README 的 NODE_PATH 说明）');
  process.exit(2);
}

const ASSET = path.join(__dirname, '..', 'assets', 'session_list.js');
if (!fs.existsSync(ASSET)) { console.log('  FAIL  找不到 ' + ASSET); process.exit(2); }

const PAGE = '<!DOCTYPE html><html><body>' +
  '<div id="s-side"></div><div id="s-side2"></div><div id="chat-text"></div>' +
  '</body></html>';

const dom = new JSDOM(PAGE, { runScripts: 'outside-only' });
const w = dom.window;

const navState = { nav: { period: null } };
let renders = 0;
w.Cx = {
  esc: (s) => String(s),
  state: navState,
  setNav: (patch) => { Object.assign(navState.nav, patch); },
  loadWindow: () => Promise.resolve({ events: [], jobs: [] }),
  addMsg: () => {}, foldRow: () => {}, addReplyMsg: () => {}, parsePlan: () => ({}), selectPeriod: () => {},
  showToast: () => {}
};
w.CxWayout = {
  render: () => { renders++; },          /* 空态/失败态走 exit layer —— 只数调用 */
  build: () => w.document.createElement('div')
};

/* 数"建了几个卡片 div"（重建一张卡 = 一个 createElement('div')） */
let divs = 0;
const origCreate = w.document.createElement.bind(w.document);
w.document.createElement = function (t) {
  if (String(t).toLowerCase() === 'div') { divs++; }
  return origCreate(t);
};

w.eval(fs.readFileSync(ASSET, 'utf8'));
const L = w.CxSessionList;
if (!L || typeof L.renderSides !== 'function' || typeof L.moveSelection !== 'function') {
  console.log('  FAIL  资产未暴露 renderSides/moveSelection —— 套件与资产脱节，拒绝给结论');

/* ── ONE WRITER IN THE SIDEBAR (ADR-0048 §248): the tree owns it, the legacy path stands down ── */
{
  const dom2 = new JSDOM('<!doctype html><div id="s-side"></div>', { runScripts: 'outside-only' });
  const w2 = dom2.window;
  w2.eval(fs.readFileSync(path.join(__dirname, '..', 'assets', 'session_list.js'), 'utf8'));
  /* The tree is PRESENT: the legacy path must build nothing (otherwise the host holds BOTH surfaces,
   * which is the duplication the owner reported three times). */
  let mounted = 0;
  w2.CxPanelTree = { mountSidebar: function () { mounted++; } };
  w2.CxSessionList.renderSides(['s-side'], [p('pz'), p('py')], EMPTY);
  const host2 = w2.document.getElementById('s-side');
  check('tree present => the legacy path builds NO cards (one writer, not two)  ['
    + host2.querySelectorAll('[data-job]').length + ']',
    host2.querySelectorAll('[data-job]').length === 0);
  check('tree present => the tree is still asked to mount  [' + mounted + ']', mounted === 1);
  /* …and the fallback survives for the case where panel_tree.js is absent. */
  const dom3 = new JSDOM('<!doctype html><div id="s-side"></div>', { runScripts: 'outside-only' });
  const w3 = dom3.window;
  w3.eval(fs.readFileSync(path.join(__dirname, '..', 'assets', 'session_list.js'), 'utf8'));
  w3.CxSessionList.renderSides(['s-side'], [p('pz'), p('py')], EMPTY);
  const host3 = w3.document.getElementById('s-side');
  check('tree absent => the legacy list still renders, so the fallback survived  ['
    + host3.querySelectorAll('[data-job]').length + ']',
    host3.querySelectorAll('[data-job]').length === 2);
  dom2.window.close(); dom3.window.close();
}

  process.exit(1);
}

const box = w.document.getElementById('s-side');
const box2 = w.document.getElementById('s-side2');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
const p = (id, o) => Object.assign({
  period_id: id, job_id: id, first_ts: '2026-09-23T10:00:00Z', count: 1,
  name: '', preview: '', reply: '', model: ''
}, o || {});
const jobs = () => [].map.call(box.querySelectorAll('.ses-item'), function (el) {
  return el.getAttribute('data-job');
}).join(',');
const EMPTY = { code: 'trajectory-no-rows' };

/* ── 建立基线 ───────────────────────────────────────────────────────────── */
const three = [p('pa'), p('pb'), p('pc')];
L.renderSides(['s-side'], three, EMPTY);
check('三条记录 ⇒ 三个卡片 + 头部', box.querySelectorAll('.ses-item').length === 3
  && !!box.querySelector('.ses-head'), 'got ' + box.querySelectorAll('.ses-item').length);
check('顺序：与 API 返回一致（最新在前由数据层负责）', jobs() === 'pa,pb,pc', jobs());

/* ── 数据未变：一个节点都不该碰 ─────────────────────────────────────────── */
const anchorB = box.querySelector('[data-job="pb"]');
const anchorA = box.querySelector('[data-job="pa"]');
divs = 0;
L.renderSides(['s-side'], three, EMPTY);
check('同一份数据再渲染 ⇒ 零新建 div', divs === 0, '新建 ' + divs + ' 个');
check('卡片**节点对象未变**（DOM 状态得以保留）',
  box.querySelector('[data-job="pb"]') === anchorB && box.querySelector('[data-job="pa"]') === anchorA,
  'pa/pb 均在原位置找到同一节点');

/* ── 追加一条：只建新增的那一张 ─────────────────────────────────────────── */
divs = 0;
L.renderSides(['s-side'], three.concat([p('pd')]), EMPTY);
check('追加一条 ⇒ 四个卡片', box.querySelectorAll('.ses-item').length === 4, 'got ' + box.querySelectorAll('.ses-item').length);
check('只新建 1 张（新增的那条）', divs === 1, '新建 ' + divs + ' 个');
check('既有卡片节点未变 ⇒ 滚动位置/焦点可保留',
  box.querySelector('[data-job="pb"]') === anchorB && box.querySelector('[data-job="pa"]') === anchorA,
  'pa/pb 复用，pd 新建');

/* ── 顺序是独立于复用的一件事 ───────────────────────────────────────────── */
check('顺序：追加落位末尾、旧序不动', jobs() === 'pa,pb,pc,pd', jobs());
L.renderSides(['s-side'], [p('px'), p('pa'), p('pb'), p('pc'), p('pd')], EMPTY);
check('数据重排后顺序跟随（复用 + 移动，不重建）', jobs() === 'px,pa,pb,pc,pd', jobs());

/* ── 单卡内容变化：只更新那一张 ─────────────────────────────────────────── */
const anchorC = box.querySelector('[data-job="pc"]');
divs = 0;
L.renderSides(['s-side'], [p('px'), p('pa'), p('pb'), p('pc', { name: '改名后的经历' }), p('pd')], EMPTY);
check('单卡改名 ⇒ 不新建 div（复用 + 重写内容）', divs === 0, '新建 ' + divs + ' 个');
check('那张卡节点不变、标题文本更新',
  box.querySelector('[data-job="pc"]') === anchorC
  && (box.querySelector('[data-job="pc"] .nm') || {}).textContent === '改名后的经历',
  'pc 复用且 .nm 已更新');

/* ── 头部：计数变化才重建 ───────────────────────────────────────────────── */
L.renderSides(['s-side'], [p('pa'), p('pb')], EMPTY);
check('记录减少 ⇒ 卡片数跟随、头部计数更新',
  box.querySelectorAll('.ses-item').length === 2
  && (box.querySelector('.ses-head span') || {}).textContent.indexOf('2 条记录') > -1,
  'got ' + box.querySelectorAll('.ses-item').length);

/* ── 选中态：就地搬，不重建列表 ─────────────────────────────────────────── */
const beforeSel = box.querySelector('[data-job="pb"]');
navState.nav.period = 'pb';
L.renderSides(['s-side'], [p('pa'), p('pb')], EMPTY);
check('选中 pb ⇒ 该卡 sel + aria-current',
  box.querySelector('[data-job="pb"]').className.indexOf('sel') > -1
  && box.querySelector('[data-job="pb"]').getAttribute('aria-current') === 'true',
  box.querySelector('[data-job="pb"]').className);
check('选中只搬类，不重建节点', box.querySelector('[data-job="pb"]') === beforeSel, '');
navState.nav.period = 'pa';
L.moveSelection();
check('切到 pa ⇒ pb 去 sel、pa 得 sel，节点全不动',
  box.querySelector('[data-job="pb"]').className.indexOf('sel') === -1
  && box.querySelector('[data-job="pa"]').className.indexOf('sel') > -1
  && box.querySelector('[data-job="pb"]') === beforeSel,
  box.querySelector('[data-job="pa"]').className);

/* ── 空态 / 空→有 往返 ─────────────────────────────────────────────────── */
renders = 0;
L.renderSides(['s-side'], [], EMPTY);
check('空列表 ⇒ exit-layer 渲染一次', renders === 1, 'renders ' + renders);
L.renderSides(['s-side'], [], EMPTY);
check('空态没变 ⇒ 不再渲染', renders === 1, 'renders ' + renders);
L.renderSides(['s-side'], [p('pa'), p('pb')], EMPTY);
check('空态后回来 ⇒ 卡片恢复、无旧空态叠加',
  box.querySelectorAll('.ses-item').length === 2 && !box.querySelector('.wo-'),
  'got ' + box.querySelectorAll('.ses-item').length);

/* ── 判据咬合自证：同一份数据，新容器 vs 旧容器 ───────────────────────────
   * 新容器首次渲染 = 全新建（divs > 0）；旧容器同数据再渲染 = 零新建。
   * 判据能区分"该建的建了"与"不该建的不碰" —— 若把实现退回整块重建，
   * 旧容器也会变全新建，下面这条对比必红。 */
divs = 0;
L.renderSides(['s-side2'], [p('pa'), p('pb')], EMPTY);
const freshDivs = divs;
check('新容器首渲 = 全新建（判据数得出重建）', freshDivs > 0, '新建 ' + freshDivs + ' 个');
divs = 0;
L.renderSides(['s-side'], [p('pa'), p('pb')], EMPTY);
check('旧容器同数据再渲 = 零新建（判据数得出复用）', divs === 0, '新建 ' + divs + ' 个');

console.log('');
/* ── A LABEL MUST DISTINGUISH (ADR-0048 §255) ──
 * Measured on the live payload: every period's `name` is null and a conversation's rounds share a
 * timestamp TO THE MINUTE, so the old fallback ("经历 <date> <time>") labelled every card identically.
 * The fixture therefore uses the SAME timestamp and different previews: the old code makes both labels
 * equal (this goes red), the new code labels each by the user's own words. */
{
  const dom4 = new JSDOM('<!doctype html><div id="s-side"></div>', { runScripts: 'outside-only' });
  const w4 = dom4.window;
  w4.eval(fs.readFileSync(path.join(__dirname, '..', 'assets', 'session_list.js'), 'utf8'));
  const A = { period_id: 'run-aa-p0000000000000001', first_ts: '2026-09-29T01:00:00Z', preview: '很高兴再见!!!' };
  const B = { period_id: 'run-bb-p0000000000000002', first_ts: '2026-09-29T01:00:00Z', preview: '你好,明天见' };
  w4.CxSessionList.renderSides(['s-side'], [A, B], EMPTY);
  const host4 = w4.document.getElementById('s-side');
  const labels = Array.prototype.map.call(host4.querySelectorAll('[data-job]'),
    function (e) { return e.textContent.replace(/\s+/g, ' ').trim(); });
  check('two periods in the SAME MINUTE with different previews get DIFFERENT labels  [' + labels.join(' | ') + ']',
    labels.length === 2 && labels[0] !== labels[1]);
  check('and the label is the user own words, not a raw id  [' + (labels[0] || '') + ']',
    (labels[0] || '').indexOf('很高兴再见') >= 0);
  check('MUTATION: the old fallback (经历 + timestamp) made both labels EQUAL — the fixture uses one timestamp',
    A.first_ts === B.first_ts);
  /* A missing count must read as ABSENT, never as the word `undefined` (§255). */
  check('a period with no count says 未计量, not undefined  [' + (labels[0] || '') + ']',
    (labels[0] || '').indexOf('undefined') < 0 && (labels[0] || '').indexOf('未计量') >= 0);
  /* EACH FACT ONCE (§256): the preview is the title now, so it must not also appear as a body line. */
  const occurrences = (labels[0] || '').split('很高兴再见!!!').length - 1;
  check('the preview appears EXACTLY ONCE in one card  [' + occurrences + ']', occurrences === 1);
  check('MUTATION: before this change the same sentence appeared twice (title + preview line)',
    (labels[0] || '').indexOf('run-aa-p0000') < 0,
    'and the id is a 6-char suffix, not a 12-char prefix');
  check('the id survives as a short suffix  [' + (labels[0] || '').slice(-6) + ']',
    (labels[0] || '').indexOf('000001') >= 0);
  dom4.window.close();
}

/* ── NAME THE FLATNESS (ADR-0048 §257) ──
 * Measured: 50 of 61 periods carry no parent, so a conversation of n rounds renders as n cards that
 * differ only by time. "Lineage not recorded" is a different fact from "one round", so it is named. */
{
  const mk = (id, job, parent) => ({ period_id: id, job_id: job, parent: parent || null,
    first_ts: '2026-09-29T02:00:00Z', preview: 'p-' + id, reply: 'r' });
  const dom5 = new JSDOM('<!doctype html><div id="s-side"></div>', { runScripts: 'outside-only' });
  const w5 = dom5.window;
  w5.eval(fs.readFileSync(path.join(__dirname, '..', 'assets', 'session_list.js'), 'utf8'));
  /* Job A: 3 rounds, NO lineage (the measured shape). */
  w5.CxSessionList.renderSides(['s-side'], [mk('a1','jobA'), mk('a2','jobA'), mk('a3','jobA')], EMPTY);
  const h5 = w5.document.getElementById('s-side');
  check('a conversation with SEVERAL rounds and NO lineage says so, per card  ['
    + h5.querySelectorAll('[data-flat="unlinked"]').length + ']',
    h5.querySelectorAll('[data-flat="unlinked"]').length === 3);
  check('and it states the count  [' + (h5.querySelector('[data-flat="unlinked"]') || {}).textContent + ']',
    /3 轮平铺/.test((h5.querySelector('[data-flat="unlinked"]') || {}).textContent || ''));
  check('the header carries the DERIVED aggregate  [' + (h5.querySelector('.ses-head') || {}).textContent + ']',
    /1 段未记录续接链/.test((h5.querySelector('.ses-head') || {}).textContent || ''));
  /* Job B: lineage IS recorded => no such label (the mutation that matters). */
  const dom6 = new JSDOM('<!doctype html><div id="s-side"></div>', { runScripts: 'outside-only' });
  const w6 = dom6.window;
  w6.eval(fs.readFileSync(path.join(__dirname, '..', 'assets', 'session_list.js'), 'utf8'));
  w6.CxSessionList.renderSides(['s-side'], [mk('b1','jobB'), mk('b2','jobB','b1')], EMPTY);
  const h6 = w6.document.getElementById('s-side');
  check('a conversation WITH lineage carries no flatness label  ['
    + h6.querySelectorAll('[data-flat="unlinked"]').length + ']',
    h6.querySelectorAll('[data-flat="unlinked"]').length === 0);
  check('MUTATION: the label is driven by the DATA (linked count), not by a constant',
    h5.querySelectorAll('[data-flat="unlinked"]').length !== h6.querySelectorAll('[data-flat="unlinked"]').length);
  dom5.window.close(); dom6.window.close();
}

console.log((fail ? 'FAILED' : 'OK') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
