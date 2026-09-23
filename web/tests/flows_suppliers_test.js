#!/usr/bin/env node
/* Flows 视图·供应商配置 —— 面板代理 flowmodus 增删查的黑盒契约（jsdom）。
 *
 * ── 为什么需要这条判据 ────────────────────────────────────────────────────
 *
 * 供应商配置是新链路：浏览器 → 面板代理 /api/flowmodus/suppliers → flowmodus
 * /api/suppliers → registry 声明 + .secrets。三个不可错过的契约：
 *
 *   1. **API key 永不回显**：列表只呈现 `api_key_set`，渲染层若把 key 原文
 *      画进 DOM 即泄密 —— 判据必须咬住「KEY ✓ / 无 KEY」徽标分叉。
 *   2. **表单提交的 payload 形状**：models 逗号串 → 数组、tier 默认 paid、
 *      api_key 随 POST 上行（写进 .secrets 的是它）。
 *   3. **删除 URL**：DELETE 必须带 tier 与 id，否则 flowmodus 无从定位
 *      声明 + secret。
 *
 * ── Desk 判据（供应商 = 单一选择状态的一员，hash 可寻址） ───────────────────
 *
 *   4. 池列表可选中：点行 → 详情面板换、选中高亮换行、setNav({sup}) 同步。
 *   5. 编辑回填：表单拿详情数据回填，key 框**必须留空**（不回显）。
 *   6. 同一份数据重渲染 → 列表节点复用（keyed，不重建）。
 *   7. hash 指向的供应商 → 重载后仍选中（Back/Forward、刷新、分享都成立）。
 *
 * ── 判据必须真实咬合（变异注入） ──────────────────────────────────────────
 *
 * - 把 renderSuppliers 里的 `s.api_key_set ? 'KEY ✓' : '无 KEY'` 分支换成恒真
 *   ⇒ 「无 KEY 徽标」判据必红（泄漏形状被抓住）。
 * - 把表单 handler 的 `payload.models` 改成原样字符串 ⇒ 「models 数组化」必红。
 * - 把删除 handler 的 URL 去掉 id/tier ⇒ 「DELETE 带参」必红。
 * - 把 load() 里去掉 loadSuppliers() ⇒ 「两路数据各自独立拉取」必红。
 * - 把 renderDetail 直接输出 key 明文 ⇒ 「详情无明文」必红。
 * - 把 selectSupplier 去掉 setNav ⇒ 「hash 同步」必红。
 * - 把 renderSuppliers 的 keyed 复用换成 innerHTML 整块重建 ⇒ 「节点复用」必红。
 * - 把 renderSuppliers 去掉首选中 ⇒ 「首渲染详情打开」必红。
 *
 * 纯逻辑 + jsdom，不需要真浏览器与活面板（与 session_list_test.js 同款）。
 *
 * Usage: node flows_suppliers_test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (e) {
  console.log('  FAIL  jsdom 不可用：' + e.message + '（见 README 的 NODE_PATH 说明）');
  process.exit(2);
}

const HTML = path.join(__dirname, '..', 'assets', 'flows.html');
if (!fs.existsSync(HTML)) { console.log('  FAIL  找不到 ' + HTML); process.exit(2); }

const html = fs.readFileSync(HTML, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.log('  FAIL  flows.html 没有 <script> 块 —— 套件与资产脱节'); process.exit(1); }
const SCRIPT = m[1];

/* flows.html 的 script 是 IIFE，只暴露 window.CxFlows；所有行为经 DOM 事件
 * 驱动（黑盒，与真面板同路径）。页面需含 script 依赖的全部 id（含 Desk 的
 * 详情面板 fl-sup-detail 与列表容器 fl-sup-list）。 */
const PAGE = '<!DOCTYPE html><html><body>' +
  '<div id="view-flows">' +
  '<div id="fl-route"></div><div id="fl-stats"></div>' +
  '<div id="fl-free"></div><div id="fl-paid"></div><div id="fl-recent"></div>' +
  '<span id="fl-route-badge"></span><span id="fl-free-n"></span><span id="fl-paid-n"></span>' +
  '<span id="fl-stat-badge"></span><span id="fl-sup-n"></span>' +
  '<div id="fl-sup-list" class="fl-sup-listbox"></div>' +
  '<div id="fl-sup-detail"></div>' +
  '<form id="fl-sup-form">' +
  '<select name="tier"><option value="paid">paid</option><option value="free">free</option></select>' +
  '<input name="supplier_id"><input name="supplier_name">' +
  '<input name="base_url"><input name="models"><input name="api_key" type="password">' +
  '</form>' +
  '<div id="fl-sup-note"></div>' +
  '</div></body></html>';

const dom = new JSDOM(PAGE, { runScripts: 'outside-only' });
const w = dom.window;

/* 记录一切 fetch：按需加载（两路数据各自拉）、提交、删除都从这里走。 */
const calls = [];
const SUPPLIERS = [
  { supplier_id: 'deepseek', supplier_name: 'DeepSeek', tier: 'paid', verified: false,
    models: ['deepseek-chat', 'deepseek-reasoner'], base_url: 'https://api.deepseek.com/v1',
    updated_at_unix: 1, api_key_set: true,
    /* 模拟后端误发的泄漏响应：即使响应里带了明文 key，渲染层也绝不能画进 DOM。
     * 这一行让"key 绝不进 DOM"从空转判据变成真实防御。 */
    api_key: 'sk-leak-123' },
  { supplier_id: 'groq', supplier_name: 'Groq', tier: 'free', verified: false,
    models: ['llama-3.3-70b'], base_url: 'https://api.groq.com/openai/v1',
    updated_at_unix: 2, api_key_set: false }
];
const FLOWS = {
  current: { supplier_id: 'deepseek', model_id: 'deepseek-chat', endpoint_url: 'https://api.deepseek.com/v1', estimated_cost_usd: 0 },
  tiers: { free: [], paid: [{ supplier_id: 'deepseek' }] }
};
const STATS = { total: 3, kinds: { request: 1, response: 2 }, destinations: {}, actions: {}, tiers: {}, last_requests: [] };

function makeFetch(over) {
  return function (url, opts) {
    const u = String(url);
    const o = opts || {};
    calls.push({ url: u, method: o.method || 'GET', body: o.body || null });
    if (over && over(u, o)) return Promise.resolve({ json: () => Promise.resolve(over(u, o)) });
    if (u.startsWith('/api/flows')) {
      return Promise.resolve({ json: () => Promise.resolve({ flows: FLOWS, stats: STATS }) });
    }
    if (u.startsWith('/api/flowmodus/suppliers')) {
      if (o.method === 'DELETE') return Promise.resolve({ json: () => Promise.resolve({ ok: true, supplier_id: 'groq', tier: 'free' }) });
      if (o.method === 'POST') return Promise.resolve({ json: () => Promise.resolve({ ok: true, supplier_id: 'newsup', api_key_set: true }) });
      return Promise.resolve({ json: () => Promise.resolve({ suppliers: SUPPLIERS }) });
    }
    return Promise.resolve({ json: () => Promise.resolve({}) });
  };
}
w.fetch = makeFetch(null);

/* 空态/失败态走 exit layer —— 计数 + 真实清空容器（贴近 wayout.render 的
 * 替换语义，让"空池 ⇒ 无残留列表项"能作为硬判据成立） */
let zeroCalls = 0;
w.CxWayout = {
  render: (el) => { zeroCalls++; el.innerHTML = ''; },
  build: () => w.document.createElement('div')
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

w.eval(SCRIPT);
if (!w.CxFlows || typeof w.CxFlows.load !== 'function') {
  console.log('  FAIL  资产未暴露 CxFlows.load —— 套件与资产脱节，拒绝给结论');
  process.exit(1);
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
const of = (p) => calls.filter((c) => c.url.indexOf(p) === 0);

(async function () {
  /* ── 按需加载：进入视图才拉，两路数据各自独立 ───────────────────────────── */
  const before = calls.length;
  w.CxFlows.load();
  await sleep(20);
  const fmCalls = of('/api/flows');
  const supCalls = of('/api/flowmodus/suppliers');
  check('load 只拉两路数据（flows + suppliers，无其他）', fmCalls.length === 1 && supCalls.length === 1,
    'flows=' + fmCalls.length + ' suppliers=' + supCalls.length);
  check('两路都走面板代理（同源相对路径，不经文件路径耦合）',
    fmCalls[0] && fmCalls[0].url === '/api/flows' && supCalls[0] && supCalls[0].url === '/api/flowmodus/suppliers',
    (fmCalls[0] || {}).url + ' / ' + (supCalls[0] || {}).url);

  /* ── 渲染：key 状态徽标 / tier 徽标 / 删除按钮 ─────────────────────────── */
  const items = w.document.querySelectorAll('#fl-sup-list .fl-item');
  check('两个供应商 ⇒ 两个列表项', items.length === 2, 'got ' + items.length);
  const hasKeyTrue = w.document.querySelector('#fl-sup-list .fl-item[data-id="deepseek"]');
  const hasKeyFalse = w.document.querySelector('#fl-sup-list .fl-item[data-id="groq"]');
  check('paid+有 key ⇒ 「KEY ✓」徽标（真分支）', !!hasKeyTrue && hasKeyTrue.textContent.indexOf('KEY ✓') >= 0, hasKeyTrue && hasKeyTrue.textContent);
  check('free+无 key ⇒ 「无 KEY」徽标（假分支）', !!hasKeyFalse && hasKeyFalse.textContent.indexOf('无 KEY') >= 0, hasKeyFalse && hasKeyFalse.textContent);
  check('key 原文绝不进入 DOM', !w.document.body.textContent.match(/sk-[\w-]+/), 'body 无 sk- 明文');
  check('tier 徽标分叉（FREE/PAID）', !!hasKeyFalse && hasKeyFalse.textContent.indexOf('FREE') >= 0,
    hasKeyFalse && hasKeyFalse.textContent);
  check('每行一个删除按钮（触境 ≥44px 的类）', w.document.querySelectorAll('#fl-sup-list .fl-del').length === 2,
    'got ' + w.document.querySelectorAll('#fl-sup-list .fl-del').length);
  check('计数徽标 = 供应商数', w.document.getElementById('fl-sup-n').textContent === '2');

  /* ── 空列表 ⇒ 零态自证（exit layer 被调用） ────────────────────────────── */
  const z0 = zeroCalls;
  w.fetch = makeFetch((u) => (u.indexOf('/api/flowmodus/suppliers') === 0 ? { suppliers: [] } : null));
  w.CxFlows.load();
  await sleep(20);
  check('空池 ⇒ 零态（exit layer render 被调）', zeroCalls > z0, 'zero renders ' + z0 + ' -> ' + zeroCalls);
  check('空池不产生列表项', w.document.querySelectorAll('#fl-sup-list .fl-item').length === 0);
  check('空池 ⇒ 详情面板回零态（不悬空）',
    w.document.getElementById('fl-sup-detail').textContent.indexOf('点选左侧供应商') >= 0,
    w.document.getElementById('fl-sup-detail').textContent);

  /* ── 表单提交：payload 形状（models 数组化、key 随行、必填校验） ─────── */
  w.fetch = makeFetch(null);
  const form = w.document.getElementById('fl-sup-form');
  const set = (name, val) => { form.elements.namedItem(name).value = val; };
  const cBefore = calls.length;
  set('supplier_id', ''); set('base_url', '');
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  const afterEmpty = calls.length;
  check('必填校验：空 id/url 不发请求', afterEmpty === cBefore, 'calls ' + cBefore + ' -> ' + afterEmpty);
  check('必填校验给出提示', w.document.getElementById('fl-sup-note').textContent.indexOf('必填') >= 0,
    w.document.getElementById('fl-sup-note').textContent);

  set('tier', 'paid'); set('supplier_id', 'newsup'); set('supplier_name', 'New Sup');
  set('base_url', 'https://api.newsup.com/v1'); set('models', 'm-a, m-b,  m-c');
  set('api_key', 'sk-new-999');
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(20);
  const posts = calls.filter((c) => c.method === 'POST');
  const lastPost = posts[posts.length - 1];
  check('提交 ⇒ 一次 POST 到面板代理', !!lastPost && lastPost.url === '/api/flowmodus/suppliers', lastPost && lastPost.url);
  if (lastPost) {
    let payload = null;
    try { payload = JSON.parse(lastPost.body); } catch (e) { /* 见下 */ }
    check('payload 是合法 JSON', !!payload, lastPost.body);
    check('models 逗号串 ⇒ 数组（trim + 去空）', !!payload && JSON.stringify(payload.models) === JSON.stringify(['m-a', 'm-b', 'm-c']),
      payload && JSON.stringify(payload.models));
    check('api_key 随 POST 上行（.secrets 的写入源）', !!payload && payload.api_key === 'sk-new-999');
    check('tier / id / base_url 原样上行', !!payload && payload.tier === 'paid' && payload.supplier_id === 'newsup' &&
      payload.base_url === 'https://api.newsup.com/v1');
  }

  /* ── 删除：URL 必须带 tier 与 id ─────────────────────────────────────── */
  w.CxFlows.load();                 /* 重载出列表（按需驱动：列表空了先还原） */
  await sleep(20);
  const dl = w.document.querySelectorAll('#fl-sup-list .fl-del');
  dl[1].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));   /* groq / free */
  await sleep(20);
  const deletes = calls.filter((c) => c.method === 'DELETE');
  const lastDel = deletes[deletes.length - 1];
  check('删除 ⇒ 一次 DELETE', !!lastDel, 'got ' + deletes.length);
  check('DELETE 带 tier=free 与 id=groq（定位声明 + .secrets 的关键）',
    !!lastDel && lastDel.url === '/api/flowmodus/suppliers?tier=free&id=groq', lastDel && lastDel.url);

  /* ── Desk：选中 → 详情、编辑回填、keyed 复用、hash 同步/恢复 ─────────── */
  w.CxFlows.load();                 /* 回到两供应商列表 */
  await sleep(20);
  const list = w.document.getElementById('fl-sup-list');
  const detail = w.document.getElementById('fl-sup-detail');
  const rows = list.querySelectorAll('.fl-item');
  check('首渲染自动选中第一个 ⇒ 详情面板打开', rows.length === 2 && rows[0].className.indexOf('selected') >= 0,
    'rows=' + rows.length);
  check('详情显示选中供应商（id + 端点 + 模型）',
    detail.textContent.indexOf('deepseek') >= 0 && detail.textContent.indexOf('api.deepseek.com') >= 0 &&
    detail.textContent.indexOf('deepseek-chat') >= 0, detail.textContent.slice(0, 80));
  check('详情含 KEY ✓ 徽标且绝无 key 明文',
    detail.textContent.indexOf('KEY ✓') >= 0 && !detail.textContent.match(/sk-[\w-]+/), '无 sk- 明文');

  rows[1].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));   /* groq */
  await sleep(10);
  const rows2 = list.querySelectorAll('.fl-item');
  check('点击另一行 ⇒ 选中切换（高亮换行）',
    rows2[1].className.indexOf('selected') >= 0 && rows2[0].className.indexOf('selected') < 0);
  check('详情跟着换（groq / 无 KEY）',
    detail.textContent.indexOf('groq') >= 0 && detail.textContent.indexOf('无 KEY') >= 0, detail.textContent.slice(0, 80));

  const nodeRef = rows2[1];
  w.CxFlows.load();                 /* 同一份数据再渲染一次 */
  await sleep(20);
  const rows3 = list.querySelectorAll('.fl-item');
  check('同一份数据重渲染 ⇒ 列表节点复用（keyed，不重建）', rows3[1] === nodeRef,
    'node identity kept: ' + (rows3[1] === nodeRef));

  const editBtn = detail.querySelector('#fl-sup-edit');
  editBtn.click();
  check('编辑 ⇒ 表单回填（id/端点/models）',
    form.elements.namedItem('supplier_id').value === 'groq' &&
    form.elements.namedItem('base_url').value === 'https://api.groq.com/openai/v1' &&
    form.elements.namedItem('models').value === 'llama-3.3-70b');
  check('编辑 ⇒ key 框留空 + 提示「保持原 key」（永不回显）',
    form.elements.namedItem('api_key').value === '' &&
    form.elements.namedItem('api_key').placeholder.indexOf('保持原 key') >= 0,
    'placeholder=' + form.elements.namedItem('api_key').placeholder);
  check('编辑模式标记（提交走 edit 分支，保持选中）', form.dataset.mode === 'edit');

  /* hash 同步：注入壳（同一份单一选择状态）。点击行 → setNav({sup})。 */
  const navSpy = [];
  w.Cx = {
    state: { nav: { view: 'chat', period: null, panel: 'flows', sup: 'groq' } },
    setNav: (p) => { navSpy.push(p); }
  };
  rows3[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));   /* deepseek */
  await sleep(10);
  check('选中 ⇒ setNav({sup}) 同步（hash 可寻址）',
    navSpy.length >= 1 && navSpy[navSpy.length - 1].sup === 'deepseek',
    JSON.stringify(navSpy[navSpy.length - 1] || {}));

  /* hash 恢复：预设 nav.sup=deepseek → 重载 → 仍选中它（刷新/分享成立） */
  w.Cx.state.nav.sup = 'deepseek';
  w.CxFlows.load();
  await sleep(20);
  const rows4 = list.querySelectorAll('.fl-item');
  check('hash 指向的供应商 ⇒ 重载后仍选中（可寻址恢复）',
    rows4[0].className.indexOf('selected') >= 0 && detail.textContent.indexOf('deepseek') >= 0,
    detail.textContent.slice(0, 60));

  /* 详情面板的删除按钮走同一个删除入口（单一职责） */
  const cDel2 = calls.length;
  detail.querySelector('#fl-sup-del').click();
  await sleep(20);
  const deletes2 = calls.filter((c) => c.method === 'DELETE');
  const lastDel2 = deletes2[deletes2.length - 1];
  check('详情删除按钮 ⇒ 同一 DELETE 契约（带 id/tier）',
    !!lastDel2 && lastDel2.url === '/api/flowmodus/suppliers?tier=paid&id=deepseek',
    lastDel2 && lastDel2.url);

  console.log('');
  console.log(fail === 0
    ? 'OK — ' + pass + ' checks green'
    : 'FAILED — ' + fail + ' check(s) red (' + pass + ' green)');
  process.exit(fail === 0 ? 0 : 1);
})();
