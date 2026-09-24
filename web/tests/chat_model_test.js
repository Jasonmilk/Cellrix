/* Live-chat model tag: the reply row must name the LLM that served the turn.
 *
 * The SSE transport is STUBBED on purpose — a real upstream call would make
 * this test depend on a vendor's availability and on a paid key, so it could
 * not be trusted as a regression net. What is verified here is the frontend
 * contract: a terminal line carrying `model` surfaces as the sender-line tag,
 * and a terminal line without it stays untagged (honest absent, never a
 * placeholder). The anaphase half — that the terminal line really carries the
 * field — is verified end-to-end against the live stack.
 *
 * Usage: node chat_model_test.js <panel_base_url>
 */
const { JSDOM, VirtualConsole } = require("jsdom");

const BASE = process.argv[2] || process.env.CELLRIX_PANEL || process.env.PANEL || "";
if (!BASE) { console.log('NEEDS-INPUT: 未给面板地址（argv[2] / CELLRIX_PANEL）—— 端口见 chain.json 的 `panel` 条目'); process.exit(3); }
const MODEL = "agnes-2.5-flash";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(label, cond, detail) {
  const tail = detail ? "  [" + detail + "]" : "";
  if (cond) { pass++; console.log("  PASS  " + label + tail); }
  else { fail++; console.log("  FAIL  " + label + tail); }
}

function sse(payloads) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(c) {
      for (const p of payloads) c.enqueue(enc.encode("data: " + JSON.stringify(p) + "\n\n"));
      c.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

(async () => {
  console.log("== live-chat model tag: " + BASE + " ==");

  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push("jsdomError: " + e.message));

  const html = await (await fetch(BASE + "/")).text();
  let nextPayloads = [];

  const dom = new JSDOM(html, {
    url: BASE + "/", runScripts: "dangerously", pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.fetch = (input, init) => {
        const url = typeof input === "string" && input.startsWith("/")
          ? BASE + input : input;
        if (String(url).includes("/api/chat")) return Promise.resolve(sse(nextPayloads));
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
  await sleep(1500);

  const chatBtn = doc.querySelector('.nav [data-view="chat"]');
  check("chat view reachable through the real toolbar button", !!chatBtn);
  if (chatBtn) chatBtn.click();
  await sleep(300);

  async function send(payloads) {
    nextPayloads = payloads;
    const msgs = doc.getElementById("chat-msgs");
    if (msgs) msgs.innerHTML = "";
    const input = doc.getElementById("chat-text");
    input.value = "ping";
    window.sendChat();
    await sleep(700);
    return doc.querySelector("#chat-msgs .msg.helix .who");
  }

  const tagged = await send([
    { delta: "po" }, { delta: "ng" },
    { done: true, reply: "pong", job_id: "run-deadbeef", model: MODEL },
  ]);
  const tag = tagged && tagged.querySelector(".mdl");
  check("terminal line carrying `model` renders the sender tag", !!tag,
    tagged ? JSON.stringify(tagged.textContent) : "(no .who)");
  check("the tag names the model from the terminal line, not a placeholder",
    !!tag && tag.textContent === MODEL, tag ? tag.textContent : "");

  const untagged = await send([
    { delta: "pong" },
    { done: true, reply: "pong", job_id: "run-deadbeef", model: null },
  ]);
  check("no model in the terminal line -> no tag (honest absent)",
    !!untagged && !untagged.querySelector(".mdl"),
    untagged ? JSON.stringify(untagged.textContent) : "(no .who)");

  check("no script errors", errors.length === 0, errors.slice(0, 3).join(" | "));

  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
