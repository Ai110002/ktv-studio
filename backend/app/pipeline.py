"""KTV Studio 的五步驟處理管線。"""

from __future__ import annotations

import asyncio
import json
import re
import shutil
from collections.abc import Callable
from pathlib import Path
from typing import Any

from app.config import SONGS_DIR, UPLOAD_DIR
from app.jobs import JobManager
from app.services.audio import convert_to_wav, get_duration, normalize_instrumental, stabilize_vocals
from app.services.downloader import DownloadError, download_youtube
from app.services.lyrics import fetch_lrclib_lines
from app.services.separator import SeparationError, separate_vocals
from app.services.subtitles import (
    align_user_lyrics_to_timeline,
    build_manual_subtitles_json,
    build_subtitles_json,
    clean_subtitle_text,
    normalize_language,
)
from app.services.transcriber import transcribe_vocals


class PipelineError(RuntimeError):
    """會安全顯示給使用者的管線錯誤。"""


def _infer_language(lines: list[dict[str, Any]], hinted_language: str | None) -> str:
    resolved = normalize_language(hinted_language)
    if resolved != "und":
        return resolved
    text = "".join(str(line.get("text", "")) for line in lines)
    if re.search(r"[\u3040-\u30ff]", text):
        return "ja"
    if re.search(r"[\u3400-\u9fff]", text):
        return "zh"
    if re.search(r"[A-Za-z]", text):
        return "en"
    return "und"


class Pipeline:
    """將同步、耗時的服務放入背景執行緒，並回寫 job 進度。"""

    def __init__(self, job_manager: JobManager) -> None:
        self.job_manager = job_manager

    def _progress_callback(
        self,
        loop: asyncio.AbstractEventLoop,
        job_id: str,
    ) -> Callable[[float, str], None]:
        def report(fraction: float, message: str) -> None:
            future = asyncio.run_coroutine_threadsafe(
                self.job_manager.set_step_progress(job_id, fraction, message), loop
            )
            # 進度訊息可在工作完成後才抵達；忽略該類非關鍵例外。
            future.add_done_callback(lambda completed: completed.exception() if not completed.cancelled() else None)

        return report

    async def _run_align_user_lyrics(
        self,
        job: dict[str, Any],
        song_dir: Path,
        loop: asyncio.AbstractEventLoop,
    ) -> None:
        """保留使用者歌詞原文，僅用既有字幕時間軸進行對齊。"""

        job_id = str(job["job_id"])
        missing_lyrics_error = "找不到貼上的歌詞，請重新送出"
        meta_path = song_dir / "meta.json"
        lyrics_path = song_dir / "lyrics_user.txt"
        if not meta_path.is_file() or not lyrics_path.is_file():
            raise PipelineError(missing_lyrics_error)

        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            lyrics = lyrics_path.read_text(encoding="utf-8").strip()
        except (OSError, json.JSONDecodeError) as exc:
            raise PipelineError(missing_lyrics_error) from exc
        if not isinstance(meta, dict) or not lyrics:
            raise PipelineError(missing_lyrics_error)

        files = meta.get("files")
        title = meta.get("title")
        artist = meta.get("artist")
        language = meta.get("language")
        if not all(isinstance(value, str) and value.strip() for value in (title, language)):
            raise PipelineError(missing_lyrics_error)
        if not isinstance(artist, str):
            raise PipelineError(missing_lyrics_error)

        subtitle_path = song_dir / "subtitles.json"
        if not subtitle_path.is_file():
            raise PipelineError("找不到既有字幕時間軸，請在字幕工作台手動打點")
        try:
            existing_subtitles = json.loads(subtitle_path.read_text(encoding="utf-8"))
            reference_lines = existing_subtitles.get("lines") if isinstance(existing_subtitles, dict) else None
        except (OSError, json.JSONDecodeError) as exc:
            raise PipelineError("讀取既有字幕時間軸失敗") from exc
        if not isinstance(reference_lines, list):
            raise PipelineError("找不到既有字幕時間軸，請在字幕工作台手動打點")

        await self.job_manager.set_step(job_id, "fetch", "讀取既有字幕時間軸")
        await self.job_manager.set_step_progress(job_id, 1.0, "讀取既有字幕時間軸")
        await self.job_manager.set_step(job_id, "separate", "保留既有音軌")
        await self.job_manager.set_step_progress(job_id, 1.0, "保留既有音軌")

        await self.job_manager.set_step(job_id, "transcribe", "保留貼上的歌詞，對齊既有時間軸")
        aligned_lines = align_user_lyrics_to_timeline(lyrics, reference_lines)
        if not aligned_lines:
            raise PipelineError("無法對齊歌詞：請先在字幕工作台建立至少一段時間軸")
        await self.job_manager.set_step_progress(job_id, 1.0, "歌詞已對齊既有時間軸")

        await self.job_manager.set_step(job_id, "subtitles", "正在寫入對齊字幕")
        subtitles = build_manual_subtitles_json(
            language=language,
            title=title,
            lines=aligned_lines,
        )
        try:
            (song_dir / "subtitles.json").write_text(
                json.dumps(subtitles, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        except OSError as exc:
            raise PipelineError("寫入對齊字幕失敗") from exc
        await self.job_manager.set_step_progress(
            job_id,
            1.0,
            "字幕整理完成" if subtitles["lines"] else "未偵測到可用字幕，仍可使用伴奏錄唱",
        )

        await self.job_manager.set_step(job_id, "finalize", "正在完成字幕對齊")
        await self.job_manager.set_step_progress(job_id, 1.0, "字幕對齊完成")
        await self.job_manager.complete(job_id, "已保留貼上的歌詞並完成時間對齊")

    async def run(self, job_id: str) -> None:
        job = await self.job_manager.get(job_id)
        if job is None:
            raise PipelineError("找不到工作資料")
        song_id = str(job["song_id"])
        song_dir = SONGS_DIR / song_id
        loop = asyncio.get_running_loop()
        source_type = str(job.get("source_type"))

        if source_type in {"retranscribe", "align_lyrics"}:
            try:
                await self._run_align_user_lyrics(job, song_dir, loop)
            except PipelineError as exc:
                raise PipelineError(str(exc)) from exc
            except Exception as exc:
                raise PipelineError(f"對齊歌詞時發生錯誤：{exc}") from exc
            return

        song_dir.mkdir(parents=True, exist_ok=True)

        try:
            await self.job_manager.set_step(job_id, "fetch", "正在取得音訊")
            progress = self._progress_callback(loop, job_id)
            source_url: str | None = None
            artist = ""
            subtitle_lines: list[dict[str, Any]] | None = None
            language_hint = "und"

            if source_type == "youtube":
                url = str(job.get("url") or "")
                if not url:
                    raise PipelineError("缺少 YouTube 網址")
                downloaded = await asyncio.to_thread(download_youtube, url, song_dir, on_progress=progress)
                source_path = downloaded.source_path
                input_wav = downloaded.wav_path
                title = clean_subtitle_text(str(job.get("title") or downloaded.title)) or downloaded.title
                artist = downloaded.artist
                subtitle_lines = downloaded.subtitle_lines
                language_hint = downloaded.language_hint
                source_url = url
            elif source_type == "upload":
                upload_id = str(job.get("upload_id") or "")
                upload_path = UPLOAD_DIR / upload_id
                if not upload_id or upload_path.parent != UPLOAD_DIR or not upload_path.is_file():
                    raise PipelineError("找不到上傳的音訊檔，請重新上傳後再試")
                suffix = upload_path.suffix.lower() if re.fullmatch(r"\.[a-z0-9]{1,8}", upload_path.suffix.lower()) else ".bin"
                source_path = song_dir / f"source{suffix}"
                await asyncio.to_thread(shutil.copy2, upload_path, source_path)
                input_wav = song_dir / "input.wav"
                await asyncio.to_thread(convert_to_wav, source_path, input_wav)
                title = clean_subtitle_text(str(job.get("title") or upload_path.stem)) or "未命名歌曲"
                progress(1.0, "上傳音訊準備完成")
            else:
                raise PipelineError("不支援的匯入來源")

            await self.job_manager.set_step(job_id, "separate", "正在分離人聲與伴奏")
            separated = await asyncio.to_thread(
                separate_vocals,
                input_wav,
                song_dir,
                on_progress=self._progress_callback(loop, job_id),
            )
            if input_wav.name == "input.wav":
                input_wav.unlink(missing_ok=True)

            # 音質後處理：人聲穩定化（解決忽大忽小）+ 伴奏響度正規化
            await self.job_manager.set_step_progress(
                job_id, 0.5, "正在穩定化人聲音量"
            )
            await asyncio.to_thread(stabilize_vocals, separated.vocals_path)
            await asyncio.to_thread(normalize_instrumental, separated.instrumental_path)
            await self.job_manager.set_step_progress(
                job_id, 1.0, "音軌後處理完成"
            )

            await self.job_manager.set_step(job_id, "transcribe", "正在辨識歌詞")
            subtitle_source: str
            transcript_lines: list[dict[str, Any]]
            if subtitle_lines and len(subtitle_lines) >= 3:
                subtitle_source = "youtube"
                transcript_lines = subtitle_lines
                language = _infer_language(subtitle_lines, language_hint)
                await self.job_manager.set_step_progress(
                    job_id, 1.0, "已取得 YouTube 字幕，略過語音辨識"
                )
            else:
                await self.job_manager.set_step_progress(job_id, 0.15, "正在搜尋歌詞庫")
                lrc_lines = await asyncio.to_thread(fetch_lrclib_lines, title, artist)
                if lrc_lines:
                    subtitle_source = "lrclib"
                    transcript_lines = lrc_lines
                    language = _infer_language(lrc_lines, language_hint)
                    await self.job_manager.set_step_progress(
                        job_id, 1.0, "已取得歌詞庫字幕（正確歌詞 + 時間軸）"
                    )
                else:
                    await self.job_manager.set_step_progress(job_id, 0.15, "歌詞庫找不到，改用語音辨識")
                    transcription = await asyncio.to_thread(
                        transcribe_vocals,
                        separated.vocals_path,
                        on_progress=self._progress_callback(loop, job_id),
                    )
                    subtitle_source = "whisper"
                    transcript_lines = transcription.segments
                    language = _infer_language(transcript_lines, transcription.language)

            await self.job_manager.set_step(job_id, "subtitles", "正在整理 KTV 字幕")
            subtitles = build_subtitles_json(
                language=language,
                title=title,
                source=subtitle_source,
                lines=transcript_lines,
            )
            subtitle_file = song_dir / "subtitles.json"
            subtitle_file.write_text(json.dumps(subtitles, ensure_ascii=False, indent=2), encoding="utf-8")
            await self.job_manager.set_step_progress(
                job_id,
                1.0,
                "字幕整理完成" if subtitles["lines"] else "未偵測到可用字幕，仍可使用伴奏錄唱",
            )

            await self.job_manager.set_step(job_id, "finalize", "正在完成歌曲資料")
            duration = await asyncio.to_thread(get_duration, separated.instrumental_path)
            meta = {
                "id": song_id,
                "title": title,
                "artist": artist,
                "source_type": source_type,
                "source_url": source_url,
                "language": subtitles["language"],
                "duration": round(duration, 3),
                "created_at": job.get("created_at"),
                "files": {
                    "original": source_path.name,
                    "vocals": separated.vocals_path.name,
                    "instrumental": separated.instrumental_path.name,
                    "cover": "cover.mp3",
                },
            }
            (song_dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
            await self.job_manager.complete(job_id, "處理完成，可以開始錄唱")
        except (DownloadError, SeparationError, TranscriptionError, PipelineError) as exc:
            shutil.rmtree(song_dir, ignore_errors=True)
            raise PipelineError(str(exc)) from exc
        except Exception as exc:
            shutil.rmtree(song_dir, ignore_errors=True)
            raise PipelineError(f"處理歌曲時發生錯誤：{exc}") from exc
