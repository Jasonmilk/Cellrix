#!/usr/bin/env bash
# upstream-manifest.sh —— 生成/校验【引擎副本】的**自签指纹**清单。
#
# ★ 本脚本证明什么、不证明什么（2026-10-28 纠偏）：
#   · 证明：`tools/*.sh` 自上次 `--write` 以来**没被再改过**（副本自我一致）。
#   · **不证明**：副本与 phyt-DNA 上游一致 —— 指纹是 `--write` 时从**副本自己**算出来的，
#     天然看不见「副本落后上游」。上游对齐要另比 phyt-DNA 同名文件
#     （见 helix-mind 仓 docs/helixECO/observations/2026-10-28/phyt-dna-adoption-census.md P2）。
#
# 为什么需要（实证 2026-10-09）：`Cellrix/tools/validate.sh` 是"环境适配的副本"，
# 与上游已差 274 行、且缺后来新增的能力 ⇒ **副本必然漂**。
# 分层原则（极致解耦 + 极致复用）：
#   · **工件**（decisions/ fixtures/ ledger/ 七卷）= 每项目一份（它们是该项目的事实）
#   · **引擎**（tools/*.sh）= 可复制以保**零安装自足**，但**必须可校验是否与上游一致**
# 校验用**标准工具**，不发明格式：
#     维护者: bash tools/upstream-manifest.sh --write      # 重算 tools/UPSTREAM.sha256
#     采纳者: shasum -c tools/UPSTREAM.sha256              # 一行查出引擎是否漂
# 而**路径永远不必改脚本**（声明式）：
#     PHYT_DECISIONS=docs/decisions PHYT_FIXTURES=fixtures bash tools/validate.sh
set -uo pipefail
MAN="tools/UPSTREAM.sha256"
FILES=$(ls tools/*.sh | grep -vE '^tools/(upstream-manifest)\.sh$')
if [ "${1:-}" = "--write" ]; then
  # shellcheck disable=SC2086
  shasum $FILES > "$MAN"
  printf '已写入 %s（%s 个引擎文件）\n' "$MAN" "$(printf '%s\n' $FILES | wc -l | tr -d ' ')"
else
  [ -f "$MAN" ] || { printf '缺 %s ⇒ 维护者先跑：bash tools/upstream-manifest.sh --write\n' "$MAN"; exit 2; }
  if shasum -c "$MAN" >/dev/null 2>&1; then
    printf 'OK: 引擎副本与本仓自签指纹一致（%s）—— 这只证明副本没被再改过；**不证明与上游一致**（上游对齐要另比 phyt-DNA 的同名文件）\n' "$MAN"
  else
    printf '★ 引擎副本已漂（与自签指纹 %s 不一致）⇒ 要么本地改过（写进提交信息）、要么同步上游后忘了 --write\n' "$MAN"
    shasum -c "$MAN" 2>&1 | grep -v ': OK$' | head -6 || true
    exit 1
  fi
fi
