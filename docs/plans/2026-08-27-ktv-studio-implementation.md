# KTV Studio（卡拉錄唱室）Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 建立可在 Apple Silicon 本機執行的 KTV Studio：匯入 YouTube／音訊、去人聲、產生字幕、EQ 錄唱並輸出 MP3。

**Architecture:** FastAPI 維護可持久化的單一工作佇列，依序執行下載、Demucs、Whisper、字幕後製與收尾。React 前端以 Web Audio API 將伴奏經 EQ 接入錄音目的地，並使用單一 audio 元素作為字幕時間來源。

**Tech Stack:** Python 3.12、FastAPI、yt-dlp、Demucs、faster-whisper、pykakasi、OpenCC、ffmpeg；React、TypeScript、Vite、Tailwind CSS v4。

---

### Task 1: 後端基礎與音訊服務

**Files:**
- Create: `backend/app/config.py`
- Create: `backend/app/services/audio.py`
- Create: `backend/app/services/downloader.py`
- Create: `backend/app/services/separator.py`
- Create: `backend/app/services/transcriber.py`
- Create: `backend/app/services/subtitles.py`

**Output:** 路徑常數、ffmpeg 輔助函式、YouTube／VTT 處理、Demucs MPS→CPU 回退、Whisper 與可測試字幕純函式。

**Test:** 直接以既有 venv 匯入服務；執行日文羅馬拼音與簡繁轉換小樣本。不得下載任何模型。

### Task 2: 佇列、管線與 API

**Files:**
- Create: `backend/app/jobs.py`
- Create: `backend/app/pipeline.py`
- Create: `backend/app/main.py`

**Output:** 單一 asyncio 佇列、jobs.json 持久化與中斷標記、五步驟管線、歌曲／上傳／匯出 REST API、SPA fallback。

**Test:** `cd backend && .venv/bin/python -c "from app.main import app"` 成功；確認不會在匯入時載入 Whisper 模型。

### Task 3: 前端專案與 API 層

**Files:**
- Create: `frontend/package.json`, `frontend/vite.config.ts`, `frontend/tsconfig*.json`, `frontend/index.html`
- Create: `frontend/src/api.ts`, `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/index.css`

**Output:** Vite 開發 proxy、產物輸出至 FastAPI 靜態目錄、型別化 API 封裝及深色繁體中文應用骨架。

**Test:** `cd frontend && npm install && npm run build`。

### Task 4: 匯入、歌曲庫與錄唱室元件

**Files:**
- Create: `frontend/src/pages/ImportPage.tsx`, `LibraryPage.tsx`, `StudioPage.tsx`
- Create: `frontend/src/components/JobProgress.tsx`, `SongCard.tsx`, `KTVLyrics.tsx`, `AudioEngine.ts`, `Equalizer.tsx`, `RecorderPanel.tsx`

**Output:** 匯入和五步進度輪詢、歌曲庫刪除、逐字字幕、七段 EQ、麥克風混音錄音與 MP3 成品下載。

**Test:** TypeScript/Vite production build；人工檢視產物可由 FastAPI 掛載。

### Task 5: 本機啟動、文件、驗證與提交

**Files:**
- Create: `scripts/start.sh`, `README.md`
- Modify: `.gitignore`（僅於需要時）

**Output:** 一鍵啟動腳本、繁體中文操作說明、乾淨提交。

**Test:** 前端 build、後端匯入、字幕純函式三項驗證；不執行需下載模型的完整管線。
