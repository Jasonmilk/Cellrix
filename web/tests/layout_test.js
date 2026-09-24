/* The transcript's and the sidebar's form must follow their content.
 *
 * This is the only check that can see the defects it was written for. Every CSS
 * level and DOM level check passed while:
 *   - an expanded process row (思考) sat in a 35px box holding 306px of text,
 *     with the NEXT row painted over the overflow — "展开思考被遮住";
 *   - a session card was squeezed to its 44px minimum with its content 54px
 *     outside the card — "内容挤压,超出卡片";
 *   - hovering a card pushed the meta line onto a second line and pulled the
 *     card taller — a hover that changes the geometry.
 * jsdom has no layout engine, so none of this is visible there. It is measured
 * in a real browser over the DevTools Protocol, and the assertions are on the
 * OUTCOME: the content at the content's own coordinates is the content, and the
 * geometry under the pointer equals the geometry away from it.
 *
 * Usage:  node layout_test.js [panel_url] [cdp_url]
 *   Needs the panel live (see start-panel.sh) and Chrome started with
 *   --remote-debugging-port=9222. Registered as a "needs input" suite for that
 *   reason: a suite that silently does not run reads exactly like one that
 *   passes.
 */
'use strict';

const BASE = process.argv[2] || process.env.CELLRIX_PANEL || process.env.PANEL || "";
/* NO literal default: the port is declared once (`panel` in
 * anaphase-helix/ecosystem/chain.json) and passed in by the runner. An absent
 * address is a MISSING INPUT, not a reason to guess a port that might belong to
 * something else — that is how llama-server on 8080 got mistaken for the panel. */
if (!BASE) {
  console.log('NEEDS-INPUT: 未给面板地址（argv[2] / CELLRIX_PANEL）—— 端口见 chain.json 的 `panel` 条目');
  process.exit(3);
}

const CDP = process.argv[3] || process.env.CDP || 'http://localhost:9222';

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + label + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  [' + detail + ']' : '')); }
}

/* ── 需要输入 ≠ 失败 ────────────────────────────────────────────────────────
 *
 * 本套件的三条判据（扩展行是否装得下它的文字、卡片内容是否溢框、抽屉是否留出
 * 中栏）**必须有一段真实经历才能量**。本机没起 anaphase 时侧栏无卡、证轨无行，
 * 它们无从测量。
 *
 * 实测（2026-09-24 审查）：这些判据此前走 `check(...)`，于是**对本机恒红**，
 * 红因是"没有数据"而不是"产品坏了"。一颗永远红、红色里没有信息的套件会训练人
 * 忽略红色，于是真红也一起被忽略。
 *
 * ⇒ 记成 skipped，并在结尾以**退出码 3** 登记为 SKIP（由 `run_all.js` 认，
 * 与「可达就跑、不可达说明原因」同一条纪律）。缺什么，由 reason 说出来。 */
let skipped = 0;
function skip(label, why) {
  skipped++;
  console.log('  SKIP  ' + label + (why ? '  [' + why + ']' : ''));
}

const PROBE = `(async function () {
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function R(e) { var r = e.getBoundingClientRect();
    return { y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
             bottom: Math.round(r.bottom) }; }
  document.getElementById('v-chat').click();
  await sleep(400);
  var item = document.querySelector('#s-side .ses-item');
  out_clicked: { if (item) { item.click(); await sleep(2500); } }
  var c = document.querySelector('#chat-msgs');
  if (!c) { return { error: 'no #chat-msgs' }; }
  var rows = Array.prototype.slice.call(c.querySelectorAll('.think-row'));
  var out = {};
  if (rows.length) {
    var row = rows[0];
    var body = row.querySelector('.think-body');
    /* A controlled probe, not a lucky sample: the periods on disk carry short
     * reasoning (measured max 76 chars), too short to make a row grow past its
     * own minimum, so the defect cannot be observed from the data alone. The
     * question is structural: does the row take the shape of its content. */
    body.textContent = new Array(60).join('这是一段较长的思考内容，用来测试展开后的形态。');
    row.scrollIntoView({ block: 'nearest' });
    await sleep(150);
    var r0 = R(row);
    row.click();
    await sleep(400);
    var r1 = R(row), b1 = R(body);
    var cx = Math.round(b1.y * 0 + body.getBoundingClientRect().x + b1.w / 2);
    out.row = {
      grewBy: Math.round(r1.h - r0.h), bodyH: bodies(body), rowBottom: r1.bottom,
      bodyBottom: b1.bottom,
      painted: [0.15, 0.5, 0.85, 0.99].map(function (f) {
        var rect = body.getBoundingClientRect();
        var y = Math.round(rect.y + rect.height * f);
        var hit = document.elementFromPoint(cx, y);
        return { f: f, at: hit ? (hit.className || hit.tagName) : null,
                 inside: !!hit && (hit === body || body.contains(hit)) };
      })
    };
  }
  function bodies(el) { return el.offsetHeight; }
  /* --- the session card, asked the same way ---------------------------- */
  var card = document.querySelector('#s-side .ses-item');
  if (card) {
    card.classList.add('sel');
    await sleep(300);
    var nm = card.querySelector('.nm'), pv = card.querySelector('.p'), t = card.querySelector('.t');
    if (pv) { pv.textContent = new Array(40).join('这是一段很长的用户输入预览，用来测试卡片里预览的形态。'); }
    if (nm) { nm.textContent = new Array(20).join('这是一个很长的经历名字，用来测试卡片里名字的形态。'); }
    await sleep(200);
    var cardRect = card.getBoundingClientRect();
    function lines(el) {
      if (!el) { return null; }
      var lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.6;
      return Math.round(el.clientHeight / lh);
    }
    function probeOver(el) {
      if (!el) { return null; }
      var r = el.getBoundingClientRect();
      var x = Math.round(r.right - 6);
      return [0.1, 0.5, 0.9].map(function (f) {
        var y = Math.round(r.y + r.height * f);
        var hit = document.elementFromPoint(x, y);
        return { y: y, at: hit ? (hit.className || hit.tagName) : null,
                 inside: !!hit && (hit === el || el.contains(hit)) };
      });
    }
    out.card = {
      centre: { x: Math.round(cardRect.x + cardRect.width / 2),
                y: Math.round(cardRect.y + cardRect.height / 2) },
      cardH: Math.round(cardRect.height),
      nameLines: lines(nm),
      previewLines: lines(pv),
      previewClamp: pv ? getComputedStyle(pv).webkitLineClamp : null,
      previewPast: pv ? Math.round(pv.getBoundingClientRect().bottom - cardRect.bottom) : null,
      metaLines: t ? t.getClientRects().length : null,
      coversName: probeOver(nm),
      coversPreview: probeOver(pv)
    };
  }
  return out;
})()`;

const GEOM = `(function () {
  var c = document.querySelector('#s-side .ses-item');
  if (!c) { return null; }
  var t = c.querySelector('.t'), nm = c.querySelector('.nm'), pv = c.querySelector('.p');
  function r(e) { if (!e) { return null; } var b = e.getBoundingClientRect();
    return [Math.round(b.y), Math.round(b.height), Math.round(b.width)]; }
  return { card: r(c), name: r(nm), preview: r(pv), meta: r(t),
           metaLines: t ? t.getClientRects().length : null };
})()`;


/* ---- 4a: the geometry the contract demands -------------------------------
 * Written BEFORE the layout work, so they must be RED now. Each is derived from
 * the contract (docs/panel-geometry-contract.md), not from the implementation:
 *   A  the inspector is a COLUMN: opening it must take width from the main area
 *   B  the input is always inside the viewport, however long the transcript is
 *   C  the transcript's height is the space the layout gives it, not a fraction
 *      of the viewport
 */
const PROBE_4A = `(async function () {
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function R(e) { if (!e) { return null; } var r = e.getBoundingClientRect();
    return { x: Math.round(r.x), w: Math.round(r.width), bottom: Math.round(r.bottom),
             right: Math.round(r.right), h: Math.round(r.height) }; }
  var out = {};

  /* --- chat view: B and C --- */
  var nav = document.getElementById('v-chat'); if (nav) { nav.click(); }
  await sleep(400);
  var item = document.querySelector('#s-side .ses-item');
  if (item) { item.click(); await sleep(2500); }
  var col = document.querySelector('.chat-col'), msgs = document.querySelector('#chat-msgs');
  var inp = document.querySelector('.chat-input'), ban = document.getElementById('cont-banner');
  if (col && msgs && inp) {
    var bannerH = (ban && getComputedStyle(ban).display !== 'none') ? ban.offsetHeight : 0;
    var available = col.clientHeight - inp.offsetHeight - bannerH;
    out.transcript = { box: msgs.clientHeight, available: Math.round(available),
                       gap: Math.round(available - msgs.clientHeight),
                       colH: col.clientHeight, inputH: inp.offsetHeight,
                       viewport: innerHeight };
    out.input = { bottom: R(inp).bottom, viewport: innerHeight, inside: R(inp).bottom <= innerHeight + 1 };
    out.pageScrolls = document.documentElement.scrollHeight > innerHeight + 1;
  }

  /* --- prove-track view: A --- */
  /* N-001: the trajectory is an auxiliary PANEL now. Open it by its own toggle;
     there is no "prove-track view" to switch to any more, and no mode switch
     either — a card click means one thing (load it into the conversation), so
     the panel is what has to be opened explicitly. */
  var ptBtn = document.getElementById('p-prove-track');
  if (ptBtn) { ptBtn.click(); await sleep(1600); }
  var sItem = document.querySelector('#s-side .ses-item');
  if (sItem) { sItem.click(); await sleep(1800); }
  var main = document.querySelector('#view-prove-track .e-traj') ||
             document.querySelector('#view-prove-track .e-wrap') ||
             document.querySelector('#s-main');
  var wid = function () { return main ? Math.round(main.getBoundingClientRect().width) : null; };
  out.mainClosed = wid();
  out.mainX = main ? Math.round(main.getBoundingClientRect().x) : null;
  var rows = document.querySelectorAll('#eTbody tr.ev[data-e-ev]');
  if (rows.length) { rows[0].click(); await sleep(500); }
  var insp = document.getElementById('eInsp');
  out.inspectorOpen = !!(insp && insp.classList.contains('on'));
  out.mainOpen = wid();
  out.inspector = R(insp);
  out.mainShrankBy = (out.mainClosed != null && out.mainOpen != null) ? out.mainClosed - out.mainOpen : null;
  out.viewport = innerWidth;
  out.inspectorModal = !!(insp && insp.getAttribute('aria-modal') === 'true');
  /* Drawer criterion: while the drawer is open, how much of the main area is
     still visible (its right edge stops where the drawer begins). */
  out.mainVisibleAfterOpen = (insp && main && insp.classList.contains('on') &&
      main.getBoundingClientRect().width > 0) ?
    Math.max(0, Math.round(
      Math.min(main.getBoundingClientRect().right, insp.getBoundingClientRect().left) -
      main.getBoundingClientRect().left)) : null;
  return out;
})()`;

(async function main() {
  console.log('== transcript + sidebar layout, measured in a real browser ==');
  /* Node's fetch resolves `localhost` to ::1 first and does not fall back the
   * way curl does, so a browser listening on 127.0.0.1 can read as unreachable.
   * Measured twice: the same Chrome answered curl and not node. Try both hosts
   * before calling it unreachable. */
  const HOSTS = [CDP, 'http://127.0.0.1:9222', 'http://localhost:9222'];
  let list = null;
  for (const h of HOSTS) {
    try { list = await (await fetch(h + '/json/list')).json(); break; }
    catch (e) { /* next */ }
  }
  if (!list) {
    console.log('  FAIL  a browser is reachable at ' + HOSTS.join(' or '));
    console.log('\nRESULT: could not measure (needs the panel + Chrome)');
    process.exit(1);
  }
  const page = list.find(function (t) { return t.type === 'page'; });
  if (!page) { console.log('  FAIL  a page target exists'); process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map(); const idRef = { n: 0 };
  const send = function (method, params) {
    return new Promise(function (res, rej) {
      const id = ++idRef.n; pending.set(id, { res: res, rej: rej });
      ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
    });
  };
  ws.addEventListener('message', function (ev) {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      if (m.error) { p.rej(new Error(JSON.stringify(m.error))); } else { p.res(m.result); }
    }
  });
  await new Promise(function (r) { ws.addEventListener('open', r); });
  await send('Page.enable'); await send('Runtime.enable');

  /* 视口必须由**本测试**决定，不能继承浏览器默认。
   *
   * 实测（2026-09-23）：headless Chrome 默认 800×600 ⇒ 视口实测 413px ⇒ 触发窄屏
   * 媒体查询 ⇒ 卡片被压成 0 宽 ⇒ 5 条判据量到 0 而报红。同一份代码，把视口设成
   * 1440×900 后 **13 passed / 0 failed**。
   *
   * ⇒ 一个几何判据的测试若不掌握视口，它的结论就取决于"跑它的人开了多大窗口"——
   * 而这条长期没被发现，正因为本套件此前一直因"没有 Chrome"而 SKIP。
   * 故在此显式设成宽屏，让判据指向一个**被声明过的**几何环境。 */
  const VIEWPORT = { width: 1440, height: 900 };
  await send('Emulation.setDeviceMetricsOverride', {
    width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: 1, mobile: false
  });

  await send('Page.navigate', { url: BASE + '/' });
  await new Promise(function (r) { setTimeout(r, 2500); });
  const evalIn = async function (expr) {
    const r = await send('Runtime.evaluate',
      { expression: expr, awaitPromise: true, returnByValue: true, timeout: 40000 });
    return r.result ? r.result.value : null;
  };
  const d = await evalIn(PROBE);
  if (!d || d.error) {
    console.log('  FAIL  the transcript could be driven  [' + JSON.stringify(d) + ']');
    console.log('\nRESULT: FAILED'); process.exit(1);
  }

  /* --- 1. the process row ---------------------------------------------- */
  if (!d.row) {
    skip('a process row to expand', 'none in the loaded period — needs a live anaphase period');
  } else {
    console.log('  measured: row grew ' + d.row.grewBy + 'px for ' + d.row.bodyH +
      'px of text (row bottom ' + d.row.rowBottom + ', content bottom ' + d.row.bodyBottom + ')');
    check('the expanded row grew to hold its content',
      d.row.grewBy >= Math.min(120, d.row.bodyH * 0.6),
      'grew ' + d.row.grewBy + 'px for ' + d.row.bodyH + 'px');
    check('the content does not spill out of its row',
      d.row.bodyBottom <= d.row.rowBottom + 2,
      'content bottom ' + d.row.bodyBottom + ' vs row bottom ' + d.row.rowBottom);
    const outside = d.row.painted.filter(function (p) { return !p.inside; });
    check('nothing covers the expanded thinking', outside.length === 0,
      outside.length ? JSON.stringify(outside.slice(0, 2)) : 'probed ' + d.row.painted.length + ' points');
  }

  /* --- 2. the session card --------------------------------------------- */
  if (!d.card) {
    skip('a session card to measure', 'the sidebar has no card — needs a live anaphase period');
  } else {
    console.log('  measured: card ' + d.card.cardH + 'px, name ' + d.card.nameLines +
      ' line(s), preview ' + d.card.previewLines + ' of clamp ' + d.card.previewClamp +
      ', meta ' + d.card.metaLines + ' line(s)');
    check('the preview shows the lines it clamps to',
      Number(d.card.previewClamp) <= 1 || d.card.previewLines >= Number(d.card.previewClamp),
      'clamps to ' + d.card.previewClamp + ', shows ' + d.card.previewLines);
    check('the card content stays inside the card',
      d.card.previewPast === null || d.card.previewPast <= 2,
      'preview is ' + d.card.previewPast + 'px past the card bottom');
    const cn = (d.card.coversName || []).filter(function (p) { return !p.inside; });
    const cp = (d.card.coversPreview || []).filter(function (p) { return !p.inside; });
    check('the card actions do not cover the card name', cn.length === 0, JSON.stringify(cn.slice(0, 2)));
    check('the card actions do not cover the card preview', cp.length === 0, JSON.stringify(cp.slice(0, 2)));
  }

  /* --- 3. hover must not move anything ---------------------------------
   * With a real pointer. A change that only happens on hover is invisible to
   * every check that does not move a pointer — which is how one shipped.
   */
  if (d.card && d.card.centre) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, button: 'none' });
    await new Promise(function (r) { setTimeout(r, 250); });
    const away = await evalIn(GEOM);
    await send('Input.dispatchMouseEvent',
      { type: 'mouseMoved', x: d.card.centre.x, y: d.card.centre.y, button: 'none' });
    await new Promise(function (r) { setTimeout(r, 300); });
    const over = await evalIn(GEOM);
    console.log('  measured: card away ' + JSON.stringify(away) + ' vs hovered ' + JSON.stringify(over));
    check('hovering the card moves nothing',
      !!away && !!over && JSON.stringify(away) === JSON.stringify(over),
      'away ' + JSON.stringify(away && away.card) + ' vs hovered ' + JSON.stringify(over && over.card));
    check('the meta line stays one line under the pointer',
      !!over && over.metaLines === 1, over ? over.metaLines + ' line(s)' : 'not measured');
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, button: 'none' });
    await new Promise(function (r) { setTimeout(r, 200); });
  }


  /* --- 4a: three geometry assertions, RED before the layout work --------- */
  console.log('-- 4a geometry: what the contract demands (expected RED before the work) --');
  {
    const g = await evalIn(PROBE_4A);
    console.log('  measured: ' + JSON.stringify(g));
    if (!g || !g.transcript) {
      check('the chat panes are measurable', false, JSON.stringify(g));
    } else {
      /* C: the transcript's height is what the layout gives it. A viewport
       * fraction (70vh) is not the space available; the difference is the whole
       * point of the height chain. */
      check('the transcript height comes from the layout, not from the viewport',
        Math.abs(g.transcript.gap) <= 2,
        'box ' + g.transcript.box + ' vs available ' + g.transcript.available +
        ' (gap ' + g.transcript.gap + ')');
      /* B: the input stays reachable however long the transcript is. */
      check('the chat input stays inside the viewport',
        g.input.inside, 'input bottom ' + g.input.bottom + ' vs viewport ' + g.input.viewport);
      check('the page itself does not scroll (panes do)',
        !g.pageScrolls, 'documentElement.scrollHeight > innerHeight');
    }
    /* A: the inspector is a POPUP DRAWER (user decision 2026-09-16: two
       columns only, no resident third column). Opening it must leave part of
       the main area visible — the drawer is width-limited, never full-screen;
       the scrim (blank area) or ✕ hides it again. Criterion: the main area's
       visible width while the drawer is open stays ≥ 200px. */
    /* 抽屉的测量依赖"点一行"这一步（`eInsp` 由行上的动作打开）。没有行就没有
     * 抽屉可量 —— 那是缺输入，不是缺陷；反过来，**有行而抽屉没开**才是真红。 */
    if (!d.row) {
      skip('the inspector opens as a drawer that leaves part of the main area visible',
        'no row to open it from — needs a live anaphase period');
    } else {
      check('the inspector opens as a drawer that leaves part of the main area visible',
        g && g.mainVisibleAfterOpen != null && g.mainVisibleAfterOpen >= 200,
        'drawer w=' + (g && g.inspector && g.inspector.w) +
        ' at x=' + (g && g.inspector && g.inspector.x) +
        ' — main area still visible ' + (g && g.mainVisibleAfterOpen) + 'px');
    }
  }

  console.log('');
  console.log((fail === 0 ? 'RESULT: ' + pass + ' passed, 0 failed'
    : 'RESULT: ' + pass + ' passed, ' + fail + ' failed') +
    (skipped ? ', ' + skipped + ' skipped (needs a live period)' : ''));
  ws.close();
  /* 有跳过、但没有红 ⇒ **登记为 SKIP**（退出码 3，由 `run_all.js` 认）。
   * 既不冒充通过，也不冒充失败：缺的输入是一段真实经历。 */
  if (fail === 0 && skipped > 0) {
    console.log('NEEDS-INPUT: 需要一段真实经历（anaphase 未起 ⇒ 侧栏无卡、证轨无行，'
      + '扩展行 / 卡片溢框 / 抽屉留白三条判据无从测量）');
    process.exit(3);
  }
  process.exit(fail === 0 ? 0 : 1);
})();
