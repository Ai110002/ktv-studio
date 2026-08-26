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


def convert_to_mp4(input_path: Path, output_path: Path) -> Path:
    """將瀏覽器錄的影片（webm/mp4）轉成通用 H.264 + AAC MP4。"""

    output_path.parent.mkdir(parents=True, exist_ok=True)
    _run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(input_path),
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            str(output_path),
        ],
        error_prefix="匯出 MP4 失敗",
    )
    return output_path


def _replace_with_filter(input_path: Path, filter_string: str, *, error_prefix: str) -> Path:
    """以 ffmpeg filter 處理音訊，成功後以暫檔取代原檔。"""

    temporary = input_path.with_name(f".{input_path.stem}.processing.wav")
    temporary.unlink(missing_ok=True)
    try:
        _run(
            [
                "ffmpeg",
                "-y",
                "-i",
                str(input_path),
                "-af",
                filter_string,
                str(temporary),
            ],
            error_prefix=error_prefix,
        )
        temporary.replace(input_path)
    finally:
        temporary.unlink(missing_ok=True)
    return input_path


def stabilize_vocals(input_path: Path) -> Path:
    """人聲軌動態穩定化：壓縮忽大忽小的段落，保留歌聲起伏。

    實測參數（f=100:g=20:p=0.7:m=15）可把逐秒 RMS 起伏 span 從約 56dB
    降到約 39dB；m=15 限制增益變化速度，避免 pumping 感。
    """

    return _replace_with_filter(
        input_path,
        "dynaudnorm=f=100:g=20:p=0.7:m=15",
        error_prefix="人聲穩定化失敗",
    )


def normalize_instrumental(input_path: Path) -> Path:
    """伴奏軌響度正規化（EBU R128 單遍，目標 -16 LUFS），保留音樂動態。"""

    return _replace_with_filter(
        input_path,
        "loudnorm=I=-16:TP=-1.5:LRA=11",
        error_prefix="伴奏響度正規化失敗",
    )


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
