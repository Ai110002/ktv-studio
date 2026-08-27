#!/usr/bin/env bash
# KTV Studio 一鍵安裝腳本（macOS）
# 自動檢查並安裝：uv（Python 套件管理）、ffmpeg；接著安裝後端依賴。
# 前端已預建置在 repo 內（backend/app/static），不需要 Node.js。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
PYTHON_BIN="$BACKEND_DIR/.venv/bin/python"

echo "==> KTV Studio 安裝開始"

# macOS 才需要 brew；其他系統請自行安裝 uv 與 ffmpeg
if [[ "$(uname -s)" == "Darwin" ]]; then
  if ! command -v brew >/dev/null 2>&1; then
    echo "!! 找不到 Homebrew，請先安裝：https://brew.sh"
    exit 1
  fi

  if ! command -v uv >/dev/null 2>&1; then
    echo "==> 安裝 uv（Python 套件管理工具）…"
    brew install uv
  fi

  if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "==> 安裝 ffmpeg（音訊/影片處理）…（需要一點時間）"
    brew install ffmpeg
  fi
else
  echo "!! 非 macOS：請自行確認已安裝 uv 與 ffmpeg"
  command -v uv >/dev/null 2>&1 || { echo "!! 缺少 uv"; exit 1; }
  command -v ffmpeg >/dev/null 2>&1 || { echo "!! 缺少 ffmpeg"; exit 1; }
fi

echo "==> 安裝後端相依（首次約 5~10 分鐘，會下載 PyTorch 等套件）…"
cd "$BACKEND_DIR"
uv sync

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "!! 後端虛擬環境建立失敗"
  exit 1
fi

echo ""
echo "======================================================"
echo "  安裝完成！啟動方式："
echo "      ./scripts/start.sh"
echo "  啟動後瀏覽器會自動開啟 http://localhost:8000"
echo "  第一次處理歌曲時會自動下載 AI 模型"
echo "  （Demucs 約 330MB、Whisper medium 約 1.5GB）"
echo "======================================================"
