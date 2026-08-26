"""KTV Studio FastAPI 應用程式與本機檔案 API。"""

from __future__ import annotations

import asyncio
import json
import mimetypes
import re
import shutil
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.config import SONGS_DIR, STATIC_DIR, UPLOAD_DIR, ensure_data_directories
from app.jobs import JobManager
from app.pipeline import Pipeline
from app.services.audio import AudioError, convert_to_mp3, convert_to_mp4


class CreateJobRequest(BaseModel):
    source_type: Literal["youtube", "upload"]
    url: str | None = None
    upload_id: str | None = None
    title: str | None = Field(default=None, max_length=300)


job_manager = JobManager()
pipeline = Pipeline(job_manager)
job_manager.set_processor(pipeline.run)


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_data_directories()
    await job_manager.start()
    try:
        yield
    finally:
        await job_manager.stop()


app = FastAPI(title="KTV Studio（卡拉錄唱室）", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _safe_song_dir(song_id: str) -> Path:
    if not re.fullmatch(r"[0-9a-f]{8,32}", song_id):
        raise HTTPException(status_code=404, detail="找不到歌曲")
    return SONGS_DIR / song_id


def _read_json(path: Path, *, not_found_message: str) -> dict[str, Any]:
    if not path.is_file():
        raise HTTPException(status_code=404, detail=not_found_message)
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail="歌曲資料格式損毀") from exc
    if not isinstance(value, dict):
        raise HTTPException(status_code=500, detail="歌曲資料格式損毀")
    return value


def _song_meta(song_id: str) -> tuple[Path, dict[str, Any]]:
    song_dir = _safe_song_dir(song_id)
    return song_dir, _read_json(song_dir / "meta.json", not_found_message="找不到歌曲")


def _song_response(meta: dict[str, Any], song_dir: Path) -> dict[str, Any]:
    result = dict(meta)
    files = dict(result.get("files") or {})
    result["files"] = files
    result["status"] = "ready" if (song_dir / files.get("instrumental", "")).is_file() else "incomplete"
    result["has_cover"] = (song_dir / files.get("cover", "cover.mp3")).is_file()
    result["has_cover_video"] = (song_dir / files.get("cover_video", "cover.mp4")).is_file()
    return result


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/jobs")
async def create_job(request: CreateJobRequest) -> dict[str, str]:
    if request.source_type == "youtube":
        if not request.url or not request.url.strip():
            raise HTTPException(status_code=422, detail="請輸入 YouTube 網址")
    elif request.source_type == "upload":
        if not request.upload_id or not re.fullmatch(r"[0-9a-f]{32}(?:\.[a-z0-9]{1,8})?", request.upload_id):
            raise HTTPException(status_code=422, detail="上傳檔案識別碼無效")
        if not (UPLOAD_DIR / request.upload_id).is_file():
            raise HTTPException(status_code=404, detail="找不到上傳的音訊檔，請重新上傳")

    job = await job_manager.create(
        source_type=request.source_type,
        url=request.url.strip() if request.url else None,
        upload_id=request.upload_id,
        title=request.title.strip() if request.title else None,
    )
    return {"job_id": str(job["job_id"])}


@app.post("/api/upload")
async def upload_audio(file: Annotated[UploadFile, File(...)]) -> dict[str, str]:
    if not file.filename:
        raise HTTPException(status_code=422, detail="請選擇音訊檔")
    suffix = Path(file.filename).suffix.lower()
    if not re.fullmatch(r"\.[a-z0-9]{1,8}", suffix):
        suffix = ".bin"
    upload_id = f"{uuid.uuid4().hex}{suffix}"
    target = UPLOAD_DIR / upload_id
    ensure_data_directories()
    try:
        with target.open("wb") as handle:
            while chunk := await file.read(1024 * 1024):
                handle.write(chunk)
    except OSError as exc:
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="儲存上傳音訊失敗") from exc
    finally:
        await file.close()
    return {"upload_id": upload_id, "filename": file.filename}


@app.get("/api/jobs")
async def list_jobs() -> dict[str, list[dict[str, Any]]]:
    return {"jobs": await job_manager.list()}


@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str) -> dict[str, Any]:
    job = await job_manager.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="找不到工作")
    return job


@app.get("/api/songs")
async def list_songs() -> dict[str, list[dict[str, Any]]]:
    ensure_data_directories()
    songs: list[dict[str, Any]] = []
    for song_dir in SONGS_DIR.iterdir():
        if not song_dir.is_dir():
            continue
        try:
            meta = _read_json(song_dir / "meta.json", not_found_message="找不到歌曲")
        except HTTPException:
            continue
        songs.append(_song_response(meta, song_dir))
    songs.sort(key=lambda song: str(song.get("created_at") or ""), reverse=True)
    return {"songs": songs}


@app.get("/api/songs/{song_id}")
async def get_song(song_id: str) -> dict[str, Any]:
    song_dir, meta = _song_meta(song_id)
    return _song_response(meta, song_dir)


@app.get("/api/songs/{song_id}/audio/{kind}")
async def stream_audio(song_id: str, kind: Literal["original", "vocals", "instrumental", "cover", "cover_video"]) -> FileResponse:
    song_dir, meta = _song_meta(song_id)
    filename = str((meta.get("files") or {}).get(kind) or "")
    if not filename or Path(filename).name != filename:
        raise HTTPException(status_code=404, detail="找不到音訊檔")
    audio_path = song_dir / filename
    if not audio_path.is_file():
        raise HTTPException(status_code=404, detail="音訊檔尚未產生")
    media_type = mimetypes.guess_type(audio_path.name)[0] or "application/octet-stream"
    return FileResponse(
        audio_path,
        media_type=media_type,
        filename=audio_path.name,
        headers={"Accept-Ranges": "bytes"},
    )


@app.get("/api/songs/{song_id}/subtitles")
async def get_subtitles(song_id: str) -> FileResponse:
    song_dir, _ = _song_meta(song_id)
    subtitle_path = song_dir / "subtitles.json"
    if not subtitle_path.is_file():
        raise HTTPException(status_code=404, detail="字幕檔尚未產生")
    return FileResponse(subtitle_path, media_type="application/json; charset=utf-8")


@app.post("/api/songs/{song_id}/export")
async def export_cover(
    song_id: str,
    recording: Annotated[UploadFile, File(...)],
) -> dict[str, str]:
    song_dir, _ = _song_meta(song_id)
    suffix = Path(recording.filename or "recording.webm").suffix.lower()
    if not re.fullmatch(r"\.[a-z0-9]{1,8}", suffix):
        suffix = ".webm"
    temporary = song_dir / f".recording-{uuid.uuid4().hex}{suffix}"
    try:
        with temporary.open("wb") as handle:
            while chunk := await recording.read(1024 * 1024):
                handle.write(chunk)
        await asyncio.to_thread(convert_to_mp3, temporary, song_dir / "cover.mp3")
    except AudioError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail="儲存錄音檔失敗") from exc
    finally:
        temporary.unlink(missing_ok=True)
        await recording.close()
    return {"url": f"/api/songs/{song_id}/audio/cover", "filename": "cover.mp3"}


@app.post("/api/songs/{song_id}/export-video")
async def export_cover_video(
    song_id: str,
    recording: Annotated[UploadFile, File(...)],
) -> dict[str, str]:
    """將瀏覽器錄製的 Cover 影片轉為可下載的 MP4。"""

    song_dir, meta = _song_meta(song_id)
    suffix = Path(recording.filename or "recording.webm").suffix.lower()
    if not re.fullmatch(r"\.[a-z0-9]{1,8}", suffix):
        suffix = ".webm"
    temporary = song_dir / f".video-recording-{uuid.uuid4().hex}{suffix}"
    output = song_dir / "cover.mp4"
    try:
        with temporary.open("wb") as handle:
            while chunk := await recording.read(1024 * 1024):
                handle.write(chunk)
        await asyncio.to_thread(convert_to_mp4, temporary, output)
        files = dict(meta.get("files") or {})
        files["cover_video"] = "cover.mp4"
        meta["files"] = files
        (song_dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except AudioError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail="儲存或匯出錄影檔失敗") from exc
    finally:
        temporary.unlink(missing_ok=True)
        await recording.close()
    return {"url": f"/api/songs/{song_id}/audio/cover_video", "filename": "cover.mp4"}


@app.delete("/api/songs/{song_id}")
async def delete_song(song_id: str) -> dict[str, bool]:
    song_dir, _ = _song_meta(song_id)
    await asyncio.to_thread(shutil.rmtree, song_dir)
    return {"ok": True}


if STATIC_DIR.is_dir() and (STATIC_DIR / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="frontend-assets")


@app.get("/{frontend_path:path}", include_in_schema=False)
async def frontend_fallback(frontend_path: str) -> FileResponse:
    """正式模式讓 React Router 的深層連結回到 index.html。"""

    if frontend_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="找不到 API 路徑")
    index_file = STATIC_DIR / "index.html"
    if not index_file.is_file():
        raise HTTPException(status_code=404, detail="前端尚未建置，請先執行 npm run build")

    requested = (STATIC_DIR / frontend_path).resolve()
    static_root = STATIC_DIR.resolve()
    if requested.is_file() and requested.is_relative_to(static_root):
        return FileResponse(requested)
    return FileResponse(index_file)
