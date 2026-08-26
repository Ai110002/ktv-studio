#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
PYTHON_BIN="$BACKEND_DIR/.venv/bin/python"
STATIC_INDEX="$BACKEND_DIR/app/static/index.html"

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "找不到後端虛擬環境，正在以 uv 安裝依賴…"
  (cd "$BACKEND_DIR" && uv sync)
fi

if [[ ! -f "$STATIC_INDEX" ]]; then
  echo "找不到前端建置產物，正在安裝並建置前端…"
  (cd "$FRONTEND_DIR" && npm install && npm run build)
fi

echo "正在啟動 KTV Studio：http://localhost:8000"
(
  cd "$BACKEND_DIR"
  exec "$PYTHON_BIN" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
) &
SERVER_PID=$!

cleanup() {
  if kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

sleep 1
open "http://localhost:8000" || true
wait "$SERVER_PID"
