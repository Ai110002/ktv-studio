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
DEMUCS_SEGMENT_SECONDS = 12

TOTAL_JOB_STEPS = 5
JOB_STEPS = ("fetch", "separate", "transcribe", "subtitles", "finalize")


def ensure_data_directories() -> None:
    """建立本機資料目錄；可安全地重複呼叫。"""

    SONGS_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
