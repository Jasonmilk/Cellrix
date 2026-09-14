/* Self-test the offline snapshot: load it with NO backend and NO network, then
 * assert the prove-track view renders and the inspector opens on click.
 *
 * Usage: node snapshot_selftest.js <snapshot.html>
 */
const { JSDOM, VirtualConsole } = require("jsdom");
const path = require("path");
const fs = require("fs");

const FILE = process.argv[2];
const CJK = /[\u4e00-\u9fff]/;
const cjkCount = (s) => (s.match(new RegExp(CJK.source, "g")) || []).length;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(l, c, d) {
  const t = d ? "  [" + d + "]" : "";
  if (c) { pass++; console.log("  PASS  " + l + t); }
  else { fail++; console.log("  FAIL  " + l + t); }
}

(async () => {
  console.log("== offline snapshot self-test: " + path.basename(FILE) + " ==");
  const html = fs.readFileSync(FILE, "utf8");
  check("snapshot embeds the fetch stub", html.includes("__SNAPSHOT__"));
  check("snapshot embeds captured responses", html.includes("var CAPTURED = {"));

  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push("jsdomError: " + e.message));

  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:1/",           // unreachable on purpose
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      // Emulate a real browser: jsdom lacks matchMedia, the page's theme
      // bootstrap calls it. This is a jsdom gap, not a snapshot defect.
      window.matchMedia = (q) => ({
        matches: false, media: q, onchange: null,
        addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
      });
      window.addEventListener("error", (e) =>
        errors.push("window.error: " + (e.error ? e.error.message : e.message)));
    },
  });
  const { window } = dom, doc = window.document;

  await sleep(1500);
  check("no script errors offline", errors.length === 0, errors.slice(0, 2).join(" | "));
  check("snapshot banner present", doc.body.textContent.includes("OFFLINE SNAPSHOT"));

  const view = doc.getElementById("view-prove-track");
  check("#view-prove-track exists", view !== null);
  check("prove-track rendered from the snapshot",
    view && view.textContent.trim().length > 500,
    view ? view.textContent.trim().length + " chars" : "n/a");

  const rows = Array.from(doc.querySelectorAll("#eTbody tr.ev[data-e-ev]"))
    .filter((r) => !r.classList.contains("e-reply"));
  check("event rows present offline", rows.length > 0, rows.length + " rows");

  const chromeText = [
    doc.getElementById("eStats"), doc.querySelector("#eTblVp thead"),
    doc.getElementById("eOvNote"), ...Array.from(doc.querySelectorAll(".e-trk-nm")),
  ].map((e) => (e ? e.textContent : "")).join(" | ");
  check("chrome CJK == 0", cjkCount(chromeText) === 0, "cjk=" + cjkCount(chromeText));
  for (const l of ["TOKENS", "CACHE HIT", "INPUT TOK", "LLM TIME", "TOOL TIME"]) {
    check("chrome shows " + l, chromeText.includes(l));
  }

  if (rows.length) {
    const insp = doc.getElementById("eInsp");
    insp.classList.remove("on");            // start closed, prove the click does it
    rows[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await sleep(400);
    check("click event row opens the inspector offline",
      insp.classList.contains("on"), "on=" + insp.classList.contains("on"));
    const labels = Array.from(insp.querySelectorAll("dt")).map((d) => d.textContent);
    check("inspector field labels ASCII-only",
      labels.length > 0 && labels.every((l) => /^[A-Za-z][A-Za-z ]*$/.test(l)),
      labels.join(" | "));
  }

  const blk = doc.querySelector("#view-prove-track .e-blk[data-e-ev]");
  if (blk) {
    doc.getElementById("eInsp").classList.remove("on");
    blk.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await sleep(400);
    check("click lane block opens the inspector offline",
      doc.getElementById("eInsp").classList.contains("on"));
  }

  const tg = doc.querySelector("[data-e-turntoggle]");
  if (tg) {
    const b = tg.getAttribute("aria-expanded");
    tg.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await sleep(400);
    const t2 = doc.querySelector("[data-e-turntoggle]");
    check("in-table turn toggle flips aria-expanded offline",
      b !== (t2 && t2.getAttribute("aria-expanded")),
      b + " -> " + (t2 && t2.getAttribute("aria-expanded")));
  }

  console.log("");
  console.log("RESULT: " + pass + " passed, " + fail + " failed");
  dom.window.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("SELFTEST ERROR:", e); process.exit(2); });
