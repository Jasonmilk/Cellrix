#!/usr/bin/env node
/* 阅读度量：正文行宽被 `--msg-w`（由 `--read-w` 派生的单一来源）咬住，
 * 且缩窄视口时不溢出、中栏内容居中而非顶左。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────────────
 * PANEL-PLAN §1（阅读度量，唯一活计划第 5 项）。Cellrix 聊天面板在内容层原本
 * 是硬编码 `max-width:85%` —— 没有接到 `--read-w`，行宽上限随容器漂移、与阅读
 * 尺度无关。jsdom 没有布局引擎，看不到任何宽度；只有真浏览器 + CDP 能量到。
 *
 * ── 判据（全部从活页面派生，不写死数字）──────────────────────────────
 *   1. 正文行宽 ≤ 浏览器解析出的实际上限：拿 `.msg` 的 getComputedStyle().maxWidth
 *      （即 `--msg-w` 的解析结果，单一来源）作上限，量注入长消息的真实宽度。
 *   2. **上限必须真的咬得住**（反空转）：解析出的上限必须严格小于消息容器的内容宽。
 *      若有人把 `--msg-w` 改成 100%（或删掉），判据 1 会因上限=容器而「平凡地绿」，
 *      判据 2 必红 —— 度量失效的测试与不存在的测试不可区分，这是本仓的既有形状。
 *   3. 缩窄视口（800×800）：消息容器无水平溢出（scrollWidth ≤ clientWidth），
 *      且长消息右缘不越出容器（消息上限 = min(0.702·--read-w, 82%) 恒 < 100%）。
 *   4. 中栏内容居中而非顶左：#view-chat 在 #uxMainBody 内左右外边距差 ≤ 2px。
 *
 * ── 非空转（铁律 9）已由变异注入证明 ──────────────────────────────────────
 *   - 变异：把 `.msg { max-width:var(--msg-w) }` 临时改成 `max-width:100%`
 *     ⇒ 判据 1 平凡通过（上限=容器=行宽），**判据 2 红** ⇒ 套件 FAIL。
 *   - 移除变异 ⇒ 判据 2 绿 ⇒ 套件 PASS。（执行记录见提交信息。）
 *
 * Usage: node measure_test.js [panel_url] [cdp_url]
 *   Needs the panel live (see start-panel.sh / cellrix-web) and Chrome on :9222.
 *   Registered in run_all.js as a panel+CDP suite: 可达就跑，不可达才 SKIP。
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

const CDP = process.argv[3] || process.env.CELLRIX_CDP || 'http://127.0.0.1:9222';

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + label + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  [' + detail + ']' : '')); }
}

/* ── 极简 CDP 客户端（与 perf_measure.js / layout_test.js 同形，零依赖） ── */
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0; const pending = new Map();
    ws.addEventListener('open', () => resolve({
      send(method, params) {
        const mid = ++id;
        ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
        return new Promise((res, rej) => pending.set(mid, { res, rej }));
      },
      close() { try { ws.close(); } catch {} }
    }));
    ws.addEventListener('error', (e) => reject(new Error('WS error: ' + (e.message || 'unknown'))));
    ws.addEventListener('message', (m) => {
      let msg; try { msg = JSON.parse(m.data); } catch { return; }
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id); pending.delete(msg.id);
        msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result);
      }
    });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let page = null;
  for (const h of [CDP, 'http://127.0.0.1:9222']) {
    try {
      const list = await (await fetch(h + '/json/list')).json();
      page = list.find((t) => t.type === 'page');
      if (page) break;
    } catch { /* 换下一个 */ }
  }
  if (!page) { console.log('  FAIL  没有可用的 CDP page target —— 先起 Chrome（见 README）'); process.exit(2); }

  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const evalJS = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  const PROBE = `(function () {
    var msgs = document.getElementById('chat-msgs');
    if (!msgs) return { error: 'no #chat-msgs' };
    /* 注入一条足够长的消息：未受约束时单行必超容器与上限，保证上限被真的咬住 */
    var m = document.createElement('div');
    m.className = 'msg helix';
    m.innerHTML = '<span class="who">helix</span>这是一段用于测量正文行宽的足够长的文本，'
      + '按需加载按需驱动按需渲染，唯一事实来源单一职责极致复用极致解耦，'
      + '物理事实优先确定性优先零硬编码，这些都是工程哲学清单上的原则，'
      + '用来让这条消息在没有任何上限时必然撑满整行并且超过任何合理的阅读尺度。';
    msgs.appendChild(m);
    var R = function (el) {
      var r = el.getBoundingClientRect();
      return { x: Math.round(r.x), w: Math.round(r.width), right: Math.round(r.right) };
    };
    var mr = R(m);
    var containerW = msgs.clientWidth - 24;          /* 内容宽 = client - 左右 padding */
    var mb = R(msgs);
    var vc = R(document.getElementById('view-chat'));
    var main = R(document.getElementById('uxMainBody'));
    return {
      msgW: mr.w,
      /* 解析出的上限原文：Chrome 对 min() 返回 "min(659.88px, 82%)" 字符串，
         解析交给 Node 侧（JSON 序列化会把 NaN 变成 null，页内不许碰数字） */
      maxWidthRaw: getComputedStyle(m).maxWidth,
      containerW: containerW,
      msgRight: mr.right, msgsRight: mb.right,
      scrollW: msgs.scrollWidth, clientW: msgs.clientWidth,
      vc: vc, main: main,
      leftGap: vc.x - main.x, rightGap: main.right - vc.right
    };
  })()`;

/* 把浏览器自己解析出的 max-width 原文还原成单一数字。
 * "min(659.88px, 82%)" → min(659.88, 0.82·containerW)；"660px" → 660；
 * "none"/无法解析 → Infinity（此时判据 2 必红：上限没有咬住）。 */
function resolveCap(raw, containerW) {
  if (!raw) return Infinity;
  const t = String(raw).trim();
  if (t === 'none' || t === 'auto') return Infinity;
  const m = t.match(/^min\((.+)\)$/);
  const parts = m ? m[1].split(',').map((s) => s.trim()) : [t];
  const vals = parts.map((p) => {
    if (p.endsWith('%')) return parseFloat(p) / 100 * containerW;
    const n = parseFloat(p);
    return isFinite(n) ? n : Infinity;
  });
  return Math.min.apply(null, vals);
}

  /* ── 1440×900：行宽 ≤ 上限、上限咬得住、中栏居中 ── */
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: BASE + '/' });
  await sleep(1200);
  await evalJS("document.getElementById('v-chat').click();");
  await sleep(300);
  const w = await evalJS(PROBE);
  if (w.error) { console.log('  FAIL  ' + w.error); process.exit(1); }
  const cap = resolveCap(w.maxWidthRaw, w.containerW);

  check('正文行宽 ≤ 解析上限', w.msgW <= cap + 1,
    'msg=' + w.msgW + 'px cap=' + cap + 'px (' + w.maxWidthRaw + ')');
  check('上限真的咬得住（< 容器内容宽）', isFinite(cap) && cap < w.containerW - 1,
    'cap=' + cap + 'px container=' + w.containerW + 'px');
  check('中栏内容居中（左右空隙差 ≤ 2px）', Math.abs(w.leftGap - w.rightGap) <= 2,
    'L=' + w.leftGap + ' R=' + w.rightGap);

  /* ── 800×800：缩窄视口不溢出 ── */
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  const n = await evalJS(PROBE);
  if (n.error) { console.log('  FAIL  ' + n.error); process.exit(1); }

  check('缩窄视口：消息容器无水平溢出', n.scrollW <= n.clientW + 1,
    'scroll=' + n.scrollW + ' client=' + n.clientW);
  check('缩窄视口：长消息不越出容器', n.msgRight <= n.msgsRight + 1,
    'msg.right=' + n.msgRight + ' msgs.right=' + n.msgsRight);

  console.log('');
  console.log(fail === 0 ? 'OK — ' + pass + ' checks green' : 'FAILED — ' + fail + ' check(s) red');
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('MEASURE_TEST ERROR', e); process.exit(1); });
