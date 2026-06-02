#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  echo "$1" >&2
  exit 1
}

APP_OPENED=false
REMOVE_USER_DATA_DIR=false
SMOKE_USER_DATA_DIR="${SPEAKMORE_USER_DATA_DIR:-}"

json_field() {
  python3 -c 'import json, sys; payload = json.load(sys.stdin); value = payload.get(sys.argv[1], ""); print("" if value is None else value)' "$1"
}

wait_for_port_free() {
  local attempts="${1:-30}"
  for _ in $(seq 1 "$attempts"); do
    if ! lsof -nP -iTCP:8000 -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

quit_app() {
  osascript -e 'tell application "SpeakMore" to quit' >/dev/null 2>&1 || true
}

cleanup() {
  if [[ "$APP_OPENED" == "true" ]]; then
    quit_app
    wait_for_port_free 30 >/dev/null 2>&1 || true
  fi
  if [[ "$REMOVE_USER_DATA_DIR" == "true" && -n "$SMOKE_USER_DATA_DIR" ]]; then
    rm -rf "$SMOKE_USER_DATA_DIR"
  fi
}

trap cleanup EXIT

wait_for_status() {
  local expected="$1"
  local last=""
  for _ in {1..90}; do
    if last="$(curl -fsS http://127.0.0.1:8000/model/status 2>/dev/null)"; then
      if [[ -z "$expected" || "$(printf '%s' "$last" | json_field status)" == "$expected" ]]; then
        printf '%s' "$last"
        return 0
      fi
    fi
    sleep 2
  done
  echo "$last" >&2
  return 1
}

start_model_load() {
  curl -fsS -X POST http://127.0.0.1:8000/model/download -H 'Content-Type: application/json' -d '{}' >/dev/null
}

assert_mps_ready() {
  local ready_status
  local device
  local fallback_reason
  ready_status="$(wait_for_status ready)" || fail "$1"
  device="$(printf '%s' "$ready_status" | json_field device)"
  fallback_reason="$(printf '%s' "$ready_status" | json_field fallback_reason)"
  if [[ "$device" != "mps" || -n "$fallback_reason" ]]; then
    echo "$ready_status" >&2
    fail "MPS 加载结果不符合预期"
  fi
}

APP_PATH="${APP_PATH:-}"
if [[ -z "$APP_PATH" ]]; then
  APP_PATH="$(find "$ROOT/release" -maxdepth 4 -type d -name 'SpeakMore.app' 2>/dev/null | sort | tail -n 1 || true)"
fi

[[ -n "$APP_PATH" && -d "$APP_PATH" ]] || fail "未找到 SpeakMore.app，请先运行 npm run build:app:mac"

if lsof -nP -iTCP:8000 -sTCP:LISTEN >/dev/null 2>&1; then
  fail "8000 端口已被占用，请先关闭开发态后端或其它 SpeakMore 实例"
fi

if [[ -z "$SMOKE_USER_DATA_DIR" ]]; then
  SMOKE_USER_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/speakmore-mps-smoke.XXXXXX")"
  REMOVE_USER_DATA_DIR=true
fi

export SPEAKMORE_USER_DATA_DIR="$SMOKE_USER_DATA_DIR"

USER_DATA_DIR="$SMOKE_USER_DATA_DIR"
LOCAL_DATA_DIR="$USER_DATA_DIR/local-data"
SETTINGS_FILE="$LOCAL_DATA_DIR/settings.json"
mkdir -p "$LOCAL_DATA_DIR"

python3 - "$SETTINGS_FILE" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
try:
    settings = json.loads(path.read_text("utf-8"))
except Exception:
    settings = {}
settings["asrDeviceMode"] = "mps"
path.write_text(json.dumps(settings, ensure_ascii=False, indent=2), "utf-8")
PY

open "$APP_PATH"
APP_OPENED=true
status="$(wait_for_status "")" || fail "打包态 App 未启动后端"

requested="$(printf '%s' "$status" | json_field requested_device)"
if [[ "$requested" != "mps" ]]; then
  echo "$status" >&2
  fail "首次启动后端没有读取 MPS 设置"
fi

start_model_load
assert_mps_ready "MPS 模型加载未进入 ready"

quit_app
if ! wait_for_port_free 30; then
  fail "App 退出后后端仍在监听 8000"
fi

open "$APP_PATH"
reopened_status="$(wait_for_status "")" || fail "重开 App 后后端未启动"
reopened_requested="$(printf '%s' "$reopened_status" | json_field requested_device)"
if [[ "$reopened_requested" != "mps" ]]; then
  echo "$reopened_status" >&2
  fail "重开后端没有保持 MPS 设置"
fi
start_model_load
assert_mps_ready "重开后 MPS 模型加载未进入 ready"

quit_app
if ! wait_for_port_free 30; then
  fail "烟测完成后后端仍在监听 8000"
fi
APP_OPENED=false

echo "packaged MPS smoke passed: $APP_PATH"
