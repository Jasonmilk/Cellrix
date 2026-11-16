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
tent=$(grep -m1 -E '^[[:space:]]*tentacle_endpoint[[:space:]]*=' "$CFG" 2>/dev/null | sed -E 's/^[^=]*=[[:space:]]*"//; s/"[[:space:]]*$//')
envs=$(env | grep -c '^ANAPHASE_REASONING' || true)

if [ -n "${ep:-}" ]; then
  masked=$(printf '%s' "$ep" | sed -E 's#(https?://)[^/]*@#\1***@#')
  echo "YES  reasoning_endpoint=${masked:0:60}  model=${md:-?}  key=$([ "${key:-0}" -gt 0 ] && echo set || echo none)  env=${envs}  mtime=$mtime"
  # 工具段还有第二道前置（读码确认）：pipeline 必须 Bound ⇔ tentacle_endpoint 存在
  if [ -n "${tent:-}" ]; then
    tmask=$(printf '%s' "$tent" | sed -E 's#(grpc://|https?://)[^/]*@#\1***@#')
    echo "     tentacle_endpoint=${tmask:0:60}  ⇒ 工具段第二道前置已具备"
  else
    echo "     tentacle_endpoint=**缺失** ⇒ pipeline Unbound ⇒ execution point 会 refuse，tool/call 恒 0（fail-closed）"
  fi
  exit 0
else
  echo "NO   config.toml 里没有 reasoning_endpoint（model=${md:-?} · key=$([ "${key:-0}" -gt 0 ] && echo set || echo none) · env=${envs} · mtime=$mtime）"
  echo "     要接真上游：在该文件 [anaphase] 段加一行 reasoning_endpoint = \"https://<网关>\"（不带 /chat/completions）"
  echo "     要走工具段还差：tentacle_endpoint = \"grpc://<tentacle>\"（缺它则 pipeline Unbound，tool/call 恒 0）"
  exit 1
fi
