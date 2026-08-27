"""字幕清洗、日文羅馬拼音、繁中轉換與 JSON 組裝。"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable, Mapping
from typing import Any

from opencc import OpenCC
from pykakasi import kakasi


_KAKASI = kakasi()
_OPENCC = OpenCC("s2tw")
_SPACE_RE = re.compile(r"\s+")
_REPEATED_CHAR_RE = re.compile(r"([^\W\d_])\1{3,}", re.UNICODE)
# 注意：不刪除空白，讓 pykakasi 保留英文歌詞內的空格（日文歌常混英文）。
_JA_PUNCTUATION_RE = re.compile(r"[、。！？!?,，．…「」『』（）()\[\]【】〈〉《》・—ー〜～\-]+")


def normalize_language(language: str | None) -> str:
    """將常見語言標記縮成前端使用的 ja／zh／en。"""

    value = (language or "").lower().replace("_", "-")
    if value.startswith("ja") or value == "jpn":
        return "ja"
    if value.startswith("zh") or value in {"cmn", "yue", "chi", "zho"}:
        return "zh"
    if value.startswith("en") or value == "eng":
        return "en"
    return value or "und"


def clean_subtitle_text(value: str | None) -> str:
    """移除控制字元、過多空白與明顯的 Whisper 重複字元。"""

    text = unicodedata.normalize("NFKC", value or "")
    text = "".join(char for char in text if not unicodedata.category(char).startswith("C"))
    text = _SPACE_RE.sub(" ", text).strip()
    # 連續四個以上相同的文字通常是 Whisper 的重複輸出；保留三個避免破壞歌詞語氣。
    return _REPEATED_CHAR_RE.sub(lambda match: match.group(1) * 3, text)


def ja_to_romaji(text: str | None) -> str:
    """以 pykakasi 將日文轉為 Hepburn 羅馬拼音，忽略標點。"""

    source = _JA_PUNCTUATION_RE.sub("", clean_subtitle_text(text))
    if not source:
        return ""

    converted = _KAKASI.convert(source)
    # 段落內可能已含英文空格（pykakasi 原樣保留拉丁文字），合併後壓縮多餘空白。
    return _SPACE_RE.sub(" ", " ".join(piece["hepburn"] for piece in converted if piece.get("hepburn"))).strip()


def zh_to_traditional(text: str | None) -> str:
    """將簡體中文轉為臺灣繁體用字。"""

    return _OPENCC.convert(clean_subtitle_text(text))


def _display_text(text: str, language: str) -> str:
    if language == "zh":
        return zh_to_traditional(text)
    return clean_subtitle_text(text)


def _clean_word(raw_word: Mapping[str, Any], language: str) -> dict[str, Any] | None:
    display = _display_text(str(raw_word.get("text", "")), language)
    if not display:
        return None

    word: dict[str, Any] = {
        "text": display,
        "start": round(float(raw_word.get("start", 0)), 3),
        "end": round(float(raw_word.get("end", raw_word.get("start", 0))), 3),
    }
    if word["end"] < word["start"]:
        word["end"] = word["start"]
    if language == "ja":
        word["romaji"] = ja_to_romaji(display)
    return word


def build_subtitles_json(
    *,
    language: str | None,
    title: str,
    source: str,
    lines: Iterable[Mapping[str, Any]],
) -> dict[str, Any]:
    """依設計合約組裝可直接寫入 ``subtitles.json`` 的字典。

    ``lines`` 接受 VTT 樣式的 ``start/end/text`` 或 Whisper 樣式且含 ``words`` 的資料。
    此函式不讀寫檔案，因此可獨立測試。
    """

    resolved_language = normalize_language(language)
    output_lines: list[dict[str, Any]] = []

    for raw_line in lines:
        raw_text = str(raw_line.get("text", ""))
        raw_words = raw_line.get("words")
        words: list[dict[str, Any]] | None = None
        if raw_words is not None:
            words = [
                word
                for candidate in raw_words
                if isinstance(candidate, Mapping)
                for word in [_clean_word(candidate, resolved_language)]
                if word is not None
            ]

        text = _display_text(raw_text, resolved_language)
        if not text and words:
            separator = "" if resolved_language in {"ja", "zh"} else " "
            text = separator.join(word["text"] for word in words)
        if not text:
            continue

        start = round(float(raw_line.get("start", words[0]["start"] if words else 0)), 3)
        end = round(float(raw_line.get("end", words[-1]["end"] if words else start)), 3)
        if end < start:
            end = start

        line: dict[str, Any] = {"start": start, "end": end, "text": text, "words": words}
        if resolved_language == "ja":
            if words:
                line["romaji"] = " ".join(word.get("romaji", "") for word in words).strip()
            else:
                line["romaji"] = ja_to_romaji(text)
        output_lines.append(line)

    return {
        "language": resolved_language,
        "source": source,
        "title": clean_subtitle_text(title),
        "lines": output_lines,
    }
