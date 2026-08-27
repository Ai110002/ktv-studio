"""LRCLIB 歌詞庫查詢與 LRC 時間軸解析。"""

from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen


_YOUTUBE_SUFFIX_RE = re.compile(r"\s*-\s*youtube\s*$", re.IGNORECASE)
_LRC_TIMESTAMP_RE = re.compile(
    r"\[(?P<minutes>\d{1,3}):(?P<seconds>[0-5]\d)(?P<fraction>[\.,]\d{1,3})?\]"
)


def _strip_trailing_parenthetical(value: str) -> str:
    """移除最後一個半形／全形左括號至字串結尾的註記。"""

    start = max(value.rfind("("), value.rfind("（"))
    return value[:start].rstrip() if start >= 0 else value.rstrip()


def clean_title(title: str) -> str:
    """清理常見的 YouTube 影片標題尾碼，保留歌曲本名。"""

    cleaned = (title or "").strip()
    cleaned = _YOUTUBE_SUFFIX_RE.sub("", cleaned).strip()
    copyright_start = cleaned.find("©")
    if copyright_start >= 0:
        cleaned = cleaned[:copyright_start].rstrip()
    cleaned = _strip_trailing_parenthetical(cleaned).strip()
    return _YOUTUBE_SUFFIX_RE.sub("", cleaned).strip()


def _quoted_song_title(title: str) -> str:
    """取得影片標題中的第一個日文書名號內容。"""

    matches: list[tuple[int, str]] = []
    for opening, closing in (("『", "』"), ("「", "」")):
        start = title.find(opening)
        end = title.find(closing, start + 1)
        if start >= 0 and end > start + 1:
            matches.append((start, title[start + 1 : end].strip()))
    return min(matches, key=lambda item: item[0])[1] if matches else ""


def search_candidates(title: str, artist: str) -> list[tuple[str, str]]:
    """產生由具體到寬鬆的 LRCLIB 搜尋組合，並保留既定順序。"""

    raw_title = (title or "").strip()
    raw_artist = (artist or "").strip()
    candidates: list[tuple[str, str]] = []

    def add(track: str, candidate_artist: str) -> None:
        pair = (track.strip(), candidate_artist.strip())
        if pair[0] and pair not in candidates:
            candidates.append(pair)

    left = ""
    right = ""
    if " - " in raw_title:
        left, right = (part.strip() for part in raw_title.split(" - ", 1))
        add(right, left)
        add(right, "")

    quoted = _quoted_song_title(raw_title)
    if quoted:
        add(quoted, "")

    if right:
        add(_strip_trailing_parenthetical(right), left)

    normalized_title = clean_title(raw_title)
    add(normalized_title, raw_artist)
    add(normalized_title, "")
    return candidates


def _timestamp_seconds(match: re.Match[str]) -> float:
    fraction = match.group("fraction") or ""
    decimal = float(f"0{fraction.replace(',', '.')}") if fraction else 0.0
    return int(match.group("minutes")) * 60 + int(match.group("seconds")) + decimal


def parse_lrc(text: str) -> list[dict[str, Any]]:
    """解析 LRC 為 KTV Studio 行級字幕格式。

    同一個時間點的連續標記會合併為一行；每行結束時間採下一行的開始時間，
    最後一行則保留五秒。
    """

    timestamped_lines: list[tuple[float, str]] = []
    for raw_line in (text or "").splitlines():
        matches = list(_LRC_TIMESTAMP_RE.finditer(raw_line))
        if not matches:
            continue
        lyric = raw_line[matches[-1].end() :].strip()
        if not lyric:
            continue
        for match in matches:
            timestamped_lines.append((round(_timestamp_seconds(match), 3), lyric))

    if not timestamped_lines:
        return []

    timestamped_lines.sort(key=lambda item: item[0])
    merged: list[dict[str, Any]] = []
    for start, lyric in timestamped_lines:
        if merged and merged[-1]["start"] == start:
            previous = str(merged[-1]["text"])
            if lyric != previous:
                merged[-1]["text"] = f"{previous} {lyric}".strip()
            continue
        merged.append({"start": start, "text": lyric})

    lines: list[dict[str, Any]] = []
    for index, line in enumerate(merged):
        start = float(line["start"])
        end = float(merged[index + 1]["start"]) if index + 1 < len(merged) else start + 5.0
        lines.append({"start": start, "end": round(end, 3), "text": line["text"]})
    return lines


def _fetch_search_results(track: str, artist: str) -> list[dict[str, Any]]:
    params = {"track_name": track}
    if artist:
        params["artist_name"] = artist
    request = Request(
        f"https://lrclib.net/api/search?{urlencode(params)}",
        headers={"User-Agent": "KTVStudio/0.1"},
    )
    with urlopen(request, timeout=10) as response:  # noqa: S310 - 固定的 LRCLIB API URL。
        payload = json.loads(response.read().decode("utf-8"))
    return [item for item in payload if isinstance(item, dict)] if isinstance(payload, list) else []


def fetch_lrclib_lines(title: str, artist: str = "") -> list[dict[str, Any]] | None:
    """依候選組合盡量取得 LRCLIB 同步歌詞；任何失敗皆靜默降級。"""

    for track, candidate_artist in search_candidates(title, artist):
        try:
            results = _fetch_search_results(track, candidate_artist)
            synced = [
                item
                for item in results
                if isinstance(item.get("syncedLyrics"), str) and item["syncedLyrics"].strip()
            ]
            if not synced:
                continue
            best = max(synced, key=lambda item: len(str(item["syncedLyrics"]).splitlines()))
            lines = parse_lrc(str(best["syncedLyrics"]))
            if len(lines) >= 3:
                return lines
        except Exception:
            # 歌詞庫是最佳努力的 fallback，絕不可讓歌曲處理失敗。
            continue
    return None
