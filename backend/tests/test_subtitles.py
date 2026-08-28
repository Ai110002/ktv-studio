"""手動字幕更新 API 與字幕正規化測試。"""

from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pydantic import ValidationError

from app.main import SubtitleLineUpdate, UpdateSubtitlesRequest, update_subtitles
from app.services.subtitles import align_user_lyrics_to_timeline, build_manual_subtitles_json, build_subtitles_json


class SubtitleRequestValidationTests(unittest.TestCase):
    def test_accepts_valid_line_and_empty_request(self) -> None:
        line = SubtitleLineUpdate(start=1.25, end=2.5, text="  第一行  ")

        self.assertEqual(line.text, "第一行")
        self.assertEqual(UpdateSubtitlesRequest(lines=[line]).lines[0].start, 1.25)
        self.assertEqual(UpdateSubtitlesRequest().lines, [])

    def test_rejects_invalid_time_text_and_payload_shape(self) -> None:
        invalid_lines = (
            {"start": float("nan"), "end": 1, "text": "字幕"},
            {"start": 0, "end": float("inf"), "text": "字幕"},
            {"start": 2, "end": 1, "text": "字幕"},
            {"start": 0, "end": 1, "text": "   "},
            {"start": 0, "end": 1, "text": "字" * 501},
            {"start": 0, "end": 1, "text": "字幕", "path": "../../meta.json"},
        )
        for payload in invalid_lines:
            with self.subTest(payload=payload):
                with self.assertRaises(ValidationError):
                    SubtitleLineUpdate.model_validate(payload)

        with self.assertRaises(ValidationError):
            UpdateSubtitlesRequest(lines=[{"start": 0, "end": 1, "text": "字幕"}] * 2001)
        with self.assertRaises(ValidationError):
            UpdateSubtitlesRequest.model_validate({"lines": [], "source": "manual"})


class SubtitleNormalizationTests(unittest.TestCase):
    def test_manual_source_clears_words_and_localizes_text(self) -> None:
        subtitles = build_subtitles_json(
            language="zh-TW",
            title="測試歌曲",
            source="manual",
            lines=[{"start": 0, "end": 2, "text": "测试歌词", "words": None}],
        )

        self.assertEqual(subtitles["source"], "manual")
        self.assertEqual(subtitles["lines"][0]["text"], "測試歌詞")
        self.assertIsNone(subtitles["lines"][0]["words"])

    def test_japanese_manual_source_generates_romaji_without_words(self) -> None:
        subtitles = build_subtitles_json(
            language="ja",
            title="テスト",
            source="manual",
            lines=[{"start": 0, "end": 3, "text": "こんにちは", "words": None}],
        )

        self.assertEqual(subtitles["source"], "manual")
        self.assertIsNone(subtitles["lines"][0]["words"])
        self.assertIn("konnichi", subtitles["lines"][0]["romaji"])

    def test_manual_lyrics_keep_user_text_without_conversion(self) -> None:
        subtitles = build_manual_subtitles_json(
            language="zh-TW",
            title="測試歌曲",
            lines=[{"start": 0, "end": 2, "text": "测试歌词（使用者原文）"}],
        )

        self.assertEqual(subtitles["source"], "manual")
        self.assertEqual(subtitles["lines"][0]["text"], "测试歌词（使用者原文）")
        self.assertIsNone(subtitles["lines"][0]["words"])

    def test_align_user_lyrics_reuses_timestamps_without_recognition(self) -> None:
        reference = [
            {"start": 1.0, "end": 2.5, "text": "辨識到的第一句"},
            {"start": 3.0, "end": 5.0, "text": "辨識到的第二句"},
        ]

        aligned = align_user_lyrics_to_timeline("使用者正確第一句\n使用者正確第二句", reference)

        self.assertEqual(
            aligned,
            [
                {"start": 1.0, "end": 2.5, "text": "使用者正確第一句"},
                {"start": 3.0, "end": 5.0, "text": "使用者正確第二句"},
            ],
        )

    def test_align_single_line_preserves_every_character(self) -> None:
        reference = [
            {"start": 0.0, "end": 2.0, "text": "短句"},
            {"start": 2.0, "end": 5.0, "text": "比較長的句子"},
        ]

        aligned = align_user_lyrics_to_timeline("完全不變的使用者歌詞", reference)

        self.assertEqual("".join(line["text"] for line in aligned), "完全不變的使用者歌詞")
        self.assertEqual([(line["start"], line["end"]) for line in aligned], [(0.0, 2.0), (2.0, 5.0)])


class UpdateSubtitlesEndpointTests(unittest.TestCase):
    def test_updates_only_subtitle_file_and_supports_clearing(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            songs_dir = Path(temporary_directory)
            song_dir = songs_dir / "deadbeef"
            song_dir.mkdir()
            meta = {
                "id": "deadbeef",
                "title": "測試歌曲",
                "language": "zh",
                "files": {"instrumental": "instrumental.mp3"},
            }
            (song_dir / "meta.json").write_text(json.dumps(meta), encoding="utf-8")

            request = UpdateSubtitlesRequest(lines=[{"start": 0, "end": 1.25, "text": "測試"}])
            with patch("app.main.SONGS_DIR", songs_dir):
                result = asyncio.run(update_subtitles("deadbeef", request))

            self.assertEqual(result["source"], "manual")
            self.assertEqual(result["lines"][0]["text"], "測試")
            self.assertIsNone(result["lines"][0]["words"])
            self.assertEqual(json.loads((song_dir / "meta.json").read_text(encoding="utf-8")), meta)
            self.assertEqual(json.loads((song_dir / "subtitles.json").read_text(encoding="utf-8")), result)

            with patch("app.main.SONGS_DIR", songs_dir):
                cleared = asyncio.run(update_subtitles("deadbeef", UpdateSubtitlesRequest()))
            self.assertEqual(cleared["source"], "manual")
            self.assertEqual(cleared["lines"], [])


if __name__ == "__main__":
    unittest.main()
