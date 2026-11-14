#!/usr/bin/env python3
"""本地桩 LLM（仅联调用，**不是生产上游**）。
回一个 OpenAI-compatible 的 tool_calls 响应，用来验证"出口"通路。
真上游接入见 docs/observations/real-upstream-checklist-2026-11-05.md。
"""
import json, http.server, sys
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 19999
BODY = {"id": "stub-1", "object": "chat.completion", "created": 0, "model": "stub",
        "choices": [{"index": 0, "finish_reason": "tool_calls",
                      "message": {"role": "assistant", "content": "",
                                  "tool_calls": [{"id": "call_1", "type": "function",
                                                  "function": {"name": "numbers",
                                                               "arguments": "{\"expression\":\"7**9\"}"}}]}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}}
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get('content-length', 0)); self.rfile.read(n)
        b = json.dumps(BODY).encode()
        self.send_response(200); self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass
http.server.HTTPServer(('127.0.0.1', PORT), H).serve_forever()
