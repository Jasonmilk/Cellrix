# 真实 tape 样本（生产路径捕获，LLM 为本地桩）

来源：`ANAPHASE_REASONING_ENDPOINT=http://127.0.0.1:19999` + `POST /v1/chat "compute 9^9"`
捕获物：`*.events.jsonl`（session 事件流，10 行）· `ring.json`（`GET /v1/agent/events` 落盘，8 事件）
用途：给重放入口用；**不参与判据分母**（桩诊断跑，不计生产周期）。
