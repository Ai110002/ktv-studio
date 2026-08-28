# 字幕工作台 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 KTV Studio 提供可直接修正歌詞、匯入 TXT/LRC/SRT/VTT 並以播放時間逐句手動對齊的字幕工作台。

**Architecture:** 前端 `SubtitleEditor` 維護可即時預覽的 draft lines，於瀏覽器解析匯入檔案並使用共享 `HTMLAudioElement.currentTime` 打點。後端新增字幕更新 API，驗證行數、文字與時間後透過既有 `build_subtitles_json` 重新產生日文羅馬拼音/繁體中文，使用暫存檔原子替換 `subtitles.json`；手動來源的 `words` 固定清除，避免舊逐字時間軸失真。

**Tech Stack:** React 19、TypeScript、Vite、Tailwind、lucide-react、FastAPI、Pydantic、Python 3.12。

---

### Task 1: 建立後端字幕更新合約

**Files:**
- Modify: `backend/app/main.py:29-45`（新增 Pydantic request models）
- Modify: `backend/app/main.py:207-243`（新增 PUT endpoint）
- Modify: `frontend/src/api.ts:52-65,126-136`（source 型別與更新 API）
- Test: `backend/tests/test_subtitles_api.py`（建立最小純函式/API 合約測試；若環境未裝 pytest，提供可執行 Python assert 腳本）

**Step 1: 寫 request model 與驗證測試**

新增 `UpdateSubtitlesRequest` 與 `SubtitleLineRequest`：每列 `start/end` 為有限非負數、`end >= start`、文字 strip 後 1..500 字元；整體最多 2,000 列。允許空列清單代表清除字幕，但不允許空白文字列。測試合法資料、反向時間、空白文字、超長文字與超過列數。

**Step 2: 實作 PUT endpoint**

`PUT /api/songs/{song_id}/subtitles` 讀取歌曲 metadata，將 request lines 轉成 `build_subtitles_json(language=meta.language, title=meta.title, source="manual", lines=[{start,end,text,words:None}])`。使用同目錄暫存 JSON 後 `Path.replace` 原子寫入，回傳完整字幕 JSON；歌曲不存在回 404，寫入失敗回 500。不可接受 client 傳入任意 path 或覆寫 metadata。

**Step 3: 擴充前端 API 型別**

將 `Subtitles.source` 加入 `'manual'`，新增 `updateSubtitles(songId, lines)`，只傳 `start/end/text`，成功回傳 `Subtitles`。

**Step 4: 驗證**

Run: `cd backend && .venv/bin/python -c "from app.main import app; from app.main import UpdateSubtitlesRequest; print('ok')"`
Expected: `ok`。

Run: `cd backend && .venv/bin/python -m compileall app`
Expected: exit code 0。

**Step 5: Commit**

```bash
git add backend/app/main.py frontend/src/api.ts backend/tests/test_subtitles_api.py
git commit -m "feat: 新增手動字幕更新 API"
```

只加入列出的功能檔案，不使用 `git add -A`。

### Task 2: 實作瀏覽器字幕格式解析器

**Files:**
- Create: `frontend/src/lib/subtitleFormats.ts`
- Test: `frontend/src/lib/subtitleFormats.test.ts`（若不引入測試套件，改以可被 Node 執行的純函式檢查或將 cases 放入既有驗證腳本）

**Step 1: 寫解析測試案例**

覆蓋：
- 純文字：忽略空白行，輸出每列 `start:0,end:0,text` 並標記待對齊由呼叫端判斷。
- LRC：支援 `[mm:ss.xx]`、`[mm:ss.xxx]`、同一列多個 timestamp；排序、合併同時間、以下一列 start 作 end，最後一列使用歌曲 duration 或 start+5。
- SRT：支援 `00:00:01,000 --> 00:00:03,500`、序號、多行文字。
- VTT：跳過 `WEBVTT` 與 cue metadata，支援 `00:01.000 --> 00:03.500` 與三段式時間。
- 不支援格式與沒有內容時回傳明確錯誤。

**Step 2: 實作純函式**

輸出共用型別 `{ start: number; end: number; text: string; words: null }[]`。時間解析只接受有限、非負值；文字使用 trim；每種格式最多處理 2,000 列，避免大型檔案拖垮瀏覽器。提供 `parseSubtitleFile(text, extension, duration)` 與 `parsePlainLyrics(text)`。

**Step 3: 執行解析測試**

Run: `node`／專案既有 TypeScript 驗證方式執行 cases，確認每種格式與錯誤案例通過。

**Step 4: Commit**

```bash
git add frontend/src/lib/subtitleFormats.ts frontend/src/lib/subtitleFormats.test.ts
git commit -m "feat: 支援 TXT LRC SRT VTT 歌詞解析"
```

### Task 3: 建立字幕編輯器 UI 與 draft 操作

**Files:**
- Create: `frontend/src/components/SubtitleEditor.tsx`
- Modify: `frontend/src/pages/StudioPage.tsx:19-172,240-318`

**Step 1: 建立元件狀態與 props**

`SubtitleEditor` 接受 `songId`、`subtitles`、`audioRef`、`duration`、`onSubtitlesUpdated`。保存 `draftLines`、`expanded`、`selectedIndex`、`dirty`、`saving`、`importError`、`saveError`、`currentTime`。沒有字幕時預設展開；有字幕時可收合。

**Step 2: 實作文字與時間欄位**

每列顯示序號、文字 textarea、start/end 秒數、跳轉播放、標記開始、標記結束並下一句、拆分、合併、刪除。輸入欄位將數值 clamp 到 `[0,duration]`，並在儲存前再次驗證 `end >= start`。文字或時間變動時將該列 `words` 設為 null，並用 `onSubtitlesUpdated` 即時更新 KTVLyrics/VideoPanel draft。

**Step 3: 實作列操作**

- 新增：在末尾或指定列後插入空白列，時間沿用鄰近列。
- 刪除：刪除指定列，至少保留可儲存的空清單。
- 拆分：依 textarea selection；無 selection 時取文字中點；時間按比例拆成兩列。
- 合併：與前一列合併，中文/日文不加空格，英文加單一空格；start 取前列、end 取後列。
- 跳轉：把 shared audio currentTime 設成該列 start，不強制播放。

**Step 4: 加入播放打點**

以 `requestAnimationFrame` 顯示目前播放時間。`標記開始` 更新 selected row start；`標記結束並下一句` 將目前時間寫入 selected row end，若有下一列則將其 start 設為同一時間並選取下一列。播放中標示目前列與對齊列，按鈕提供 disabled 與 aria-label。

**Step 5: 串接 StudioPage**

將 editor 放在 `KTVLyrics` 下方，傳入既有 `audioRef` 與 duration；`subtitleSourceLabel` 新增 `manual -> 手動編輯`。保留既有 `LyricsRetranscriptionPanel`，讓使用者仍可選擇 AI 重新辨識。

**Step 6: Build 型別檢查**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS。

**Step 7: Commit**

```bash
git add frontend/src/components/SubtitleEditor.tsx frontend/src/pages/StudioPage.tsx
git commit -m "feat: 新增字幕逐句編輯與播放打點介面"
```

### Task 4: 加入歌詞匯入與儲存流程

**Files:**
- Modify: `frontend/src/components/SubtitleEditor.tsx`
- Modify: `frontend/src/lib/subtitleFormats.ts`
- Modify: `frontend/src/api.ts`

**Step 1: 加入檔案匯入**

使用隱藏 `<input type="file" accept=".txt,.lrc,.srt,.vtt,text/plain">` 與可聚焦按鈕；依副檔名呼叫 parser。匯入前若 dirty 使用 `window.confirm`；錯誤在元件內顯示，不影響播放器。

**Step 2: 加入貼上歌詞匯入**

提供可收合的純文字 textarea 與「載入到編輯器」按鈕。載入後清除舊 draft、建立待對齊列、選取第一句並顯示「尚未對齊」。這與既有「貼歌詞重新辨識」按鈕並列，但用途明確分開：本功能不呼叫 Whisper。

**Step 3: 加入儲存**

按「儲存字幕」呼叫 `updateSubtitles`；保存期間鎖定編輯/匯入操作並顯示 spinner。成功以 server-normalized response 更新父層、清除 dirty；失敗保留 draft 並顯示錯誤。儲存前顯示有多少列仍是 `start=end=0` 的警告，但允許使用者明確儲存。

**Step 4: 加入匯入/對齊狀態**

以 `end <= start` 或任何時間不遞增列判斷待對齊；顯示提示「請播放歌曲並逐句標記開始」。LRC/SRT/VTT 匯入後直接可播放預覽，純文字匯入後不假裝已完成。

**Step 5: Build**

Run: `cd frontend && npm run build`
Expected: TypeScript 與 Vite 成功。

### Task 5: 測試 API、正規化與回歸流程

**Files:**
- Create or Modify: `backend/tests/test_subtitles.py`
- Modify: `docs/plans/2026-08-28-subtitle-workbench-design.md`（若驗證後有決策修正）
- Modify: `README.md`
- Modify: `README.zh-TW.md`

**Step 1: 後端純函式測試**

測試手動資料經 `build_subtitles_json` 後：source 為 `manual`、中文轉繁體、日文有 romaji、words 為 null；測試錯誤時間與空文字被 API 驗證拒絕。

**Step 2: API 整合測試**

使用暫時歌曲資料夾或既有測試歌曲呼叫 PUT endpoint，確認回傳資料、`subtitles.json` 原子更新、重新 GET 內容一致；不執行下載、Demucs 或 Whisper。

**Step 3: 前端回歸建置**

Run: `cd frontend && npm run build`
Expected: PASS。注意目前工作區另有未提交的 LUMA 檔案；只在確認 build 產物確實屬於 KTV bundle 後，才加入字幕功能相關的 static 產物，不得覆蓋或提交 LUMA 變更。

**Step 4: 手動驗收清單**

在 `/studio/:id` 驗證：
- 無字幕歌曲可展開工作台並貼上純文字。
- 播放時逐句打點會銜接 start/end。
- 修改文字後 KTV 立即反映，儲存/重新整理後仍保留。
- LRC/SRT/VTT 匯入時間正確。
- 拆分、合併、刪除、跳轉與錯誤提示可用。
- 匯出影片讀到新的字幕，既有 LRCLIB/Whisper/重新辨識功能不受影響。

**Step 5: 更新 README**

在中英文 README 功能與使用流程加入：字幕工作台、支援格式、逐句播放打點、手動儲存，以及手動修正會退回逐句高亮的說明。

**Step 6: 最終檢查與提交**

Run:
```bash
git diff --check
git status --short
```
Expected: 沒有 whitespace error；未提交的 LUMA 檔案仍保持原狀且不在本次 commit。

```bash
git add backend/app/main.py backend/app/services/subtitles.py backend/tests frontend/src/api.ts frontend/src/components/SubtitleEditor.tsx frontend/src/lib/subtitleFormats.ts frontend/src/pages/StudioPage.tsx README.md README.zh-TW.md docs/plans/2026-08-28-subtitle-workbench-design.md docs/plans/2026-08-28-subtitle-workbench-implementation.md
git commit -m "feat: 完成字幕工作台匯入編輯與手動對齊"
```

**Acceptance criteria:**
- 使用者可以在沒有字幕的歌曲上，貼上/匯入歌詞、逐句打點、修改文字並儲存。
- 使用者可以立即修正當前字幕，不需重新跑 AI。
- 來源徽章顯示「手動編輯」，日文羅馬拼音與中文正體化仍由後端處理。
- 所有 parser、API、TypeScript build 與既有字幕流程驗證通過。
