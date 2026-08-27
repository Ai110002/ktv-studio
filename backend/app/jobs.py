"""單一執行工作佇列與 jobs.json 持久化。"""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.config import JOBS_FILE, JOB_STEPS, TOTAL_JOB_STEPS, ensure_data_directories


JobProcessor = Callable[[str], Awaitable[None]]


def _now() -> str:
    return datetime.now(UTC).isoformat()


class JobManager:
    """8GB 記憶體環境專用：同一時間只取出一個工作執行。"""

    def __init__(self, jobs_file: Path = JOBS_FILE) -> None:
        self.jobs_file = jobs_file
        self._jobs: dict[str, dict[str, Any]] = {}
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._lock = asyncio.Lock()
        self._processor: JobProcessor | None = None
        self._worker_task: asyncio.Task[None] | None = None
        self._loaded = False

    def set_processor(self, processor: JobProcessor) -> None:
        self._processor = processor

    async def load(self) -> None:
        """讀取持久化資料，並將伺服器中斷時的 running 工作標記為失敗。"""

        if self._loaded:
            return
        ensure_data_directories()
        raw_jobs: list[dict[str, Any]] = []
        if self.jobs_file.exists():
            try:
                value = json.loads(self.jobs_file.read_text(encoding="utf-8"))
                raw_jobs = value.get("jobs", []) if isinstance(value, dict) else value
            except (OSError, json.JSONDecodeError):
                raw_jobs = []

        changed = False
        for raw_job in raw_jobs:
            if not isinstance(raw_job, dict) or not raw_job.get("job_id"):
                continue
            job = dict(raw_job)
            if job.get("status") == "running":
                job.update(
                    {
                        "status": "failed",
                        "message": "伺服器重新啟動，工作已中斷",
                        "error": "中斷",
                        "updated_at": _now(),
                    }
                )
                changed = True
            self._jobs[str(job["job_id"])] = job

        self._loaded = True
        if changed:
            async with self._lock:
                self._write_locked()

    async def start(self) -> None:
        await self.load()
        if self._processor is None:
            raise RuntimeError("JobManager 尚未設定工作處理器")
        if self._worker_task and not self._worker_task.done():
            return
        for job in self._jobs.values():
            if job.get("status") == "queued":
                self._queue.put_nowait(str(job["job_id"]))
        self._worker_task = asyncio.create_task(self._worker(), name="ktv-single-job-worker")

    async def stop(self) -> None:
        if self._worker_task is None:
            return
        self._worker_task.cancel()
        try:
            await self._worker_task
        except asyncio.CancelledError:
            pass
        self._worker_task = None

    async def create(
        self,
        *,
        source_type: str,
        url: str | None = None,
        upload_id: str | None = None,
        title: str | None = None,
        song_id: str | None = None,
    ) -> dict[str, Any]:
        await self.load()
        job_id = uuid.uuid4().hex
        job = {
            "job_id": job_id,
            "status": "queued",
            "step": JOB_STEPS[0],
            "step_index": 0,
            "total_steps": TOTAL_JOB_STEPS,
            "progress": 0.0,
            "message": "等待處理",
            "error": None,
            "song_id": song_id or uuid.uuid4().hex[:12],
            "title": title or "",
            "source_type": source_type,
            "url": url,
            "upload_id": upload_id,
            "created_at": _now(),
            "updated_at": _now(),
        }
        async with self._lock:
            self._jobs[job_id] = job
            self._write_locked()
        self._queue.put_nowait(job_id)
        return dict(job)

    async def get(self, job_id: str) -> dict[str, Any] | None:
        await self.load()
        async with self._lock:
            job = self._jobs.get(job_id)
            return dict(job) if job else None

    async def list(self) -> list[dict[str, Any]]:
        await self.load()
        async with self._lock:
            jobs = [dict(job) for job in self._jobs.values()]
        return sorted(jobs, key=lambda job: str(job.get("created_at", "")), reverse=True)

    async def update(self, job_id: str, **changes: Any) -> dict[str, Any] | None:
        async with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return None
            job.update(changes)
            job["updated_at"] = _now()
            self._write_locked()
            return dict(job)

    async def set_step(self, job_id: str, step: str, message: str) -> None:
        try:
            step_index = JOB_STEPS.index(step)
        except ValueError as exc:
            raise ValueError(f"未知的工作步驟：{step}") from exc
        await self.update(
            job_id,
            step=step,
            step_index=step_index,
            progress=round(step_index / TOTAL_JOB_STEPS, 4),
            message=message,
            error=None,
        )

    async def set_step_progress(self, job_id: str, fraction: float, message: str | None = None) -> None:
        job = await self.get(job_id)
        if job is None or job.get("status") in {"done", "failed"}:
            return
        fraction = min(1.0, max(0.0, float(fraction)))
        changes: dict[str, Any] = {
            "progress": round((int(job.get("step_index", 0)) + fraction) / TOTAL_JOB_STEPS, 4)
        }
        if message:
            changes["message"] = message
        await self.update(job_id, **changes)

    async def complete(self, job_id: str, message: str = "處理完成") -> None:
        await self.update(
            job_id,
            status="done",
            step="finalize",
            step_index=TOTAL_JOB_STEPS - 1,
            progress=1.0,
            message=message,
            error=None,
        )

    async def fail(self, job_id: str, error: str) -> None:
        await self.update(job_id, status="failed", message="處理失敗", error=error, progress=self._safe_progress(job_id))

    def _safe_progress(self, job_id: str) -> float:
        job = self._jobs.get(job_id, {})
        return float(job.get("progress", 0.0))

    def _write_locked(self) -> None:
        self.jobs_file.parent.mkdir(parents=True, exist_ok=True)
        temp_file = self.jobs_file.with_suffix(".tmp")
        content = json.dumps({"jobs": list(self._jobs.values())}, ensure_ascii=False, indent=2)
        temp_file.write_text(content, encoding="utf-8")
        temp_file.replace(self.jobs_file)

    async def _worker(self) -> None:
        while True:
            job_id = await self._queue.get()
            try:
                job = await self.get(job_id)
                if job is None or job.get("status") != "queued":
                    continue
                await self.update(job_id, status="running", message="開始處理")
                assert self._processor is not None
                await self._processor(job_id)
                final_job = await self.get(job_id)
                if final_job and final_job.get("status") == "running":
                    await self.complete(job_id)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                await self.fail(job_id, str(exc) or "處理時發生未知錯誤")
            finally:
                self._queue.task_done()
