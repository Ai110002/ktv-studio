"""以 Demucs 分離人聲與伴奏，並在 MPS 失敗時自動回退 CPU。"""

from __future__ import annotations

import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from app.config import (
    DEMUCS_CPU_DEVICE,
    DEMUCS_MODEL,
    DEMUCS_MPS_DEVICE,
    DEMUCS_STEM,
    VENV_PYTHON,
)


class SeparationError(RuntimeError):
    """Demucs 分離失敗。"""


ProgressCallback = Callable[[float, str], None]
_PERCENT_RE = re.compile(r"(\d{1,3})%")


@dataclass(frozen=True)
class SeparationResult:
    vocals_path: Path
    instrumental_path: Path
    device: str


def _estimate_progress(line: str, current: float) -> float:
    """Demucs 不保證輸出百分比，故以輸出關鍵字提供保守估計。"""

    match = _PERCENT_RE.search(line)
    if match:
        return min(0.95, max(current, int(match.group(1)) / 100))
    lower = line.lower()
    if "separating" in lower or "separate" in lower:
        return max(current, 0.18)
    if "writing" in lower or "save" in lower:
        return max(current, 0.86)
    return min(0.9, current + 0.025)


def _run_demucs(
    input_wav: Path,
    output_dir: Path,
    device: str,
    on_progress: ProgressCallback | None,
) -> None:
    if not VENV_PYTHON.exists():
        raise SeparationError("找不到 backend/.venv 的 Python，請先執行 uv sync")

    command = [
        str(VENV_PYTHON),
        "-m",
        "demucs",
        f"--two-stems={DEMUCS_STEM}",
        "-d",
        device,
        "-o",
        str(output_dir),
        str(input_wav),
    ]
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    recent_lines: list[str] = []
    progress = 0.04
    if on_progress:
        on_progress(progress, f"正在以 {device.upper()} 分離音軌")

    assert process.stdout is not None
    for raw_line in process.stdout:
        line = raw_line.strip()
        if line:
            recent_lines.append(line)
            recent_lines = recent_lines[-8:]
            progress = _estimate_progress(line, progress)
            if on_progress:
                on_progress(progress, f"分離音軌 {int(progress * 100)}%")

    return_code = process.wait()
    if return_code != 0:
        detail = recent_lines[-1] if recent_lines else f"Demucs 結束代碼 {return_code}"
        raise SeparationError(f"Demucs（{device.upper()}）失敗：{detail}")


def separate_vocals(
    input_wav: Path,
    song_dir: Path,
    *,
    on_progress: ProgressCallback | None = None,
) -> SeparationResult:
    """將輸入 WAV 分為 ``vocals.wav`` 與 ``instrumental.wav``。"""

    if not input_wav.exists():
        raise SeparationError("找不到要分離的 WAV 音訊")

    work_dir = song_dir / ".demucs"
    errors: list[str] = []
    used_device = DEMUCS_MPS_DEVICE
    for index, device in enumerate((DEMUCS_MPS_DEVICE, DEMUCS_CPU_DEVICE)):
        if work_dir.exists():
            shutil.rmtree(work_dir)
        work_dir.mkdir(parents=True, exist_ok=True)
        try:
            if index == 1 and on_progress:
                on_progress(0.05, "MPS 分離失敗，正在改用 CPU 重試")
            _run_demucs(input_wav, work_dir, device, on_progress)
            used_device = device
            break
        except SeparationError as exc:
            errors.append(str(exc))
    else:
        raise SeparationError("去人聲失敗，已嘗試 MPS 與 CPU：" + "；".join(errors))

    vocals = next(work_dir.rglob("vocals.wav"), None)
    instrumental = next(work_dir.rglob("no_vocals.wav"), None)
    if vocals is None or instrumental is None:
        raise SeparationError("Demucs 已完成但找不到人聲或伴奏輸出檔")

    output_vocals = song_dir / "vocals.wav"
    output_instrumental = song_dir / "instrumental.wav"
    shutil.copy2(vocals, output_vocals)
    shutil.copy2(instrumental, output_instrumental)
    shutil.rmtree(work_dir, ignore_errors=True)
    if on_progress:
        on_progress(1.0, "人聲與伴奏分離完成")

    return SeparationResult(output_vocals, output_instrumental, used_device)
