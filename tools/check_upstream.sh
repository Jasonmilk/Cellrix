#!/usr/bin/env bash
# 一行判定「真上游到底配了没」——给"以为写了、其实没落盘"这种情形用（已发生两次）。
# 只读、不回显 key。
set -uo pipefail
ANA="${ANAPHASE_DIR:-$(cd "$(dirname "$0")/../../anaphase-helix" && pwd)}"
CFG="$ANA/config.toml"
[ -f "$CFG" ] || { echo "NO_CONFIG  $CFG 不存在"; exit 4; }
mtime=$(ls -l "$CFG" | awk '{print $6,$7,$8}')
ep=$(grep -m1 -E '^[[:space:]]*reasoning_endpoint[[:space:]]*=' "$CFG" 2>/dev/null | sed -E 's/^[^=]*=[[:space:]]*"//; s/"[[:space:]]*$//')
md=$(grep -m1 -E '^[[:space:]]*reasoning_model[[:space:]]*=' "$CFG" 2>/dev/null | sed -E 's/^[^=]*=[[:space:]]*//; s/"//g')
key=$(grep -cE '^[[:space:]]*reasoning_api_key[[:space:]]*=' "$CFG" 2>/dev/null || true)
envs=$(env | grep -c '^ANAPHASE_REASONING' || true)

if [ -n "${ep:-}" ]; then
  masked=$(printf '%s' "$ep" | sed -E 's#(https?://)[^/]*@#\1***@#')
  echo "YES  endpoint=${masked:0:60}  model=${md:-?}  key=$([ "${key:-0}" -gt 0 ] && echo set || echo none)  env=${envs}  mtime=$mtime"
  exit 0
else
  echo "NO   config.toml 里没有 reasoning_endpoint（model=${md:-?} · key=$([ "${key:-0}" -gt 0 ] && echo set || echo none) · env=${envs} · mtime=$mtime）"
  echo "     要接真上游：在该文件 [anaphase] 段加一行 reasoning_endpoint = \"https://<网关>\"（不带 /chat/completions）"
  exit 1
fi
