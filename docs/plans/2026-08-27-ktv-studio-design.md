# KTV Studio（卡拉錄唱室）— 設計文件

- 日期：2026-08-27
- 狀態：已與使用者確認，進入實作
- 部署模式：**全本地**（macOS Apple Silicon），不上雲端

## 1. 產品目標

使用者貼上 YouTube 連結或上傳音訊檔案，系統自動：

1. 取得音軌並**去人聲**，產生「純伴奏 + 純人聲」兩軌
2. 自動產生 **KTV 風字幕**（逐字/逐句高亮、可跟唱）
3. 提供**簡易 EQ 調音台**（即時調整，讓音樂不刺耳）
4. 讓使用者**看字幕邊唱邊錄**，輸出**混好的 MP3 成品**

### 語言支援（依使用者需求排序）

- **日文**：字幕顯示日文 + **羅馬拼音**（使用者不會五十音，羅馬拼音是必要功能）
- **中文**：Whisper 輸出簡體，自動轉**繁體**顯示
- **英文**：原樣顯示

### 字幕來源策略

1. **YouTube 字幕優先**（yt-dlp 抓取，含自動產生的字幕）→ 準確度高，但只有逐句時間軸
2. **無字幕** → faster-whisper 語音辨識（對「純人聲軌」辨識）→ 有逐字時間軸，可做逐字卡拉 OK 高亮

### 非目標（YAGNI）

- 不做人聲升降 key（pitch shift）、不做影像錄製、不做帳號系統、不上雲、不做多人協作
- 不做複雜混音器；EQ 只需「最基礎款 + 幾個預設」

## 2. 架構

```
┌─────────────────────────────────────────────┐
│ 瀏覽器（前端）                               │
│ React + Vite + Tailwind（繁體中文、深色主題） │
│  Import 頁 → JobProgress 進度 → Studio 頁    │
│  Studio: 播放器 + KTVLyrics + Equalizer +     │
│          RecorderPanel（Web Audio 即時混音）  │
└────────────────────┬────────────────────────┘
                     │ HTTP (localhost:8000)
┌────────────────────▼────────────────────────┐
│ 後端 FastAPI（Python 3.12, uv 管理）          │
│  jobs.py      — job 佇列（單一執行）+ 進度狀態 │
│  pipeline.py  — 步驟編排                      │
│  services/                                   │
│   downloader.py — yt-dlp 下載/抓字幕          │
│   separator.py  — demucs 去人聲               │
│   transcriber.py— faster-whisper 辨識         │
│   subtitles.py  — 羅馬拼音/繁中轉換/字幕組裝   │
│   audio.py      — ffmpeg/ffprobe 輔助         │
└─────────────────────────────────────────────┘
```

- 前端 dev 模式：Vite `:5173`，proxy `/api` → `:8000`
- 正式使用：`npm run build` 輸出到 `backend/app/static/`，FastAPI 直接掛載（單一 port 8000）

## 3. 目錄與資料模型

```
saas/
  backend/
    pyproject.toml        # uv 專案（Python 3.12）
    app/
      main.py             # FastAPI + 靜態掛載 + CORS(dev)
      config.py           # 路徑與常數
      jobs.py             # JobManager：單一執行佇列、進度、持久化 jobs.json
      pipeline.py         # 五步驟編排
      services/…
      static/             # 前端 build 產物（gitignore）
    data/
      songs/{song_id}/    # 每首歌一個資料夾
        meta.json         # 中繼資料
        source.ext        # 原始音訊（mp3/m4a/…）
        vocals.wav        # 去人聲後的人聲軌（44.1k stereo）
        instrumental.wav  # 純伴奏軌（44.1k stereo）
        cover.mp3         # 錄音成品（混音後輸出）
        subtitles.json    # KTV 字幕資料
      jobs.json           # job 狀態持久化
  frontend/
    src/
      api.ts
      pages/ImportPage.tsx, LibraryPage.tsx, StudioPage.tsx
      components/KTVLyrics.tsx, Equalizer.tsx, RecorderPanel.tsx,
                 JobProgress.tsx, SongCard.tsx, AudioEngine.ts(x)
      main.tsx, App.tsx, index.css (Tailwind)
  scripts/start.sh        # 一鍵啟動
  README.md               # 繁體中文使用說明
```

`song_id` 用 uuid4 hex（短）。`meta.json` 格式：

```json
{
  "id": "…",
  "title": "歌曲標題（影片標題或檔名）",
  "artist": "歌手（uploader 或空字串）",
  "source_type": "youtube | upload",
  "source_url": "… | null",
  "language": "ja | zh | en | …",
  "duration": 213.5,
  "created_at": "ISO8601",
  "files": {"original": "source.mp3", "vocals": "vocals.wav",
            "instrumental": "instrumental.wav", "cover": "cover.mp3"}
}
```

## 4. API 合約

| Method | Path | 說明 |
|---|---|---|
| GET | `/api/health` | 健康檢查 |
| POST | `/api/jobs` | 建立 job。body: `{source_type:"youtube"\|"upload", url?:str, upload_id?:str, title?:str}` → `{job_id}` |
| POST | `/api/upload` | multipart 上傳音訊 → `{upload_id, filename}`（暫存檔） |
| GET | `/api/jobs/{job_id}` | `{job_id, status, step, step_index, total_steps, progress(0~1), message, error, song_id, title}` |
| GET | `/api/jobs` | 最近 jobs 列表（供前端恢復狀態） |
| GET | `/api/songs` | 歌曲庫列表（含封面資訊、狀態欄位） |
| GET | `/api/songs/{id}` | 單曲詳細 |
| GET | `/api/songs/{id}/audio/{kind}` | 音訊串流，kind ∈ `original\|vocals\|instrumental\|cover`（FileResponse，支援 Range） |
| GET | `/api/songs/{id}/subtitles` | subtitles.json |
| POST | `/api/songs/{id}/export` | 上傳錄音 blob（webm/mp4）→ ffmpeg 轉 `cover.mp3` → `{url, filename}` |
| DELETE | `/api/songs/{id}` | 刪除歌曲 |

### Job 狀態與步驟

`status`: `queued → running → done | failed`
`step`: `fetch`（取得音訊）→ `separate`（去人聲）→ `transcribe`（字幕辨識）→ `subtitles`（字幕後製）→ `finalize`（完成）

- **單一執行**：同時只跑一個 job（8GB RAM），其餘排隊
- 進度：`progress = (step_index + 步驟內進度) / total_steps`，步驟內進度以 message 描述（如「分離音軌 40%」可由 demucs stdout 粗估）

### 字幕格式 subtitles.json

```json
{
  "language": "ja",
  "source": "whisper | youtube",
  "title": "…",
  "lines": [
    {
      "start": 12.34, "end": 16.02,
      "text": "きらきら星",
      "romaji": "kirakira boshi",
      "words": [
        {"text": "きらきら", "romaji": "kirakira", "start": 12.34, "end": 14.10},
        {"text": "星", "romaji": "hoshi", "start": 14.10, "end": 16.02}
      ]
    }
  ]
}
```

- `words` 可為 null（YouTube 字幕來源時只有逐句）
- `romaji` 僅日文有；`text` 為顯示用文字（中文已是繁體）
- 前端依 `language` 決定是否顯示 romaji

## 5. 管線實作細節

### 步驟 1 — fetch（downloader.py）

- YouTube：`yt_dlp.YoutubeDL`，格式 `bestaudio/best`，`outtmpl` 指向暫存；下載後用 ffmpeg 轉 44.1k stereo wav 供後續步驟（原始檔另存）
- 上傳：暫存檔直接使用
- **字幕抓取**：yt-dlp 嘗試 `write_auto_subs`/`write_subs`（sub-langs 依偵測語言：`ja|zh|en`，`sub_format vtt`，`skip_download` 模式只抓字幕）。抓到則解析 VTT → lines（合併連續、清理 tag）；若產生的行數合理（≥3 行）且內容非空 → `source:"youtube"`
- 語音辨識仍照跑以取得逐字時間軸？**不**——為省時間，YouTube 字幕成功即跳過 whisper（v1 決策：YouTube 字幕只有逐句高亮；使用者可之後重新處理）
- 抓不到字幕 → `source: null`，步驟 3 用 whisper

### 步驟 2 — separate（separator.py）

```bash
python -m demucs --two-stems=vocals -o <outdir> [-d mps] input.wav
```

- 先試 `-d mps`（Apple Silicon 加速），失敗自動以 `-d cpu` 重試（8GB RAM 需保守；可加 `--segment 12` 控制記憶體）
- 輸出 `outdir/htdemucs/<name>/vocals.wav` 與 `no_vocals.wav` → 改名為 `vocals.wav` / `instrumental.wav` 存入歌曲資料夾
- 以 subprocess 執行並即時讀 stdout 更新進度 message

### 步驟 3 — transcribe（transcriber.py）

- 對 **vocals.wav** 做 `faster_whisper.WhisperModel("medium", device="cpu", compute_type="int8")`
- `word_timestamps=True, vad_filter=True`；語言自動偵測（`language=None`），偵測後寫入 meta.language
- 產出 words：`{text, start, end}`（segments 展開成 words）

### 步驟 4 — subtitles（subtitles.py）

- **日文**：pykakasi `kakasi.convert(word)` → romaji 串接（不含空格）；行 romaji = 各字 romaji 以空格連接。注意先去除標點再轉換，保留原文顯示
- **中文**：`OpenCC("s2tw")` 逐字/逐行轉繁體（s2tw 而非 s2t，含台灣慣用詞）
- **英文**：原樣
- 組裝 lines：以 whisper segments 為行單位（words 掛在行下）；YouTube 字幕來源則直接使用 VTT 行（無 words）
- 字幕清洗：移除多餘空白、無意義字元、whisper 常見重複

### 步驟 5 — finalize（audio.py）

- ffprobe 取 duration 寫入 meta.json
- 產生縮圖？**不做**（YAGNI），歌曲卡片用漸層 + 首字母

## 6. 前端規格

### 頁面（react-router）

1. **匯入頁 `/`**：YouTube 網址輸入框 + 檔案拖放上傳；送出後顯示 JobProgress（五步驟時間軸，進行中 spinner、完成勾、失敗紅叉+重試）；完成後跳轉 Studio
2. **歌曲庫 `/library`**：卡片列表（標題/歌手/語言/時長/來源），點擊進 Studio；可刪除
3. **錄唱室 `/studio/:id`**：主畫面（見下）

### 錄唱室布局（深色、音樂工作室風、繁體中文）

```
┌──────────────────────────────────────────┐
│ 播放控制（播放/暫停、時間軸、音量）         │
│ ┌────────────────────────────────────┐   │
│ │        KTV 字幕（大字當前行）        │   │
│ │   きらきら星  ← 逐字高亮、日文附     │   │
│ │   kirakira boshi     羅馬拼音       │   │
│ │   （前後句暗色小字預覽）             │   │
│ └────────────────────────────────────┘   │
│ [調音台]  7 段 EQ 滑桿 + 預設按鈕 + 總音量 │
│ [錄音]    麥克風權限/音量表/錄製/停止/成品 │
└──────────────────────────────────────────┘
```

### KTVLyrics 元件

- 播放中以 `requestAnimationFrame` 讀 `audio.currentTime`（單一時間來源）
- 當前句：大字置中；`words` 存在時**逐字高亮**（每個 word 依 start/end 變色），無 words 時整句高亮
- 日文：字下顯示羅馬拼音（較小字）
- 上/下一句：暗色小字顯示在當前句上下
- 點擊某句可跳轉播放位置

### AudioEngine / Equalizer（Web Audio）

- `HTMLAudioElement`（src=`/api/songs/{id}/audio/instrumental`）→ `createMediaElementSource` → EQ 鏈 → destination
- EQ：7 段 peaking `BiquadFilterNode`，頻率 `[60, 150, 400, 1000, 2500, 6000, 12000]` Hz，Q≈1.1，增益 ±12dB
- 預設（7 段 dB 值，可微調）：
  - 平坦 `[0,0,0,0,0,0,0]`
  - 柔和 `[0,1,2,2,0,-2,-4]`
  - 去刺耳 `[0,0,0,0,-2,-4,-3]`
  - 明亮 `[0,0,0,0,1,3,4]`
  - 低音加強 `[4,2,0,0,0,0,0]`
- master `GainNode`（伴奏音量）

### RecorderPanel（錄音）

1. `getUserMedia({audio:true})` → mic source → 音量表（AnalyserNode）
2. mic → `GainNode`（麥克風音量）→ `MediaStreamDestination`
3. EQ 後伴奏 → 同一個 `MediaStreamDestination`（監聽：同時接 destination 讓使用者聽到自己）
4. `MediaRecorder(streamDest.stream)` → 錄製/停止
5. 停止 → blob → `POST /api/songs/{id}/export` → 顯示成品連結（`/api/songs/{id}/audio/cover`），可下載
6. 處理錯誤：麥克風權限拒絕 → 繁體中文提示

### 其他前端細節

- `api.ts`：fetch 封裝 + `JobProgress` 每 1 秒輪詢 `/api/jobs/{id}`
- JobProgress 完成後自動 `navigate('/studio/:songId')`
- 全部 UI 文案繁體中文；深色主題（如 slate-950 底 + 靛紫 accent）

## 7. 錯誤處理

- demucs MPS 失敗 → CPU 重試；仍失敗 → job failed 附錯誤訊息
- yt-dlp 失敗（影片不存在/地區限制）→ failed，訊息繁體中文
- whisper 失敗 → failed，可重試（前端重試按鈕 = 重新 POST job）
- 8GB RAM：單一 job 佇列；whisper 與 demucs 不並行
- 伺服器重啟：`jobs.json` 中 running 的 job 標記 failed（訊息「中斷」）；歌曲資料保留
- 字幕空（whisper 也失敗/無內容）→ song 仍完成，Studio 顯示「無字幕」

## 8. 測試計畫

1. 單元：subtitles.py 的日文羅馬拼音/繁中轉換（用小樣本字串）
2. 端到端：真實 YouTube 短片（30~60 秒）完整管線
3. 上傳檔管線：ffmpeg 產生測試音檔
4. 前端：`npm run build` 通過；手動測 Studio（播放/EQ/錄音）
5. 錄音：真麥克風錄製 → export → 檢查 cover.mp3 可播放且含人聲+伴奏

## 9. 未來增強（本版不做）

- YouTube 字幕 + 強制對齊（forced alignment）取得逐字時間軸
- 升降 key（pitch shift）、人聲效果（reverb/compressor）
- 匯出 LRC 檔、多格式匯出（WAV/FLAC）
- 桌面 App 包裝（Tauri）

## 10. 追加：人聲/伴奏音質優化（2026-08-27 確認）

### 問題

demucs 分離後，人聲軌在 segment 接縫處會有音量抖動（忽大忽小）；兩軌整體也偏小聲。

### 對策（實測參數）

1. **demucs 分離參數**：`--shifts 1 --overlap 0.5`（htdemucs 論文建議；減少接縫 artifacts，代價約 2 倍運算時間，M1 MPS 約 1~2 分鐘/首歌）
2. **人聲軌後處理**（`stabilize_vocals`）：`ffmpeg -af dynaudnorm=f=100:g=20:p=0.7:m=15`
   - 實測：逐秒 RMS 起伏 span 56dB → 39dB（std 11.2 → 6.9dB），保留歌聲動態
3. **伴奏軌後處理**（`normalize_instrumental`）：`ffmpeg -af loudnorm=I=-16:TP=-1.5:LRA=11`（整體響度正規化，保留音樂起伏）

處理順序：separate → 後處理兩軌 → whisper 對穩定化後的人聲軌辨識（音量一致對 VAD 也有幫助）。

## 11. 追加：Cover 錄影功能（2026-08-27 確認）

### 需求

版面切兩塊：**右半邊 = 原有大字歌詞**；**左半邊 = 錄影畫面（webcam）+ 已上字幕**。字幕一句一句換（非跑馬燈），字型可選、位置可拖曳。產出 Cover 影片檔（含麥克風 + EQ 後伴奏的混音音訊）。

### 技術方案（開源專案標準做法：canvas.captureStream + MediaRecorder，如 RecordRTC/Remotion）

1. webcam（`getUserMedia`，1280x720）畫面逐幀畫到 `<canvas>`（cover-fit）
2. 依 `audio.currentTime` 找當前字幕句（與 KTVLyrics 相同邏輯），畫在 canvas 上：
   - 整句文字（白字 + 黑邊/陰影），日文句下方附小字羅馬拼音
   - 字型：系統字型下拉（PingFang TC / Hiragino / Noto Sans CJK TC / Microsoft JhengHei / Arial / Georgia / Courier New…）+ 大小滑桿
   - 位置：pointer 拖曳調整（正規化 0~1 座標），`localStorage` 依 songId 持久化
3. 錄製：`canvas.captureStream(30)` video track + `engine.recordDestination.stream` audio track（= 麥克風 + EQ 後伴奏的混音）→ MediaRecorder（Safari 用 video/mp4，Chrome 用 webm）→ blob
4. `POST /api/songs/{id}/export-video` → ffmpeg 轉 `cover.mp4`（H.264 + AAC 192k + faststart + yuv420p）→ 下載連結
5. 音訊/錄影互斥：影片錄製中停用純音訊錄音按鈕，反之亦然

### 版面（StudioPage）

```
播放控制列（原樣）
┌─────────────┬──────────────┐
│ VideoPanel  │  KTVLyrics   │ ← 左右兩欄
│（鏡頭+字幕） │（原大字歌詞） │
├─────────────┴──────────────┤
│ EQ 調音台 │ RecorderPanel  │ ← 原樣
└────────────────────────────┘
```

### API

- `POST /api/songs/{id}/export-video`：multipart `recording`（webm/mp4）→ `cover.mp4`，更新 meta.files.cover_video → `{url, filename}`
- `GET /api/songs/{id}/audio/{kind}`：kind 增加 `cover_video`
- Song 回應增加 `has_cover_video`
