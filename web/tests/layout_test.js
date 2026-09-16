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

const BASE = process.argv[2] || process.env.PANEL || 'http://127.0.0.1:18932';
const CDP = process.argv[3] || process.env.CDP || 'http://localhost:9222';

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + label + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  [' + detail + ']' : '')); }
}

const PROBE = `(async function () {
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function R(e) { var r = e.getBoundingClientRect();
    return { y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
             bottom: Math.round(r.bottom) }; }
  document.getElementById('v-chat').click();
  await sleep(400);
  var item = document.querySelector('#chat-side .ses-item');
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
  var card = document.querySelector('#chat-side .ses-item');
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
  var c = document.querySelector('#chat-side .ses-item');
  if (!c) { return null; }
  var t = c.querySelector('.t'), nm = c.querySelector('.nm'), pv = c.querySelector('.p');
  function r(e) { if (!e) { return null; } var b = e.getBoundingClientRect();
    return [Math.round(b.y), Math.round(b.height), Math.round(b.width)]; }
  return { card: r(c), name: r(nm), preview: r(pv), meta: r(t),
           metaLines: t ? t.getClientRects().length : null };
})()`;

(async function main() {
  console.log('== transcript + sidebar layout, measured in a real browser ==');
  let list;
  try { list = await (await fetch(CDP + '/json/list')).json(); }
  catch (e) {
    console.log('  FAIL  a browser is reachable at ' + CDP + '  [' + e.message + ']');
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
    check('a process row to expand', false, 'none in the loaded period');
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
    check('a session card to measure', false, 'the sidebar has no card');
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

  console.log('');
  console.log(fail === 0 ? 'RESULT: ' + pass + ' passed, 0 failed'
    : 'RESULT: ' + pass + ' passed, ' + fail + ' failed');
  ws.close();
  process.exit(fail === 0 ? 0 : 1);
})();
