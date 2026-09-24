#!/usr/bin/env node
/* Deterministic local upstream for the registered `mock-llm` supplier
 * (FlowModus `registry/free/mock-llm.json` -> http://127.0.0.1:59099/v1).
 *
 * WHY THIS FILE IS IN THE REPO: it is the only thing that can drive the EXECUTOR
 * leg without a supplier credential. Without it the chain can be "reachable" —
 * every port answering, every lamp lit — while no turn has ever called a tool,
 * which is exactly the state this session found: `assistant/attempt` read
 * "no calls planned — answered directly" on every single turn, and no recording
 * contained a `tool/call`. A fixture that lives in /tmp proves nothing tomorrow.
 *
 * MODES
 *   tool (default) the reasoning protocol's CALL form -> a tool round happens
 *   fail           a call the tool REJECTS -> a failing check/status exists
 *   text           a plain reply -> plans no call (the RED case for the criterion)
 * MOCK_MODE=tool -> answer with the reasoning protocol's CALL form, so the
 * executor leg (anaphase -> tentacle -> tool/result -> check) actually runs.
 * MOCK_MODE=text -> plain reply, which plans no call (the red case).
 */
'use strict';
const http = require('http');
const PORT = Number(process.env.MOCK_PORT || 59099);
const MODE = process.env.MOCK_MODE || 'tool';
/* 'fail' plans a call the TOOL will reject, so the recorded chain contains a
 * failing check. `pt_replay` needs that shape and it cannot be invented: the
 * suite reads real recordings by design. The red is producible on demand
 * instead of being skipped for want of a fixture. */
const PLAN_FAIL = JSON.stringify({ calls: [{ tool: 'calc', args: { expression: '2+' } }] });
/* `expect` is an ENUM of tool-kind variants, not a free string: sending
 * "4" made the whole plan fail-closed ("calls schema mismatch: unknown variant
 * `4`"). Omitting it is legal (there is a unit test for the missing-expect case). */
const PLAN = JSON.stringify({
  calls: [{ tool: 'calc', args: { expression: '2+2' } }],
});
http.createServer(function (req, res) {
  let body = '';
  req.on('data', function (c) { body += c; });
  req.on('end', function () {
    let model = 'unknown';
    try { model = JSON.parse(body).model || model; } catch (e) {}
    const content = MODE === 'fail' ? PLAN_FAIL : (MODE === 'tool' ? PLAN : 'pong');
    console.log('[mock] ' + req.method + ' ' + req.url + ' model=' + model +
      ' mode=' + MODE + ' bytes=' + body.length);
    const out = JSON.stringify({
      id: 'mock-' + Date.now(), object: 'chat.completion', model: model,
      choices: [{ index: 0, message: { role: 'assistant', content: content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
    });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(out) });
    res.end(out);
  });
}).listen(PORT, '127.0.0.1', function () {
  console.log('[mock] listening on :' + PORT + ' mode=' + MODE);
});
