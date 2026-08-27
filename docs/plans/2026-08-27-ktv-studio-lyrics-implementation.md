# KTV Studio 歌詞庫與貼上歌詞重新辨識實作計畫

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 讓 KTV Studio 在 YouTube 字幕不足時優先取得 LRCLIB 的正確歌詞與時間軸，並讓使用者貼上歌詞後重用既有音軌重新辨識。

**Architecture:** 新增無副作用、可獨立測試的 LRCLIB 服務，將它插入一般管線的 YouTube 與 Whisper 之間。重新辨識會建立一個 `retranscribe` job，但僅讀取既有歌曲 metadata、人聲音軌與使用者文字，覆寫 `subtitles.json` 而不重新下載、分離或改寫 metadata。前端以現有 job API 輪詢並刷新字幕。

**Tech Stack:** Python 3.12、urllib、FastAPI/Pydantic、faster-whisper、React 19、TypeScript、Vite/Tailwind。

---

### Task 1: LRCLIB 歌詞庫服務

**Files:**
- Create: `backend/app/services/lyrics.py`

**Step 1: 建立純函式並覆蓋 LRC 邊界案例**

實作 `clean_title`、`search_candidates` 與 `parse_lrc`。LRC 解析應支援 `[mm:ss.xx]` 和 `[mm:ss.xxx]`，把同一行多個時間標記展開後依時間排序，連續相同時間標記合併文字，並用下一行開始時間作為前一行結束時間；最後一行固定加 5 秒。

**Step 2: 實作容錯的 LRCLIB 查詢**

以 `urllib.request` 對每個候選組合查詢 `https://lrclib.net/api/search`，設定 `KTVStudio/0.1` User-Agent 與 10 秒 timeout。每一組選 synced lyrics 行數最多的結果，解析後少於 3 行就繼續；任何 HTTP、JSON、編碼或網路錯誤都靜默降級成下一組或 `None`。

**Step 3: 驗證**

Run: `cd backend && .venv/bin/python -c "from app.services.lyrics import parse_lrc; print(parse_lrc('[00:00.94] A\\n[00:05.50] B'))"`

Expected: 第一行的 `end` 為 `5.5`，且結果共有兩行。

### Task 2: 一般管線的三層字幕來源

**Files:**
- Modify: `backend/app/pipeline.py`
- Modify: `frontend/src/api.ts`

**Step 1: 插入 LRCLIB fallback**

保留可用 YouTube 字幕的快速路徑。否則更新 transcribe step 為「正在搜尋歌詞庫」，在 thread 中呼叫 `fetch_lrclib_lines(title, artist)`；有結果時以 `source="lrclib"` 組裝字幕並顯示「已取得歌詞庫字幕（正確歌詞 + 時間軸）」，沒有時顯示「歌詞庫找不到，改用語音辨識」後執行既有 Whisper 路徑。

**Step 2: 擴充前端合約**

將 `Subtitles.source` 擴充為 `'whisper' | 'youtube' | 'lrclib'`，避免 API 與 UI 對新來源產生 TypeScript 錯誤。

### Task 3: 貼上歌詞的重新辨識後端

**Files:**
- Modify: `backend/app/services/transcriber.py`
- Modify: `backend/app/pipeline.py`
- Modify: `backend/app/main.py`

**Step 1: 接受 Whisper prompt**

為 `transcribe_vocals` 加入 keyword-only `initial_prompt: str | None = None`，原樣傳給 `model.transcribe`。

**Step 2: 建立 lyrics endpoint**

新增驗證模型，確保 strip 後的 `text` 長度為 1..5000。`POST /api/songs/{song_id}/lyrics` 驗證歌曲與 metadata，寫入 `lyrics_user.txt`，建立 `source_type="retranscribe"`、title 為原歌曲名稱的 job，回傳其 id。

**Step 3: 專用 retranscribe 分支**

在 `Pipeline.run` 取得 job 後先處理 `retranscribe`：讀 `meta.json`、`lyrics_user.txt` 及 files.vocals；依序將 fetch、separate 標示為沿用既有音軌，將貼上內容前 1500 字元作為 prompt 進行辨識。之後以 metadata 語言組裝、寫回 `subtitles.json`，以人聲/伴奏的 duration 完成 job；不下載、不分離、不改寫 `meta.json`。缺任一必要檔案時拋出指定 `PipelineError`。

### Task 4: Studio 控制介面與輪詢

**Files:**
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/pages/StudioPage.tsx`

**Step 1: 加入 submitLyrics API**

使用 JSON POST `/api/songs/{id}/lyrics`，回傳 `{ job_id }`。

**Step 2: 顯示來源徽章與編輯面板**

在歌曲標題下顯示「YouTube 字幕」、「歌詞庫」、「語音辨識」或「無字幕」。提供「字幕不準？貼上正確歌詞重新辨識」切換按鈕；textarea 預填現有字幕的每行文字，並提供繁中 placeholder、錯誤與進行中提示。

**Step 3: 處理 job 完成狀態**

送出後每秒呼叫 `getJob`，最多 60 秒。成功時重新取得 subtitles 並更新父頁 state；失敗、逾時與 API 錯誤均顯示繁中訊息。清除 interval/timer，避免組件卸載後更新 state。

### Task 5: 驗證、前端產物與提交

**Files:**
- Modify: `backend/app/static/`（由前端建置產生）

**Step 1: 純函式與真實查詢驗證**

執行 `parse_lrc` 兩行樣本、`clean_title` 樣本及 `fetch_lrclib_lines("紅蓮華", "LiSA")`，確認查詢有至少三行結果。

**Step 2: 後端匯入驗證**

Run: `cd backend && .venv/bin/python -c "from app.main import app"`

Expected: exit code 0，且不啟動 uvicorn。

**Step 3: 前端建置驗證**

Run: `cd frontend && npm run build`

Expected: TypeScript 和 Vite 均成功，並更新 `backend/app/static/` 產物。

**Step 4: 提交**

在 `git diff --check` 通過後，只加入本功能相關來源、計畫與建置產物，以繁體中文 commit message 提交。
