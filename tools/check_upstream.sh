#!/usr/bin/env bash
# 一行判定「真上游到底配了没」——给"以为写了、其实没落盘"这种情形用（已发生两次）。
# 只读、不回显 key。
set -uo pipefail
ANA="${ANAPHASE_DIR:-$(cd "$(dirname "$0")/../../anaphase-helix" && pwd)}"
CFG="$ANA/config.toml"
[ -f "$CFG" ] || { echo "NO_CONFIG  $CFG 不存在"; exit 4; }
mtime=$(ls -l "$CFG" | awk '{print $6,$7,$8}')
# B1-t（2026-11-19）：引擎对**重复键**是硬失败（实测：`Error: TomlError { message: "duplicate key
# `reasoning_endpoint` in table `anaphase`" }` · rc=1），而本脚本只用 `grep -m1` 取第一行 ⇒
# 对同一份配置它说 YES/rc=0 —— **假阳性**：报"配好了"，引擎根本起不来。
# 修：本脚本读的每个键都数一次出现次数，>1 直接 UNMEASURABLE（rc=4），不猜哪一行生效。
dup_check() {
  local key="$1" n
  n=$(grep -cE "^[[:space:]]*${key}[[:space:]]*=" "$CFG" 2>/dev/null || true)
  if [ "${n:-0}" -gt 1 ]; then
    echo "UNMEASURABLE: $key 在 $CFG 里出现 ${n} 次 —— 引擎会拒绝该配置（TomlError: duplicate key），读数无意义"
    exit 4
  fi
}
dup_check reasoning_endpoint
dup_check tentacle_endpoint
ep=$(grep -m1 -E '^[[:space:]]*reasoning_endpoint[[:space:]]*=' "$CFG" 2>/dev/null | sed -E 's/^[^=]*=[[:space:]]*"//; s/"[[:space:]]*$//')
md=$(grep -m1 -E '^[[:space:]]*reasoning_model[[:space:]]*=' "$CFG" 2>/dev/null | sed -E 's/^[^=]*=[[:space:]]*//; s/"//g')
key=$(grep -cE '^[[:space:]]*reasoning_api_key[[:space:]]*=' "$CFG" 2>/dev/null || true)
tent=$(grep -m1 -E '^[[:space:]]*tentacle_endpoint[[:space:]]*=' "$CFG" 2>/dev/null | sed -E 's/^[^=]*=[[:space:]]*"//; s/"[[:space:]]*$//')
envs=$(env | grep -c '^ANAPHASE_REASONING' || true)

# B1-j（2026-11-19）：本脚本原来**只读 config.toml**，而 `src/config.rs:472-473` 用
# `take(&mut cfg.X, "ANAPHASE_*")` 让 **env 覆盖 config** —— 于是"config 没这行、env 有"
# 这种**真上游已接通**的情形会被判 NO（假阴性，rc=1），而同一行还打印 `env=1`（读了不用）。
# 修：config 缺 ⇒ 看 env；两者任一存在即 YES，并如实标 `src=config|env|config+env`。
ep_cfg="${ep:-}"; ep_env="${ANAPHASE_REASONING_ENDPOINT:-}"
if [ -n "$ep_cfg" ] && [ -n "$ep_env" ]; then ep_src="config+env"
elif [ -n "$ep_cfg" ]; then ep_src="config"
elif [ -n "$ep_env" ]; then ep_src="env"
else ep_src="none"; fi
[ -n "${ep:-}" ] || ep="$ep_env"
tent_cfg="${tent:-}"; tent_env="${ANAPHASE_TENTACLE_ENDPOINT:-}"
[ -n "${tent:-}" ] || tent="$tent_env"
md="${md:-${ANAPHASE_REASONING_MODEL:-}}"
[ "$ep_src" != "none" ] && ep_src="src=${ep_src}"
if [ -n "${ep:-}" ]; then
  masked=$(printf '%s' "$ep" | sed -E 's#(https?://)[^/]*@#\1***@#')
  echo "YES  ${ep_src}  reasoning_endpoint=${masked:0:60}  model=${md:-?}  key=$([ "${key:-0}" -gt 0 ] && echo set || echo none)  env=${envs}  mtime=$mtime"
  # 工具段还有第二道前置（读码确认）：pipeline 必须 Bound ⇔ tentacle_endpoint 存在
  # 两边都有且不同 ⇒ 运行时是 env 生效（config.rs:473 覆盖语义），显示值必须说清是谁
  if [ -n "$ep_cfg" ] && [ -n "$ep_env" ] && [ "$ep_cfg" != "$ep_env" ]; then
    echo "     ⚠ config 与 env 不同：运行时**以 env 为准**（env=$ep_env）"
  fi
  if [ -n "${tent:-}" ]; then
    tmask=$(printf '%s' "$tent" | sed -E 's#(grpc://|https?://)[^/]*@#\1***@#')
    echo "     tentacle_endpoint=${tmask:0:60}  ⇒ 工具段第二道前置已具备"
  else
    echo "     tentacle_endpoint=**缺失** ⇒ pipeline Unbound ⇒ execution point 会 refuse，tool/call 恒 0（fail-closed）"
  fi
  # B1-ze（2026-11-20）：本脚本只看 **config 文件 + 调用者自己的 env**，
  # 但真正在跑的是 50061 上的进程；它自己的 env 覆盖本脚本看不见。
  # 实测：config 写 qwen3.8-27b，进程 env 设 ANAPHASE_REASONING_MODEL=coder-14b
  # ⇒ 本脚本报 model=qwen3.8-27b（**与实际运行不符，且无任何提示**）。
  # 修：读监听进程的 env（`ps -Eww`），发现覆盖就如实告警"config 值不生效"。
  _pid=$(lsof -ti -i :50061 2>/dev/null | head -1)
  if [ -n "${_pid:-}" ]; then
    _penv=$(ps -Eww -p "$_pid" 2>/dev/null | tr ' ' '\n' | grep -E '^ANAPHASE_REASONING_(MODEL|ENDPOINT)=' || true)
    if [ -n "${_penv:-}" ]; then
      echo "     ⚠ 运行进程 pid=$_pid 自带 env 覆盖（**config 里的值不生效**）："
      printf '%s\n' "$_penv" | sed -E 's/^/       /'
    fi
  else
    # 无监听进程 ⇒ 运行态 env **无法核对** ⇒ 具名 UNMEASURABLE 并给子项 rc=4（不当作通过）。
    echo "     运行态 env 核对：UNMEASURABLE（50061 无监听进程；该子项 rc=4，不计入上面的 YES/NO 与 src 口径）"
  fi
  exit 0
else
  echo "NO   既无 config.toml 的 reasoning_endpoint、也无 ANAPHASE_REASONING_ENDPOINT（model=${md:-?} · key=$([ "${key:-0}" -gt 0 ] && echo set || echo none) · env=${envs} · mtime=$mtime）"
  echo "     要接真上游：在该文件 [anaphase] 段加一行 reasoning_endpoint = \"https://<网关>\"（不带 /chat/completions）"
  echo "     要走工具段还差：tentacle_endpoint = \"grpc://<tentacle>\"（缺它则 pipeline Unbound，tool/call 恒 0）"
  exit 1
fi
