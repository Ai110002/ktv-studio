# KTV Studio（卡拉錄唱室）

一個完全在 macOS 本機執行的卡拉 OK 錄唱工具。貼上 YouTube 連結或上傳音訊後，它會分離人聲與伴奏、產生 KTV 字幕、提供 7 段 EQ，並把麥克風與伴奏錄成 MP3。

## 功能

- YouTube 連結或本機音訊檔匯入
- Demucs 去人聲（`--shifts 1 --overlap 0.5` 高品質參數）：產生人聲軌與純伴奏軌
- 人聲動態穩定化（dynaudnorm）：解決分離後音量忽大忽小的問題
- 伴奏響度正規化（EBU R128，-16 LUFS）：播放音量一致
- YouTube 字幕優先；沒有字幕時以 faster-whisper 辨識人聲
- 日文字幕附羅馬拼音；中文自動轉為臺灣繁體
- KTV 逐字／逐句高亮、可點擊歌詞跳轉
- 7 段伴奏 EQ：平坦、柔和、去刺耳、明亮、低音加強
- **Cover 錄影**：鏡頭畫面 + 已上字幕（一句一句換），字型可選、字幕位置可拖曳，輸出含混音伴奏的 MP4
- 麥克風音量表、即時混音錄製：純音訊 MP3 或 Cover 影片 MP4
- 單一工作佇列，適合 8GB RAM 的 Apple Silicon 電腦

## 系統需求

- macOS（Apple Silicon 建議使用 MPS 加速）
- Python 3.12、[uv](https://docs.astral.sh/uv/)
- Node.js 與 npm
- `ffmpeg`（含 `ffprobe`）

後端相依由 `backend/pyproject.toml` 管理；首次實際處理沒有快取過的 Demucs／Whisper 模型時，相關套件可能需要下載模型檔案。

## 一鍵啟動

在專案根目錄執行：

```bash
./scripts/start.sh
```

腳本會：

1. 檢查 `backend/.venv`；不存在時才執行 `uv sync`。
2. 檢查 `backend/app/static/index.html`；不存在時才執行 `npm install && npm run build`。
3. 啟動 `http://localhost:8000` 並自動以預設瀏覽器開啟。

按 `Ctrl+C` 可停止伺服器。

## 開發模式

後端與前端可分別啟動。前端開發伺服器會把 `/api` 代理到後端的 8000 埠。

```bash
cd backend
.venv/bin/python -m uvicorn app.main:app --reload --port 8000
```

```bash
cd frontend
npm install
npm run dev
```

正式前端建置產物會輸出到 `backend/app/static/`，FastAPI 會提供 React Router 的 SPA fallback。

## 使用方式

1. 在「匯入歌曲」貼上 YouTube 網址，或拖放一個音訊檔。
2. 等待五個步驟完成：取得音訊、分離音軌、辨識歌詞、整理字幕、完成歌曲。
3. 在錄唱室播放伴奏、跟著字幕唱，必要時調整 EQ 與伴奏音量。
4. 錄製成品有兩種方式：
   - **純音訊**：點「啟用麥克風」→「開始錄音」→ 停止後自動轉成 `cover.mp3` 可下載。
   - **Cover 影片**：點「開啟鏡頭」→ 在畫面上拖曳字幕到喜歡的位置、選擇字型與大小 →「開始錄影」→ 停止後自動轉成 `cover.mp4`（含鏡頭、字幕與混音伴奏）可下載。
5. 影片錄製中無法同時使用純音訊錄音（反之亦然）。

所有歌曲與工作狀態都保存在 `backend/data/`，該資料夾不會提交到 Git。

## 常見問題

### 去人聲失敗或很慢

系統會先使用 Apple Silicon 的 MPS；若 Demucs 在 MPS 上失敗，會自動以 CPU 重試。8GB 記憶體的電腦一次只會處理一首歌，請等待目前工作完成。

### 沒有字幕，或字幕不夠準

YouTube 有可用字幕時會優先使用。否則系統會辨識純人聲軌；部分歌曲的人聲混音、語言或背景和聲可能影響辨識結果。沒有可用字幕時歌曲仍可播放與錄唱。

### 瀏覽器無法錄音

確認網址是 `http://localhost:8000` 或 `http://localhost:5173`，並在瀏覽器網站設定中允許麥克風。若使用藍牙耳機，請先確認 macOS 已選到正確的輸入裝置。

### 成品沒有伴奏或人聲

錄音時請先播放伴奏，並確認「啟用麥克風」後音量表有反應。錄唱成品是瀏覽器內以 Web Audio 混合的麥克風與 EQ 後伴奏。
