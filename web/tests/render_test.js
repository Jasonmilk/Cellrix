/* Real-render smoke test for the Cellrix prove-track view.
 *
 * Loads the LIVE panel page into jsdom, proxies relative fetch() calls to the
 * real server, drives the real render path, then asserts the rendered DOM is
 * the English-only (ADR-0017) output and that nothing threw.
 *
 * Usage: node render_test.js <panel_base_url> <job_id>
 */
const { JSDOM, VirtualConsole } = require("jsdom");

const BASE = process.argv[2] || "http://127.0.0.1:18932";
const JOB = process.argv[3];
const CJK = /[\u4e00-\u9fff]/;

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log(`  PASS  ${label}${detail ? "  [" + detail + "]" : ""}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? "  [" + detail + "]" : ""}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log(`== real render: ${BASE}  job=${JOB} ==`);

  const html = await (await fetch(`${BASE}/`)).text();

  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push("jsdomError: " + e.message));
  vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));

  const dom = new JSDOM(html, {
    url: `${BASE}/`,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      // jsdom implements neither fetch nor matchMedia; supply both so the page
      // runs its real code path instead of dying in the theme bootstrap.
      window.fetch = (input, init) => {
        const url = typeof input === "string" && input.startsWith("/")
          ? BASE + input : input;
        return fetch(url, init);
      };
      window.matchMedia = (q) => ({
        matches: false, media: q, onchange: null,
        addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
      });
      window.addEventListener("error", (e) =>
        errors.push("window.error: " + (e.error ? e.error.stack : e.message)));
      window.addEventListener("unhandledrejection", (e) =>
        errors.push("unhandledrejection: " + e.reason));
    },
  });
  const { window } = dom;
  const doc = window.document;

  await sleep(2000); // let the shell's own polls settle and the sidebar fill

  console.log("-- boot --");
  check("no script errors during boot", errors.length === 0, errors.slice(0, 3).join(" | "));
  check("session sidebar present", doc.getElementById("s-side") !== null);
  check("__proveTrackLoad is exposed", typeof window.__proveTrackLoad === "function");
  check("__proveTrackClear is exposed", typeof window.__proveTrackClear === "function");
  check("CxProveTrack namespace exists", typeof window.CxProveTrack === "object");

  console.log("-- drive the real user path: click the period row in the sidebar --");
  const items = Array.from(doc.querySelectorAll("#s-side .ses-item"));
  check("sidebar rendered period rows from /api/sessions", items.length > 0,
    `${items.length} rows`);
  // session.html renders the id as job_id.slice(0, 12), so match on that prefix.
  const KEY = JOB.slice(0, 12);
  const target = items.find((el) => el.textContent.includes(KEY)) || items[0];
  check(`target row is the requested period ${JOB}`,
    target.textContent.includes(KEY), target.textContent.slice(0, 60).replace(/\s+/g, " "));
  const preClickErrors = errors.length;
  target.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(1800);

  const view = doc.getElementById("view-prove-track");
  check("#view-prove-track exists", view !== null);
  check("view switched to prove-track by the row click",
    view && view.style.display !== "none", `display="${view && view.style.display}"`);
  const text = view ? view.textContent : "";
  check("render produced content (not empty)", text.trim().length > 40,
    `${text.trim().length} chars`);
  check("no errors raised by the row click", errors.length === preClickErrors,
    errors.slice(preClickErrors).join(" | "));

  // ADR-0017 governs UI chrome, NOT conversation payloads: event data legitimately
  // carries the user's own (Chinese) messages, which land in table cells, lane
  // blocks and the inspector body. So every text assertion below runs on a
  // chrome-only concatenation, never on the whole view.
  const cjkCount = (s) => (s.match(new RegExp(CJK.source, "g")) || []).length;
  const txt = (el) => (el ? el.textContent : "");
  const chrome = [
    doc.getElementById("eStats"),
    doc.querySelector("#eTblVp thead"),
    doc.getElementById("eOvNote"),
    doc.getElementById("eQ"),
    ...Array.from(doc.querySelectorAll(".e-trk-nm")),
    ...["eDurBtn", "eCallBtn", "eTurnBtn", "eReplayBtn", "eQClr"]
      .map((id) => doc.getElementById(id)),
    ...Array.from(doc.querySelectorAll("#eInsp dt")),
  ];
  const chromeText = chrome.map(txt).join(" | ");

  console.log("-- chrome-only text must be CJK-free (payload excluded) --");
  check("chrome CJK == 0", cjkCount(chromeText) === 0,
    `cjk=${cjkCount(chromeText)} "${chromeText.replace(/\s+/g, " ").trim().slice(0, 90)}"`);
  for (const [label, sel] of [["#eStats", "#eStats"],
                              ["#eTblVp thead", "#eTblVp thead"],
                              [".e-trk-nm", ".e-trk-nm"],
                              ["#eOvNote", "#eOvNote"]]) {
    const el = doc.querySelector(sel);
    if (!el) { check(`scope ${label}`, false, "missing"); continue; }
    check(`scope ${label} CJK == 0`, cjkCount(txt(el)) === 0,
      `cjk=${cjkCount(txt(el))} "${txt(el).replace(/\s+/g, " ").trim().slice(0, 50)}"`);
  }
  const btnText = ["eDurBtn", "eCallBtn", "eTurnBtn", "eReplayBtn", "eQClr"]
    .map((id) => txt(doc.getElementById(id))).join(" | ");
  check("toolbar buttons CJK == 0", cjkCount(btnText) === 0, `"${btnText}"`);
  check("search input placeholder is English",
    (doc.getElementById("eQ") || {}).placeholder === "Search the trajectory\u2026",
    String((doc.getElementById("eQ") || {}).placeholder));

  console.log("-- old Chinese chrome labels must be gone from chrome --");
  for (const old of ["LLM \u8017\u65f6", "\u7f13\u5b58\u547d\u4e2d", "\u8f93\u5165 TOK",
                     "\u91cd\u653e\u8f68\u8ff9", "\u7b49\u5bbd",
                     "\u5168\u90e8\u6298\u53e0\u8f6e\u6b21", "\u5168\u90e8\u5c55\u5f00\u8c03\u7528",
                     "\u7c7b\u578b", "\u6458\u8981", "\u72b6\u6001", "\u8017\u65f6",
                     "\u6240\u5c5e\u8f6e\u6b21"]) {
    check(`gone ${JSON.stringify(old)}`, !chromeText.includes(old));
  }

  console.log("-- rendered English labels --");
  for (const lbl of ["TOKENS", "CACHE HIT", "INPUT TOK", "LLM TIME", "TOOL TIME"]) {
    check(`rendered ${lbl}`, chromeText.includes(lbl));
  }
  for (const lbl of ["Replay", "Equal width", "Collapse all turns", "Expand all calls",
                     "Input", "Model", "Tools"]) {
    check(`control ${lbl}`, text.includes(lbl));
  }

  console.log("-- DOM anchors --");
  for (const id of ["eTblVp", "eLaneInput", "eInsp", "eStats", "eTbody", "eTraj",
                    "eReplayBtn", "eDurBtn", "eCallBtn", "eTurnBtn", "eScrim"]) {
    check(`#${id}`, doc.getElementById(id) !== null);
  }

  console.log("-- inspector open path (click a rendered event row) --");
  // The turn header also carries data-e-ev (literally "null") and routes to the
  // turn-collapse branch, so the row must be matched as `tr.ev` and be non-REPLY
  // (REPLY toggles the inline answer instead of opening the inspector).
  // Run this BEFORE the toolbar clicks: eTurnBtn re-renders the table.
  const rows = Array.from(doc.querySelectorAll("#eTbody tr.ev[data-e-ev]"))
    .filter((r) => !r.classList.contains("e-reply"));
  check("event rows rendered", rows.length > 0, `${rows.length} rows`);
  const row = rows[0];
  if (row) {
    const b2 = errors.length;
    row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await sleep(400);
    const insp = doc.getElementById("eInsp");
    check("inspector opened", insp && insp.classList.contains("on"));
    const dtText = insp
      ? Array.from(insp.querySelectorAll("dt")).map((d) => d.textContent).join(" | ")
      : "";
    check("inspector field labels CJK == 0", cjkCount(dtText) === 0, `"${dtText}"`);
    check("inspector shows English field labels",
      ["Type", "Tool", "Status", "Turn", "Duration", "Share"].every((l) => dtText.includes(l)));
    check("no errors from inspector open", errors.length === b2,
      errors.slice(b2).join(" | "));
    // close it again so the toolbar clicks start from a clean state
    const x = doc.getElementById("eInspX");
    if (x) x.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await sleep(300);
    check("inspector closed via #eInspX",
      !doc.getElementById("eInsp").classList.contains("on"));
  } else {
    check("a rendered event row exists to click", false, "none found");
  }

  console.log("-- interaction: toolbar buttons must not throw --");
  const before = errors.length;
  for (const id of ["eDurBtn", "eCallBtn", "eTurnBtn", "eReplayBtn"]) {
    const el = doc.getElementById(id);
    if (!el) { check(`click #${id}`, false, "missing"); continue; }
    try { el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); }
    catch (e) { errors.push(`click #${id}: ${e.message}`); }
  }
  await sleep(600);
  check("no new errors after toolbar clicks", errors.length === before,
    errors.slice(before, before + 3).join(" | "));
  check("table still rendered after toolbar clicks",
    doc.querySelectorAll("#eTbody tr").length > 0,
    `${doc.querySelectorAll("#eTbody tr").length} rows`);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  if (errors.length) console.log("captured errors:\n  " + errors.slice(0, 8).join("\n  "));
  dom.window.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
