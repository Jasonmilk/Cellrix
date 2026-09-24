const { JSDOM, VirtualConsole } = require("jsdom");
const BASE = process.argv[2] || process.env.CELLRIX_PANEL || process.env.PANEL || "";
if (!BASE) { console.log('NEEDS-INPUT: 未给面板地址（argv[2] / CELLRIX_PANEL）—— 端口见 chain.json 的 `panel` 条目'); process.exit(3); }
const JOB = require("fs").readFileSync("/tmp/richest_job.txt", "utf8").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(l, c, d) {
  const tail = d ? "  [" + d + "]" : "";
  if (c) { pass++; console.log("  PASS  " + l + tail); }
  else { fail++; console.log("  FAIL  " + l + tail); }
}

(async () => {
  const html = await (await fetch(BASE + "/")).text();
  const dom = new JSDOM(html, {
    url: BASE + "/", runScripts: "dangerously", pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
    beforeParse(w) {
      w.fetch = (i, init) => fetch(typeof i === "string" && i.startsWith("/") ? BASE + i : i, init);
      w.matchMedia = (q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
    },
  });
  const { window } = dom, doc = window.document;
  await sleep(2000);
  const items = Array.from(doc.querySelectorAll("#s-side .ses-item"));
  (items.find((el) => el.textContent.includes(JOB.slice(0, 12))) || items[0])
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(1800);

  const insp = () => doc.getElementById("eInsp");
  const on = () => insp().classList.contains("on");
  const evOf = (el) => el.getAttribute("data-e-ev");
  const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const dtText = () => Array.from(insp().querySelectorAll("dt")).map((d) => d.textContent).join(" | ");
  const aria = () => {
    const t = doc.querySelector("[data-e-turntoggle]");
    return t ? t.getAttribute("aria-expanded") : null;
  };

  console.log("== AS SHIPPED (markup data-e-ev, code reads dataset.ev) ==");
  let row = doc.querySelector("#eTbody tr.ev[data-e-ev]");
  click(row);
  await sleep(250);
  check("click event row -> inspector opens", on(), "on=" + on());
  let blk = doc.querySelector("#view-prove-track .e-blk[data-e-ev]");
  if (blk) {
    click(blk);
    await sleep(250);
    check("click lane block -> inspector opens", on(), "on=" + on());
  } else { check("lane block exists", false, "none"); }
  let tb = doc.querySelector("[data-e-turntoggle]");
  if (tb) {
    const b = aria();
    click(tb);
    await sleep(250);
    check("in-table turn toggle flips aria-expanded", b !== aria(), b + " -> " + aria());
  } else { check("turn toggle button exists", false, "none"); }

  console.log("");
  console.log("== PROOF: add only the attribute name the code actually reads ==");
  row = doc.querySelector("#eTbody tr.ev[data-e-ev]");
  row.setAttribute("data-ev", evOf(row));
  check("row.dataset.ev becomes defined", row.dataset.ev !== undefined, String(row.dataset.ev));
  click(row);
  await sleep(300);
  check("click event row -> inspector opens", on(), "on=" + on());
  check("inspector field labels are English",
    ["Type", "Status", "Turn", "Duration", "Share", "Tokens"].every((l) => dtText().includes(l)),
    dtText());
  const x = doc.getElementById("eInspX");
  if (x) { click(x); await sleep(250); }

  blk = doc.querySelector("#view-prove-track .e-blk[data-e-ev]");
  if (blk) {
    blk.setAttribute("data-ev", evOf(blk));
    click(blk);
    await sleep(300);
    check("click lane block -> inspector opens", on(), "on=" + on());
    if (x) { click(x); await sleep(250); }
  }

  tb = doc.querySelector("[data-e-turntoggle]");
  if (tb) {
    tb.setAttribute("data-turntoggle", tb.getAttribute("data-e-turntoggle"));
    const b = aria();
    click(tb);
    await sleep(350);
    check("in-table turn toggle flips aria-expanded", b !== aria(), b + " -> " + aria());
  }

  console.log("");
  console.log("RESULT: " + pass + " passed, " + fail + " failed");
  dom.window.close();
})();
