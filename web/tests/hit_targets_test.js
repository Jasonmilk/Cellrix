#!/usr/bin/env node
/* 触控目标：可点区域必须 ≥ `--hit-min`（iPhone 等粗指针设备）。
 *
 * ── 为什么必须有这条判据 ──────────────────────────────────────────────────
 *
 * 实测（2026-09-23）：手机上曾有 **3 处硬值没接上 `--hit-min`**：
 *   - `.theme-switch button` 在 `≤640px` 断点被写成硬值 `min-height:28px`；
 *   - `.foot a` 完全没有最小高度 ⇒ 实测 **12px**，根本点不到；
 *   - `@media (pointer:coarse)` 里写的是 **40px**（全仓第三个值）。
 * 修完后四个视口全部 ≥ 44px（三个 iPhone 机型 + 桌面粗指针）。
 *
 * ── 本判据最容易写错的地方（我自己先写错过一次） ──────────────────────────
 *
 * **必须量"实际可点区域"，不能量元素盒子。** 本仓的顶栏键视觉高度只有 36px，
 * 但 `.topbar .btn::after{height:44px}` 把它扩到 44px。只量 `getBoundingClientRect()`
 * 会得到 36px 并误报"太小" —— 那是**判据指向了代理**（与 CD-144 原则 1 同形）。
 * 故这里取「盒子高度 ∪ ::before/::after 扩展高度」。
 *
 * ⚠️ 因此本文件必须在 `pointer:coarse` **且**窄视口下运行：缺陷只在
 * `@media (max-width:640px)` + `(pointer:coarse)` 同时成立时出现。
 *
 * Usage: node hit_targets_test.js [panel_url] [cdp_url]
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

/* 覆盖三类机型 + 一个桌面粗指针窗口。SE 最窄，ProMax 最宽，桌面用于防"只在窄屏修好"。 */
const VIEWPORTS = [
  { name: 'iPhone SE', w: 375, h: 667 },
  { name: 'iPhone 15', w: 393, h: 852 },
  { name: 'iPhone 15 Pro Max', w: 430, h: 932 },
  { name: 'desktop (coarse)', w: 1440, h: 900 }
];
const MIN = 44;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let page = null;
  for (const h of [CDP, 'http://127.0.0.1:9222', 'http://localhost:9222']) {
    try { const l = await (await fetch(h + '/json/list')).json(); page = l.find((t) => t.type === 'page'); if (page) break; } catch { /* 下一个 */ }
  }
  if (!page) { console.log('  FAIL  没有 CDP page target —— 先起 Chrome（见 README）'); process.exit(2); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (m) => {
    const j = JSON.parse(m.data);
    if (j.id && pending.has(j.id)) { const p = pending.get(j.id); pending.delete(j.id); j.error ? p.rej(new Error(j.error.message)) : p.res(j.result); }
  });
  await new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params) => {
    const i = ++id; ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    return new Promise((res, rej) => pending.set(i, { res, rej }));
  };
  await send('Page.enable'); await send('Runtime.enable');

  const EXPR = `(function(){
    function eff(e){
      var b=e.getBoundingClientRect();
      if(b.width===0||b.height===0) return null;          /* 不可见的不算 */
      var best=b.height;
      ['::after','::before'].forEach(function(ps){
        var a=getComputedStyle(e,ps);
        /* 只有真的画了内容（扩展层）才计入；空 content 不算 */
        if(a.content && a.content!=='none'){ var h=parseFloat(a.height)||0; if(h>best) best=h; }
      });
      return {box:Math.round(b.height), eff:Math.round(best)};
    }
    var bad=[];
    document.querySelectorAll('.btn,.btn-icon,[data-view],[data-panel],button,a[href],.ses-item').forEach(function(e){
      var m=eff(e); if(!m) return;
      if(m.eff>=${MIN}) return;
      var path=[]; var n=e; for(var k=0;k<3&&n;k++){path.unshift(n.id?('#'+n.id):(n.className?('.'+String(n.className).split(' ')[0]):n.tagName)); n=n.parentElement;}
      bad.push({sel:path.join('>'), txt:(e.textContent||'').trim().slice(0,12), box:m.box, eff:m.eff});
    });
    return JSON.stringify({coarse:matchMedia('(pointer:coarse)').matches, bad:bad});
  })()`;

  let failed = 0;
  console.log('');
  console.log('触控目标判据：实际可点区 ≥ ' + MIN + 'px（含 ::after 扩展）');
  for (const vp of VIEWPORTS) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.w < 1000,
      screenWidth: vp.w, screenHeight: vp.h,
      screenOrientation: { type: 'portraitPrimary', angle: 0 }
    });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    let coarseOk = false;
    try {
      await send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
      coarseOk = true;
    } catch { /* 老版本 Chrome 无此调用 */ }
    await send('Page.navigate', { url: BASE + '/' });
    await sleep(2200);

    const r = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
    const v = JSON.parse(r.result.value);
    const label = vp.name + ' ' + vp.w + '×' + vp.h;

    if (!v.coarse) {
      /* 没进粗指针态 ⇒ 这条判据在骗人（缺陷只在 coarse 下出现），必须报红而不是放过 */
      console.log('  FAIL  ' + label + '  —— pointer:coarse 未生效，本判据在此视口无效' +
        (coarseOk ? '' : '（CDP 不支持 setEmitTouchEventsForMouse）'));
      failed++;
      continue;
    }
    if (!v.bad.length) {
      console.log('  PASS  ' + label + '  —— 全部可点元素 ≥ ' + MIN + 'px');
    } else {
      failed++;
      console.log('  FAIL  ' + label + '  —— ' + v.bad.length + ' 个 < ' + MIN + 'px');
      v.bad.slice(0, 6).forEach((b) =>
        console.log('          ' + String(b.eff).padStart(3) + 'px (盒子 ' + String(b.box).padStart(3) + 'px)  ' + b.sel + '  "' + b.txt + '"'));
    }
  }

  console.log('');
  console.log(failed === 0
    ? 'OK — ' + VIEWPORTS.length + ' 个视口的触控目标均达标'
    : 'FAILED — ' + failed + ' 个视口不达标');
  console.log('');
  ws.close();
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.log('  FAIL  判据本身出错: ' + (e && e.message || e)); process.exit(2); });
