"""YouTube 音訊與字幕下載服務。"""

from __future__ import annotations

import html
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import yt_dlp

from app.services.audio import convert_to_wav
from app.services.subtitles import clean_subtitle_text, normalize_language


class DownloadError(RuntimeError):
    """YouTube 下載或字幕取得失敗。"""


ProgressCallback = Callable[[float, str], None]
_TIMESTAMP_RE = re.compile(
    r"(?P<start>\d{1,2}:\d{2}:\d{2}[.,]\d{3}|\d{1,2}:\d{2}[.,]\d{3})\s+-->\s+"
    r"(?P<end>\d{1,2}:\d{2}:\d{2}[.,]\d{3}|\d{1,2}:\d{2}[.,]\d{3})"
)
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_PUNCTUATION_RE = re.compile(r"[\s、。！？!?,，．…：；「」『』（）()\[\]【】〈〉《》・—ー〜～\-]+")


@dataclass(frozen=True)
class DownloadResult:
    source_path: Path
    wav_path: Path
    title: str
    artist: str
    language_hint: str
    subtitle_lines: list[dict[str, Any]] | None


def _timestamp_to_seconds(value: str) -> float:
    parts = value.replace(",", ".").split(":")
    seconds = float(parts[-1])
    if len(parts) == 3:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + seconds
    return int(parts[0]) * 60 + seconds


def parse_vtt(vtt_content: str) -> list[dict[str, Any]]:
    """解析 WebVTT，處理 YouTube 自動字幕的滾動式重複內容。

    YouTube 自動字幕每一條 cue 會重複前一段文字（rolling captions），
    這裡會合併成連續的完整句子，並移除與前一行重疊的尾巴。
    """

    cues: list[dict[str, Any]] = []
    active_start: float | None = None
    active_end: float | None = None
    text_parts: list[str] = []

    def flush() -> None:
        nonlocal active_start, active_end, text_parts
        if active_start is None or active_end is None:
            text_parts = []
            return
        text = clean_subtitle_text(html.unescape(_HTML_TAG_RE.sub("", " ".join(text_parts))))
        if text:
            cues.append({"start": round(active_start, 3), "end": round(active_end, 3), "text": text})
        active_start = None
        active_end = None
        text_parts = []

    for raw_line in vtt_content.lstrip("\ufeff").splitlines():
        line = raw_line.strip()
        match = _TIMESTAMP_RE.search(line)
        if match:
            flush()
            active_start = _timestamp_to_seconds(match.group("start"))
            active_end = _timestamp_to_seconds(match.group("end"))
            continue
        if not line:
            flush()
            continue
        if active_start is not None and not line.startswith("NOTE"):
            text_parts.append(line)

    flush()

    lines: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    rolled = False

    def commit() -> None:
        nonlocal current, rolled
        if current is None:
            return
        prev_text = lines[-1]["text"] if lines else ""
        text = current["text"]
        if rolled:
            text = _strip_overlap(prev_text, text)
        text = _strip_edge_punctuation(text)
        if text:
            start = max(current["start"], lines[-1]["end"]) if lines else current["start"]
            end = max(current["end"], start)
            lines.append({"start": round(start, 3), "end": round(end, 3), "text": text})
        current = None
        rolled = False

    for cue in cues:
        if current is not None and (
            cue["text"].startswith(current["text"])
            or (len(cue["text"]) < len(current["text"]) and current["text"].endswith(cue["text"]))
        ):
            rolled = True
            current["end"] = max(current["end"], cue["end"])
            if len(cue["text"]) > len(current["text"]):
                current["text"] = cue["text"]
        else:
            commit()
            current = dict(cue)

    commit()
    return lines


def _strip_overlap(prev_text: str, text: str) -> str:
    """移除滾動字幕中與前一行重複的尾巴（忽略標點與空白）。"""

    if not prev_text:
        return text
    previous = _PUNCTUATION_RE.sub("", prev_text)
    current = _PUNCTUATION_RE.sub("", text)
    overlap = 0
    for length in range(min(len(previous), len(current)), 0, -1):
        if current[:length] == previous[-length:]:
            overlap = length
            break
    if overlap == 0:
        return text
    count = 0
    for index, char in enumerate(text):
        if not _PUNCTUATION_RE.match(char):
            count += 1
        if count >= overlap:
            return text[index + 1 :]
    return text


def _strip_edge_punctuation(text: str) -> str:
    """移除行首行尾的標點與空白，保留行內標點（歌詞語氣需要）。"""

    return text.strip(" \u3000\t、。！？!?,，．…：；「」『』（）()[]【】〈〉《》・—ー〜～-♪♫")


def _subtitle_languages(language_hint: str | None) -> list[str]:
    normalized = normalize_language(language_hint)
    variants = {
        "ja": ["ja", "ja-JP"],
        "zh": ["zh", "zh-TW", "zh-Hant", "zh-Hans"],
        "en": ["en", "en-US", "en-GB"],
    }
    preferred = variants.get(normalized, [])
    fallback = [*variants["ja"], *variants["zh"], *variants["en"]]
    return list(dict.fromkeys([*preferred, *fallback]))


def _download_subtitles(url: str, directory: Path, language_hint: str | None) -> tuple[list[dict[str, Any]] | None, str]:
    """逐語言盡量取得手動或自動 VTT 字幕；個別語言失敗不影響其他語言。

    YouTube 對字幕端點有限流（HTTP 429），因此一次只請求一種語言，
    429 時短暫等待重試一次；全部失敗時回傳 (None, hint)。
    """

    collected: list[tuple[list[dict[str, Any]], str]] = []
    for language in _subtitle_languages(language_hint):
        subtitle_template = str(directory / "subtitle.%(ext)s")
        options: dict[str, Any] = {
            "skip_download": True,
            "writesubtitles": True,
            "writeautomaticsub": True,
            "subtitleslangs": [language],
            "subtitlesformat": "vtt",
            "outtmpl": subtitle_template,
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "overwrites": True,
            "retries": 2,
        }
        try:
            with yt_dlp.YoutubeDL(options) as downloader:
                downloader.extract_info(url, download=True)
        except Exception as exc:
            if "429" in str(exc):
                time.sleep(3)  # 限流時稍候再試一次
                try:
                    with yt_dlp.YoutubeDL(options) as downloader:
                        downloader.extract_info(url, download=True)
                except Exception:
                    continue
            else:
                continue

        candidates = sorted(directory.glob(f"subtitle.{language}*.vtt"))
        for candidate in candidates:
            try:
                parsed = parse_vtt(candidate.read_text(encoding="utf-8", errors="replace"))
            except OSError:
                continue
            if parsed and len(parsed) >= 3:
                collected.append((parsed, normalize_language(language)))

    if not collected:
        return None, normalize_language(language_hint)
    best_lines, best_language = max(collected, key=lambda item: len(item[0]))
    return best_lines, best_language


def _find_downloaded_audio(directory: Path, expected_name: str | None) -> Path | None:
    if expected_name:
        candidate = Path(expected_name)
        if candidate.exists() and candidate.is_file():
            return candidate
    excluded_suffixes = {".part", ".ytdl", ".vtt"}
    candidates = [
        path
        for path in directory.glob("source.*")
        if path.is_file() and path.suffix.lower() not in excluded_suffixes
    ]
    return max(candidates, key=lambda path: path.stat().st_mtime) if candidates else None


def download_youtube(
    url: str,
    song_dir: Path,
    *,
    on_progress: ProgressCallback | None = None,
) -> DownloadResult:
    """下載最佳可用音軌、轉 WAV，並嘗試取得 YouTube VTT 字幕。"""

    song_dir.mkdir(parents=True, exist_ok=True)

    def progress_hook(status: dict[str, Any]) -> None:
        if on_progress is None:
            return
        if status.get("status") == "downloading":
            total = status.get("total_bytes") or status.get("total_bytes_estimate") or 0
            downloaded = status.get("downloaded_bytes") or 0
            fraction = downloaded / total if total else 0.05
            on_progress(min(0.75, max(0.02, fraction * 0.75)), "正在下載 YouTube 音訊")
        elif status.get("status") == "finished":
            on_progress(0.82, "正在轉換音訊格式")

    options: dict[str, Any] = {
        "format": "bestaudio/best",
        "outtmpl": str(song_dir / "source.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "progress_hooks": [progress_hook],
        "overwrites": True,
    }
    try:
        with yt_dlp.YoutubeDL(options) as downloader:
            info = downloader.extract_info(url, download=True)
            prepared_name = downloader.prepare_filename(info)
    except Exception as exc:
        raise DownloadError(f"下載 YouTube 音訊失敗：{exc}") from exc

    source_path = _find_downloaded_audio(song_dir, prepared_name)
    if source_path is None:
        raise DownloadError("下載 YouTube 音訊失敗：找不到下載完成的音訊檔")

    wav_path = song_dir / "input.wav"
    try:
        convert_to_wav(source_path, wav_path)
    except Exception as exc:
        raise DownloadError(str(exc)) from exc

    raw_language = str(info.get("language") or "")
    subtitle_lines, subtitle_language = _download_subtitles(url, song_dir, raw_language)
    title = clean_subtitle_text(str(info.get("title") or source_path.stem)) or source_path.stem
    artist = clean_subtitle_text(str(info.get("artist") or info.get("uploader") or ""))
    if on_progress is not None:
        on_progress(1.0, "音訊與字幕檢查完成")

    return DownloadResult(
        source_path=source_path,
        wav_path=wav_path,
        title=title,
        artist=artist,
        language_hint=subtitle_language,
        subtitle_lines=subtitle_lines,
    )
