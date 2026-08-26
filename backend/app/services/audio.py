"""ffmpeg 與 ffprobe 的小型、可重用包裝。"""

from __future__ import annotations

import subprocess
from pathlib import Path


class AudioError(RuntimeError):
    """音訊轉檔或讀取失敗。"""


def _run(command: list[str], *, error_prefix: str) -> None:
    try:
        completed = subprocess.run(
            command,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except FileNotFoundError as exc:
        raise AudioError(f"找不到必要的音訊工具：{command[0]}") from exc

    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip().splitlines()
        message = detail[-1] if detail else "未知錯誤"
        raise AudioError(f"{error_prefix}：{message}")


def convert_to_wav(input_path: Path, output_path: Path) -> Path:
    """轉成 Demucs 需要的 44.1kHz、雙聲道 PCM WAV。"""

    output_path.parent.mkdir(parents=True, exist_ok=True)
    _run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(input_path),
            "-vn",
            "-ar",
            "44100",
            "-ac",
            "2",
            "-c:a",
            "pcm_s16le",
            str(output_path),
        ],
        error_prefix="轉換 WAV 失敗",
    )
    return output_path


def convert_to_mp3(input_path: Path, output_path: Path) -> Path:
    """將瀏覽器錄音轉成 192kbps MP3。"""

    output_path.parent.mkdir(parents=True, exist_ok=True)
    _run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(input_path),
            "-vn",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "192k",
            str(output_path),
        ],
        error_prefix="匯出 MP3 失敗",
    )
    return output_path


def get_duration(input_path: Path) -> float:
    """讀取音訊秒數；無法讀取時拋出中文錯誤。"""

    try:
        completed = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(input_path),
            ],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except FileNotFoundError as exc:
        raise AudioError("找不到 ffprobe，請先安裝 ffmpeg") from exc

    if completed.returncode != 0:
        detail = completed.stderr.strip().splitlines()
        raise AudioError(f"讀取音訊長度失敗：{detail[-1] if detail else '未知錯誤'}")

    try:
        return max(0.0, float(completed.stdout.strip()))
    except ValueError as exc:
        raise AudioError("讀取音訊長度失敗：ffprobe 未回傳有效秒數") from exc
