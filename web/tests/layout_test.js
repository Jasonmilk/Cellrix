/* The transcript's form must follow its content.
 *
 * This is the only check that can see the defect it was written for. The
 * conversation's process rows (思考/计划/工具) are collapsible, and an expanded
 * one must occupy the height its text occupies. It did not: the row carried a
 * class from another component that declared `display`, that declaration won,
 * and the row stayed 36px tall while 267px of text spilled out of it — with the
 * NEXT row painted on top. Every CSS-level and DOM-level check passed: the class
 * was toggled, the text was present, the rules were in the served page. Only
 * geometry shows it, and jsdom has no geometry.
 *
 * So this drives a real browser over the DevTools Protocol and asserts the
 * OUTCOME, not the rules: after expanding, the content at the content's own
 * coordinates must be the content, and nothing may be laid out over it.
 *
 * Usage:  node layout_test.js [panel_url] [cdp_url]
 *   Needs the panel live (see start-panel.sh) and a Chrome started with
 *   --remote-debugging-port. Documented as a "needs input" suite for that
 *   reason: a suite that silently does not run reads exactly like one that
 *   passes.
 *
 * Exit: 0 all assertions held, 1 otherwise.
 */
'use strict';

const BASE = process.argv[2] || process.env.PANEL || 'http://127.0.0.1:18932';
const CDP = process.argv[3] || process.env.CDP || 'http://localhost:9222';

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + label + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  [' + detail + ']' : '')); }
}

function send(ws, method, params, pending, idRef) {
  return new Promise(function (res, rej) {
    const id = ++idRef.n;
    pending.set(id, { res: res, rej: rej });
    ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
  });
}

const PROBE = `(async function () {
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  document.getElementById('v-chat').click();
  await sleep(400);
  var item = document.querySelector('#chat-side .ses-item');
  if (item) { item.click(); await sleep(2500); }
  var c = document.querySelector('#chat-msgs');
  if (!c) { return { error: 'no #chat-msgs' }; }
  var rows = Array.prototype.slice.call(c.querySelectorAll('.think-row'));
  if (!rows.length) { return { error: 'no process row to expand' }; }

  var row = rows[0];
  var body = row.querySelector('.think-body');
  /* A controlled probe, not a lucky sample: the periods on disk carry short
   * reasoning (measured max 76 chars), too short to make the row grow past its
   * own minimum — so the defect cannot be observed from the data alone. The
   * question here is structural: does the row take the shape of its content. */
  body.textContent = new Array(60).join('这是一段较长的思考内容，用来测试展开后的形态。');
  row.scrollIntoView({ block: 'nearest' });
  await sleep(150);

  var r0 = row.getBoundingClientRect();
  row.click();
  await sleep(400);

  var r1 = row.getBoundingClientRect();
  var b1 = body.getBoundingClientRect();
  var textH = body.offsetHeight;
  var cx = Math.round(b1.x + b1.width / 2);
  var painted = [0.15, 0.5, 0.85, 0.99].map(function (f) {
    var y = Math.round(b1.y + b1.height * f);
    var hit = document.elementFromPoint(cx, y);
    return { atFrac: f, y: y, inside: !!hit && (hit === body || body.contains(hit)),
             at: hit ? (hit.className || hit.tagName) : null };
  });
  /* --- the same question asked of a session card -------------------------
   * These are one design, not two components: a bounded window, a box whose
   * form is a constant, and an action area stacked over readable text. The
   * card is measured the same way — by outcome, not by rules. */
  var card = document.querySelector('#chat-side .ses-item');
  var cardOut = null;
  if (card) {
    card.classList.add('sel');                 // selected: the actions are visible
    await sleep(300);
    var nm = card.querySelector('.nm');
    var pv = card.querySelector('.p');
    if (pv) {
      pv.textContent = new Array(40).join('这是一段很长的用户输入预览，用来测试卡片里预览的形态。');
    }
    if (nm) { nm.textContent = new Array(20).join('这是一个很长的经历名字，用来测试卡片里名字的形态。'); }
    await sleep(200);
    var cardRect = card.getBoundingClientRect();
    var act = card.querySelector('.act');
    var actRect = act ? act.getBoundingClientRect() : null;
    function lines(el) {
      if (!el) { return null; }
      var lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.6;
      return Math.round(el.clientHeight / lh);
    }
    function probeOver(el) {
      if (!el) { return null; }
      var r = el.getBoundingClientRect();
      var ys = [0.1, 0.5, 0.9].map(function (f) { return Math.round(r.y + r.height * f); });
      var x = Math.round(r.right - 6);          // where an overlay would sit
      return ys.map(function (y) {
        var hit = document.elementFromPoint(x, y);
        return { y: y, at: hit ? (hit.className || hit.tagName) : null,
                 isOwnText: !!hit && (hit === el || el.contains(hit)) };
      });
    }
    cardOut = {
      cardHeight: Math.round(cardRect.height),
      nameLines: lines(nm),
      nameClamp: nm ? getComputedStyle(nm).webkitLineClamp : null,
      previewLines: lines(pv),
      previewClamp: pv ? getComputedStyle(pv).webkitLineClamp : null,
      previewWhiteSpace: pv ? getComputedStyle(pv).whiteSpace : null,
      previewOverflowsCard: pv ? Math.round(pv.getBoundingClientRect().bottom - cardRect.bottom) : null,
      actionRect: actRect ? { x: Math.round(actRect.x), w: Math.round(actRect.width) } : null,
      actionCoversName: probeOver(nm),
      actionCoversPreview: probeOver(pv),
      sidebar: (function () {
        var s = document.querySelector('#chat-side');
        return s ? { clientH: s.clientHeight, scrollH: s.scrollHeight } : null;
      })()
    };
  }

  return {
    card: cardOut,
    rowHeightClosed: Math.round(r0.height),
    rowHeightOpen: Math.round(r1.height),
    rowGrewBy: Math.round(r1.height - r0.height),
    bodyHeight: Math.round(b1.height),
    bodyOffsetHeight: textH,
    bodyScrollHeight: body.scrollHeight,
    bodyClientHeight: body.clientHeight,
    rowBottom: Math.round(r1.bottom),
    bodyBottom: Math.round(b1.bottom),
    containerOverflows: c.scrollHeight > c.clientHeight,
    painted: painted
  };
})()`;

(async function main() {
  console.log('== transcript layout, measured in a real browser: ' + BASE + ' ==');
  let list;
  try {
    list = await (await fetch(CDP + '/json/list')).json();
  } catch (e) {
    console.log('  FAIL  a browser is reachable at ' + CDP + '  [' + e.message + ']');
    console.log('\nRESULT: could not measure (needs the panel + Chrome)');
    process.exit(1);
  }
  const page = list.find(function (t) { return t.type === 'page'; });
  if (!page) { console.log('  FAIL  a page target exists'); process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  const idRef = { n: 0 };
  ws.addEventListener('message', function (ev) {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      if (m.error) { p.rej(new Error(JSON.stringify(m.error))); } else { p.res(m.result); }
    }
  });
  await new Promise(function (r) { ws.addEventListener('open', r); });
  await send(ws, 'Page.enable', {}, pending, idRef);
  await send(ws, 'Runtime.enable', {}, pending, idRef);
  await send(ws, 'Page.navigate', { url: BASE + '/' }, pending, idRef);
  await new Promise(function (r) { setTimeout(r, 2500); });
  const out = await send(ws, 'Runtime.evaluate',
    { expression: PROBE, awaitPromise: true, returnByValue: true, timeout: 40000 }, pending, idRef);
  ws.close();

  const d = out.result && out.result.value;
  if (!d || d.error) {
    console.log('  FAIL  the transcript could be driven  [' + JSON.stringify(d) + ']');
    console.log('\nRESULT: FAILED');
    process.exit(1);
  }
  console.log('  measured: closed ' + d.rowHeightClosed + 'px -> open ' + d.rowHeightOpen +
    'px (grew ' + d.rowGrewBy + 'px), body ' + d.bodyHeight + 'px, offsetHeight ' +
    d.bodyOffsetHeight + ', clientHeight ' + d.bodyClientHeight +
    ', scrollHeight ' + d.bodyScrollHeight);

  /* 1. The row's box must grow with its content. A row that stays at its own
   *    minimum while 267px of text is inside it is a box that does not follow
   *    its content — and the text it spills is what the next row lands on. */
  check('the expanded row grew to hold its content',
    d.rowGrewBy >= Math.min(120, d.bodyOffsetHeight * 0.6),
    'grew ' + d.rowGrewBy + 'px for ' + d.bodyOffsetHeight + 'px of text');

  /* 2. The content must fit inside its own row. */
  check('the content does not spill out of its row',
    d.bodyBottom <= d.rowBottom + 2,
    'content bottom ' + d.bodyBottom + ' vs row bottom ' + d.rowBottom);

  /* 3. Nothing may be painted over the content. This is the reported symptom,
   *    asserted directly: at the content's own coordinates, the content is what
   *    is there. */
  const outside = d.painted.filter(function (p) { return !p.inside; });
  check('nothing covers the expanded thinking',
    outside.length === 0,
    outside.length ? JSON.stringify(outside.slice(0, 2)) : 'probed ' + d.painted.length + ' points');

  /* --- the session card, asserted the same way ------------------------- */
  const card = d.card;
  if (!card) {
    check('a session card to measure', false, 'the sidebar has no card');
  } else {
    console.log('  measured: card ' + card.cardHeight + 'px, name ' + card.nameLines +
      ' line(s) of clamp ' + card.nameClamp + ', preview ' + card.previewLines +
      ' line(s) of clamp ' + card.previewClamp + ' (white-space: ' + card.previewWhiteSpace +
      '), sidebar ' + JSON.stringify(card.sidebar));

    /* A clamp is a promise about how much is shown. It is only kept if the box
     * is allowed to carry that many lines — which is why `nowrap` under a
     * 2-line clamp is not a style choice, it is a contradiction: the box says
     * "2 lines" and renders 1. */
    check('the preview shows the lines it clamps to',
      Number(card.previewClamp) <= 1 || card.previewLines >= Number(card.previewClamp),
      'clamps to ' + card.previewClamp + ', shows ' + card.previewLines + ' line(s)');

    check('the card content stays inside the card',
      card.previewOverflowsCard === null || card.previewOverflowsCard <= 2,
      'preview bottom is ' + card.previewOverflowsCard + 'px past the card bottom');

    /* The card's own actions may not be stacked over its own readable text. */
    const coverName = (card.actionCoversName || []).filter(function (p) { return !p.isOwnText; });
    const coverPrev = (card.actionCoversPreview || []).filter(function (p) { return !p.isOwnText; });
    check('the card actions do not cover the card name',
      coverName.length === 0, JSON.stringify(coverName.slice(0, 2)));
    check('the card actions do not cover the card preview',
      coverPrev.length === 0, JSON.stringify(coverPrev.slice(0, 2)));
  }

  console.log('');
  console.log(fail === 0 ? 'RESULT: ' + pass + ' passed, 0 failed'
    : 'RESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
})();
