"""使用 faster-whisper 對純人聲軌進行逐字辨識。"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from typing import Any, Callable

from app.config import WHISPER_COMPUTE_TYPE, WHISPER_DEVICE, WHISPER_MODEL_NAME
from app.services.audio import get_duration


class TranscriptionError(RuntimeError):
    """Whisper 辨識失敗。"""


ProgressCallback = Callable[[float, str], None]


@dataclass(frozen=True)
class TranscriptionResult:
    language: str
    segments: list[dict[str, Any]]
    words: list[dict[str, Any]]


_model: Any | None = None
_model_lock = Lock()


def _get_model() -> Any:
    """延遲載入模型，避免 FastAPI 匯入時下載或佔用記憶體。"""

    global _model
    with _model_lock:
        if _model is None:
            try:
                from faster_whisper import WhisperModel

                _model = WhisperModel(
                    WHISPER_MODEL_NAME,
                    device=WHISPER_DEVICE,
                    compute_type=WHISPER_COMPUTE_TYPE,
                )
            except Exception as exc:
                raise TranscriptionError(f"載入 Whisper 模型失敗：{exc}") from exc
    return _model


def transcribe_vocals(
    vocals_path: Path,
    *,
    on_progress: ProgressCallback | None = None,
) -> TranscriptionResult:
    """辨識人聲軌並回傳行級 segments 與展開後的逐字資料。"""

    if not vocals_path.exists():
        raise TranscriptionError("找不到要辨識的人聲音軌")

    try:
        duration = get_duration(vocals_path)
    except Exception:
        duration = 0.0

    if on_progress:
        on_progress(0.02, "正在載入 Whisper 辨識模型")
    model = _get_model()
    try:
        segment_iterator, info = model.transcribe(
            str(vocals_path),
            language=None,
            word_timestamps=True,
            vad_filter=True,
        )
        segments: list[dict[str, Any]] = []
        all_words: list[dict[str, Any]] = []
        for segment in segment_iterator:
            words: list[dict[str, Any]] = []
            for word in segment.words or []:
                item = {
                    "text": word.word,
                    "start": float(word.start),
                    "end": float(word.end),
                }
                words.append(item)
                all_words.append(item)
            item = {
                "text": segment.text,
                "start": float(segment.start),
                "end": float(segment.end),
                "words": words,
            }
            segments.append(item)
            if on_progress:
                fraction = min(0.98, segment.end / duration) if duration else 0.5
                on_progress(fraction, f"正在辨識歌詞 {int(fraction * 100)}%")
    except TranscriptionError:
        raise
    except Exception as exc:
        raise TranscriptionError(f"語音辨識失敗：{exc}") from exc

    if on_progress:
        on_progress(1.0, "語音辨識完成")
    return TranscriptionResult(
        language=str(getattr(info, "language", "und") or "und"),
        segments=segments,
        words=all_words,
    )
