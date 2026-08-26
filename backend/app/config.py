"""KTV Studio 的本機路徑與管線常數。"""

from __future__ import annotations

from pathlib import Path


APP_DIR = Path(__file__).resolve().parent
BACKEND_DIR = APP_DIR.parent
PROJECT_DIR = BACKEND_DIR.parent

DATA_DIR = BACKEND_DIR / "data"
SONGS_DIR = DATA_DIR / "songs"
UPLOAD_DIR = DATA_DIR / "uploads"
JOBS_FILE = DATA_DIR / "jobs.json"
STATIC_DIR = APP_DIR / "static"

VENV_PYTHON = BACKEND_DIR / ".venv" / "bin" / "python"

WHISPER_MODEL_NAME = "medium"
WHISPER_DEVICE = "cpu"
WHISPER_COMPUTE_TYPE = "int8"

DEMUCS_MODEL = "htdemucs"
DEMUCS_STEM = "vocals"
DEMUCS_MPS_DEVICE = "mps"
DEMUCS_CPU_DEVICE = "cpu"
# 品質參數：shifts=1 平均多次偏移結果、overlap=0.5 減少接縫 artifacts（約 2 倍運算）。
DEMUCS_SHIFTS = 1
DEMUCS_OVERLAP = 0.5
# htdemucs 是 Transformer 模型，分段不能超過訓練長度 7.8 秒；
# 不傳 --segment，讓 demucs 自動使用模型預設值。
DEMUCS_SEGMENT_SECONDS = None

TOTAL_JOB_STEPS = 5
JOB_STEPS = ("fetch", "separate", "transcribe", "subtitles", "finalize")


def ensure_data_directories() -> None:
    """建立本機資料目錄；可安全地重複呼叫。"""

    SONGS_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
