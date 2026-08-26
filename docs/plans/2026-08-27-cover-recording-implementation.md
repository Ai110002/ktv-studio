# Cover 錄影功能實作計畫

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 讓 KTV Studio 可將鏡頭、逐句字幕與麥克風／EQ 後伴奏混音匯出為可下載的 MP4 Cover 影片。

**Architecture:** 瀏覽器以 canvas 組合 webcam 與字幕，將 `canvas.captureStream(30)` 視訊軌和 AudioEngine 的混音軌交給 MediaRecorder。後端接收 blob，透過 ffmpeg 正規化為 H.264/AAC MP4，並將檔名寫回歌曲 metadata。麥克風鏈抽成共用 hook，讓純音訊與錄影皆使用同一混音 destination。

**Tech Stack:** FastAPI、ffmpeg、React 19、TypeScript、Web Audio API、MediaRecorder、Canvas 2D。

---

### Task 1: 後端影片匯出契約

**Files:**
- Modify: `backend/app/services/audio.py`
- Modify: `backend/app/main.py`

**Step 1: 補上 MP4 轉檔 helper**

在 `convert_to_mp4(input_path, output_path)` 中以 `_run` 執行下列確切參數，並將 ffmpeg 失敗轉為 `AudioError`：

```python
["ffmpeg", "-y", "-i", str(input_path), "-c:v", "libx264",
 "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
 "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(output_path)]
```

**Step 2: 新增 multipart 端點**

`POST /api/songs/{song_id}/export-video` 應將 `recording` 寫入歌曲目錄的隨機暫存檔、在 thread 中呼叫 helper、刪除暫存檔與關閉 upload；成功時更新 `meta.json`：

```python
files = dict(meta.get("files") or {})
files["cover_video"] = "cover.mp4"
meta["files"] = files
(song_dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
```

回應 `{ "url": "/api/songs/{id}/audio/cover_video", "filename": "cover.mp4" }`；轉檔／儲存錯誤應保留既有中文 HTTP 錯誤模式。

**Step 3: 擴展讀取回應**

將 `cover_video` 加入 `stream_audio` 的 `Literal`，並在 `_song_response` 以 `files.cover_video` 實際存在與否計算 `has_cover_video`。

**Step 4: 驗證**

Run: `cd backend && .venv/bin/python -c "from app.main import app"`

Expected: exit code 0；不啟動 uvicorn。

### Task 2: 共用麥克風與 API 型別

**Files:**
- Modify: `frontend/src/components/AudioEngine.ts`
- Modify: `frontend/src/components/RecorderPanel.tsx`
- Modify: `frontend/src/api.ts`

**Step 1: 抽取 `useMicrophone(engine)`**

把既有 getUserMedia、analyser 音量 frame、gain 音量調整與 release 邏輯移到 AudioEngine。hook 必須回傳：

```ts
{ micReady, micLevel, micVolume, setMicVolume, enable, release, error }
```

`AudioEngine` 再提供 `getRecordStream(): MediaStream`，其值為 `recordDestination.stream`。

**Step 2: 保持 RecorderPanel 行為**

將其改用 hook 並加入 `recordingLocked`。鎖定時「開始錄音」disabled 且顯示「錄影進行中，無法同時錄音」；錄音進行時仍不可關麥克風。

**Step 3: 新增影片 API 型別與請求**

`SongFiles` 加上 `cover_video?: string`，`Song` 加上 `has_cover_video: boolean`，並以 FormData 實作：

```ts
body.append('recording', blob, 'cover錄影.webm')
return request<{ url: string; filename: string }>(
  `/api/songs/${encodeURIComponent(songId)}/export-video`, { method: 'POST', body },
)
```

### Task 3: Canvas 錄影面板

**Files:**
- Create: `frontend/src/components/VideoPanel.tsx`

**Step 1: 建立鏡頭生命週期**

按「開啟鏡頭」請求 `getUserMedia({ video: { width: 1280, height: 720 }, audio: false })`。以隱藏 video 作輸入，canvas 固定 `1280 × 720`，rAF 每幀 cover-fit 畫入畫面；對 `NotAllowedError`、`NotFoundError` 顯示明確繁中錯誤。unmount 時取消 rAF、停止 tracks。

**Step 2: 畫出逐句字幕與可持久化樣式**

依 `audioRef.current.currentTime` 使用 KTVLyrics 相同規則找目前行。文字以中心對齊的 `strokeText` 加 `fillText` 繪製，日文行在主文下畫 `line.romaji`。設定 `{ fontFamily, fontSize, x, y }` 從／寫入 `ktv-video-settings-${songId}`；pointer drag 以 canvas rect 轉為 0–1 的座標。無字幕時只畫鏡頭並呈現「此歌無字幕」。

**Step 3: 實作錄影狀態機**

開始時確保 `useMicrophone(engine).enable()` 成功並 `await engine.resume()`；建立 stream：

```ts
new MediaStream([
  ...canvas.captureStream(30).getVideoTracks(),
  ...engine.getRecordStream().getAudioTracks(),
])
```

優先 `video/mp4`，再 `video/webm;codecs=vp8,opus`，最後不指定 mimeType。停止時收集 blobs、呼叫 `exportVideo`，顯示「正在轉成 MP4…」和 `download="cover.mp4"` 的連結。錄影中鎖定鏡頭／字型／字幕位置控制，並以 rAF 顯示 `mm:ss` 紅點計時；每次開始／結束呼叫 `onRecordingChange`。

### Task 4: Studio 與歌曲庫整合

**Files:**
- Modify: `frontend/src/pages/StudioPage.tsx`
- Modify: `frontend/src/components/SongCard.tsx`
- Review: `frontend/src/pages/LibraryPage.tsx`

**Step 1: 更新 Studio 版面與互斥狀態**

新增 `videoRecording` state。在播放列之後放一個 `xl:grid-cols-2`：左 `VideoPanel`，右 `KTVLyrics`；接著保留一個兩欄 grid 的 EQ 與 RecorderPanel。把 `setVideoRecording` 傳給 VideoPanel，並將 state 傳成 RecorderPanel 的 `recordingLocked`。

**Step 2: 顯示影片徽章**

SongCard 以深色系小標籤呈現 `song.has_cover_video`：`🎬 有影片`，不改變 LibraryPage 的資料載入與刪除流程。

### Task 5: 建置與交付

**Files:**
- Review: 所有上述檔案

**Step 1: TypeScript／bundler 驗證**

Run: `cd frontend && npm run build`

Expected: `tsc --noEmit` 與 Vite build exit code 0。

**Step 2: 後端 import smoke test**

Run: `cd backend && .venv/bin/python -c "from app.main import app"`

Expected: exit code 0，且不自行啟動既有的 port 8000 服務。

**Step 3: 提交**

Run: `git add` 僅限 Cover 錄影相關檔案，然後以繁體中文 commit message 提交。提交前以 `git diff --check` 確認沒有空白錯誤，並保留工作區原有的無關變更。
