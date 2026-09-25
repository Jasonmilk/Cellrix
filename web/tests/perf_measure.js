#!/usr/bin/env node
/* 只读测量：面板在一个刷新周期内"做了多少没人要的工作"。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────────────
 *
 * 面板的刷新由 `setInterval(tick, refresh*1000)` 驱动（`REFRESH_SECS = 2`），
 * 且代码里**没有任何可见性门控**。要判断"按需"缺到什么程度，需要三个**真数字**：
 *   1. 一个周期发几个请求、拉多少字节；
 *   2. 视图不可见时，DOM 被整块重建几次、灌了多少字节；
 *   3. 哪些端点在被无条件轮询。
 *
 * ⚠️ **上一次测量失败的地方，本文件刻意绕开**：当时我把包装挂在
 * `window.CxCockpit.render` 上，得到 0 —— 因为脚本早已把它捕获进闭包，
 * 挂到 `window` 上的引用不再被调用 ⇒ **是仪器坏了，不是"没渲染"**。
 * 故这里改挂**更底层且不可能被捕获**的两处：
 *   - `Element.prototype.innerHTML` 的 setter（所有整块重建都经过它）；
 *   - CDP `Network` 域（字节数由浏览器给，不靠页面自报）。
 *
 * ⚠️ 另一个坑：`innerHTML` 的**读**也会触发 getter（仓库里多处 `t.innerHTML`），
 * 只数 setter 才是"重建"。故分别计数。
 *
 * Usage: node perf_measure.js [panel_url] [cdp_url] [window_ms]
 */

/* CAPABILITY REQUIREMENT (Cellrix:ADR-0047): this suite declares what it needs in its
 * OWN source, not in the register. A register that can ATTACH a suite is a register that
 * can hide one — the trace must land in this suite's diff. register/retire only. */
const REQUIRES = 'cdp-browser';
'use strict';

/* CAPABILITY REQUIREMENT (Cellrix:ADR-0047). This suite declares what it needs
 * HERE, in its own source — not in the register. A register that can ATTACH a suite
 * is a register that can hide one: whoever wanted to stop a suite would edit a JSON
 * file and the trace would never appear in that suite's diff. register/retire only. */
const BASE = process.argv[2] || process.env.CELLRIX_PANEL || process.env.PANEL || "";
/* NO literal default: the port is declared once (`panel` in
 * anaphase-helix/ecosystem/chain.json) and passed in by the runner. An absent
 * address is a MISSING INPUT, not a reason to guess a port that might belong to
 * something else — that is how llama-server on 8080 got mistaken for the panel. */
if (!BASE) {
  console.log('NEEDS-INPUT: 未给面板地址（argv[2] / CELLRIX_PANEL）—— 端口见 chain.json 的 `panel` 条目');
  process.exit(3);
}

const CDP = process.argv[3] || process.env.CELLRIX_CDP || 'http://127.0.0.1:9222';
const WINDOW_MS = Number(process.argv[4] || 6000);

/* ── 极简 CDP 客户端（与 layout_test.js 同形，不引依赖） ─────────────────── */
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const events = [];
    const handlers = [];
    ws.addEventListener('open', () => resolve({
      send(method, params) {
        const mid = ++id;
        ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
        return new Promise((res, rej) => pending.set(mid, { res, rej }));
      },
      on(fn) { handlers.push(fn); },
      events,
      close() { try { ws.close(); } catch {} }
    }));
    ws.addEventListener('error', (e) => reject(new Error('WS error: ' + (e.message || 'unknown'))));
    ws.addEventListener('message', (m) => {
      let msg; try { msg = JSON.parse(m.data); } catch { return; }
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id); pending.delete(msg.id);
        msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result);
      } else if (msg.method) {
        events.push(msg);
        handlers.forEach((f) => f(msg));
      }
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  /* 找一个可用的 page target */
  let page = null;
  for (const h of [CDP, 'http://127.0.0.1:9222', 'http://localhost:9222']) {
    try {
      const list = await (await fetch(h + '/json/list')).json();
      page = list.find((t) => t.type === 'page');
      if (page) break;
    } catch { /* 换下一个 */ }
  }
  if (!page) {
    console.log('  FAIL  没有可用的 CDP page target —— 先起 Chrome（见 README）');
    process.exit(2);
  }

  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  await cdp.send('Runtime.enable');

  /* 请求/字节统计：由浏览器给，不靠页面自报 */
  const reqs = [];
  cdp.on((m) => {
    if (m.method === 'Network.requestWillBeSent') {
      reqs.push({
        requestId: m.params.requestId,
        url: m.params.request.url,
        type: m.params.type,
        t: Date.now()
      });
    } else if (m.method === 'Network.loadingFinished') {
      const r = reqs.find((x) => x.requestId === m.params.requestId);
      if (r) r.bytes = m.params.encodedDataLength;
    } else if (m.method === 'Network.responseReceived') {
      const r = reqs.find((x) => x.requestId === m.params.requestId);
      if (r) r.status = m.params.response.status;
    }
  });

  /* 在**任何页面脚本运行之前**注入计数器 —— 这是上次失败的根因所在 */
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      (function () {
        window.__perf = { writes: 0, bytes: 0, byEl: {}, reads: 0 };
        var d = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
        Object.defineProperty(Element.prototype, 'innerHTML', {
          configurable: true,
          get: function () { window.__perf.reads++; return d.get.call(this); },
          set: function (v) {
            window.__perf.writes++;
            window.__perf.bytes += String(v == null ? '' : v).length;
            var k = (this.id || this.className || this.tagName || '?').toString().slice(0, 40);
            window.__perf.byEl[k] = (window.__perf.byEl[k] || 0) + 1;
            return d.set.call(this, v);
          }
        });
      })();
    `
  });

  await cdp.send('Page.navigate', { url: BASE + '/' });
  await sleep(2500);

  /* 基线：复位计数 + 清空请求记录 */
  const reset = async () => cdp.send('Runtime.evaluate', {
    expression: 'window.__perf={writes:0,bytes:0,byEl:{},reads:0}; true', returnByValue: true
  });
  await reset();
  reqs.length = 0;

  /* 当前视图可见性（默认应为 chat，驾驶舱不可见） */
  const vis = await cdp.send('Runtime.evaluate', {
    expression: `(function(){
      function on(id){ var e=document.getElementById(id); if(!e) return 'absent';
        var r=e.getBoundingClientRect(); return (e.hidden||r.width===0||r.height===0)?'hidden':'visible'; }
      return JSON.stringify({view: (window.NAV&&window.NAV.view)||'?',
        cockpit:on('view-cockpit'), proveTrack:on('view-prove-track'), chat:on('view-chat')});
    })()`,
    returnByValue: true
  });
  const v = JSON.parse(vis.result.value);

  await sleep(WINDOW_MS);

  const perf = await cdp.send('Runtime.evaluate', {
    expression: 'JSON.stringify(window.__perf)', returnByValue: true
  });
  const p = JSON.parse(perf.result.value);

  /* 汇总 */
  const byUrl = {};
  let netBytes = 0, apiReqs = 0;
  for (const r of reqs) {
    let u; try { u = new URL(r.url); } catch { continue; }
    if (u.origin !== new URL(BASE).origin) continue;
    const k = u.pathname;
    byUrl[k] = byUrl[k] || { n: 0, bytes: 0 };
    byUrl[k].n++; byUrl[k].bytes += (r.bytes || 0);
    netBytes += (r.bytes || 0); apiReqs++;
  }

  const secs = (WINDOW_MS / 1000).toFixed(1);
  console.log('');
  console.log('面板: ' + BASE + '    窗口: ' + secs + 's');
  console.log('可见性: ' + JSON.stringify(v));
  console.log('');
  console.log('── 网络（浏览器给的真实字节） ─────────────────────────────');
  console.log('  同源请求 ' + apiReqs + ' 次 / ' + netBytes + ' B  ⇒ 每分钟约 ' +
    Math.round(apiReqs / (WINDOW_MS / 60000)) + ' 次请求, ' + Math.round(netBytes / (WINDOW_MS / 60000)) + ' B');
  for (const [k, s] of Object.entries(byUrl).sort((a, b) => b[1].n - a[1].n)) {
    console.log('    ' + String(s.n).padStart(3) + ' 次  ' + String(s.bytes).padStart(9) + ' B   ' + k);
  }
  console.log('');
  console.log('── DOM 重建（Element.prototype.innerHTML setter） ────────');
  console.log('  写入 ' + p.writes + ' 次 / ' + p.bytes + ' B   （读取 ' + p.reads + ' 次，不计）');
  const top = Object.entries(p.byEl).sort((a, b) => b[1] - a[1]).slice(0, 6);
  for (const [k, n] of top) console.log('    ' + String(n).padStart(3) + ' 次   ' + k);
  console.log('');
  const hiddenView = v.cockpit === 'hidden';
  /* 判据必须**指向被消费的对象**，而不是笼统的"有重建"：
   * `#eco` 是顶栏里的常驻指示（始终可见）⇒ 它重建是对的；
   * 要判的是**视图容器内部**的元素在视图不可见时是否仍被重建。 */
  const VIEW_CONTAINERS = { cockpit: ['entries', 'cockpit-stats', 'ltShell'], proveTrack: ['s-main'] };
  const hiddenWrites = [];
  let critFailed = 0;
  for (const [view, els] of Object.entries(VIEW_CONTAINERS)) {
    if (v[view] !== 'hidden') continue;
    for (const id of els) {
      if (p.byEl[id]) hiddenWrites.push(id + '×' + p.byEl[id] + '（' + view + ' 不可见）');
    }
  }
  console.log('── 判据 ────────────────────────────────────────────────');
  console.log('  驾驶舱可见: ' + (v.cockpit === 'visible'));
  if (hiddenWrites.length) {
    console.log('  ⚠️  不在台上的视图其容器仍被重建：' + hiddenWrites.join(', ') + ' —— 违反「按需渲染」');
    critFailed++;
  } else if (hiddenView) {
    console.log('  ✓ 不在台上的视图，其容器**零重建**（`#eco` 常驻可见，不计入）');
  }
  console.log('');

  /* ── 另一半：切**上台**时是否补渲染 ──────────────────────────────────────
   * 只证"隐藏时不重建"是不够的 —— 那可能只是"永远不渲染"。省掉浪费却换来空白，
   * 是拿一个缺陷换另一个。故这里必须证：切到驾驶舱 ⇒ 它被渲染。
   * 之后切走再切回、且期间数据未变 ⇒ **不重复渲染**（变化检测）。 */
  const switchTo = async (view) => cdp.send('Runtime.evaluate', {
    expression: `window.Cx && window.Cx.showView(${JSON.stringify(view)}); true`, returnByValue: true
  });
  const entryWrites = async () => {
    const r = await cdp.send('Runtime.evaluate', {
      expression: `document.getElementById('entries').querySelectorAll('*').length`, returnByValue: true
    });
    return r.result.value;
  };

  await reset();
  await switchTo('cockpit');
  await sleep(1200);
  const afterEnter = await cdp.send('Runtime.evaluate', { expression: 'JSON.stringify(window.__perf)', returnByValue: true });
  const pe = JSON.parse(afterEnter.result.value);
  const rowsAfterEnter = await entryWrites();

  await reset();
  await switchTo('chat');
  await sleep(600);
  await switchTo('cockpit');
  await sleep(1200);
  const afterReturn = await cdp.send('Runtime.evaluate', { expression: 'JSON.stringify(window.__perf)', returnByValue: true });
  const pr = JSON.parse(afterReturn.result.value);

  console.log('── 补渲染（切上台 / 切走再切回） ──────────────────────');
  console.log('  切到驾驶舱后：#entries 内元素 ' + rowsAfterEnter + ' 个，容器重建 ' + (pe.byEl.entries || 0) + ' 次');
  if (rowsAfterEnter === 0) {
    console.log('  ✗ 驾驶舱上台后**没有内容** —— 按需渲染退化成了不渲染');
    critFailed++;
  } else {
    console.log('  ✓ 驾驶舱上台后被渲染（有内容）');
  }
  console.log('  切走再切回（期间数据未变）：容器重建 ' + (pr.byEl.entries || 0) + ' 次');
  if ((pr.byEl.entries || 0) === 0) {
    console.log('  ✓ 同一份数据不重复渲染（变化检测生效）');
  } else {
    console.log('  ⚠️  同一份数据被重复渲染 ' + pr.byEl.entries + ' 次 —— 变化检测未生效');
    critFailed++;
  }
  console.log('');
  console.log(critFailed === 0
    ? 'OK — 按需渲染 3 条判据全过'
    : 'FAILED — ' + critFailed + ' 条判据未过');
  console.log('');

  cdp.close();
  /* 退出码 = 判据结果。本文件同时是**仪器**（上面的数字）与**判据**（这三条），
   * 故必须能被 run_all.js 判红；否则登记进网只增加"看起来有覆盖"。 */
  process.exit(critFailed === 0 ? 0 : 1);
})().catch((e) => { console.log('  测量失败: ' + (e && e.message || e)); process.exit(1); });
