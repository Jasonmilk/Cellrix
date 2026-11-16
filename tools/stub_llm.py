#!/usr/bin/env python3
"""本地桩 LLM（仅联调用，**不是生产上游**）。

★ 形状必须服从**本仓契约**：`contract::parse_reasoning_output` 期待模型在 content 里
回一个 JSON 计划 `{"calls":[{"tool":...,"args":{...},"expect":"ok"}]}`。
早先版本回的是 OpenAI 风格 `message.tool_calls` ⇒ 本仓适配器根本不读它
⇒ 一直被误判成"适配器缺功能"（2026-11-16 读码纠正）。
真上游接入见 docs/observations/real-upstream-checklist-2026-11-05.md。
"""
import json, http.server, sys
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 19999
PLAN = json.dumps({"calls": [{"tool": "numbers", "args": {"expression": "7**9"}, "expect": "ok"}]})
BODY = {"id": "stub-1", "object": "chat.completion", "created": 0, "model": "stub",
        "choices": [{"index": 0, "finish_reason": "stop",
                      "message": {"role": "assistant", "content": PLAN}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}}
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get('content-length', 0)); self.rfile.read(n)
        b = json.dumps(BODY).encode()
        self.send_response(200); self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass
http.server.HTTPServer(('127.0.0.1', PORT), H).serve_forever()
