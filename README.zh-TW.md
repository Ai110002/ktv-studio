# 🎤 KTV Studio — 本地卡拉 OK 錄唱室

把任何 YouTube 影片或音訊檔，變成你自己電腦上的卡拉 OK 錄唱室：
自動去人聲、產生 KTV 風字幕（日文附**羅馬拼音**）、簡易 7 段 EQ 調音，
還能**錄音或錄影**你的 Cover 成品——全部在本機處理，音訊不會離開你的電腦。

> 🇬🇧 [English](README.md)

## ✨ 功能

- **貼 YouTube 連結或上傳音訊檔**（MP3 / M4A / WAV / WebM…）
- **AI 去人聲**（Demucs）— 高品質參數（`--shifts 1 --overlap 0.5`），產出純伴奏 + 純人聲
- **人聲穩定化** — 解決去人聲後音量忽大忽小的問題（dynaudnorm）
- **伴奏響度正規化**（EBU R128，−16 LUFS）
- **KTV 字幕，三層來源（依序嘗試）：**
  - YouTube 有字幕就優先使用（自動清理滾動式重複字幕）
  - **歌詞庫（LRCLIB）** — 熱門歌曲（日/中/英）都有正確歌詞 + 現成時間軸，不需要語音辨識
  - 語音辨識（faster-whisper）作為最後手段，且是**逐字時間軸**
- **貼上正確歌詞**可重新對齊字幕：辨識錯誤時，在錄唱室貼歌詞 → 系統以正確歌詞重新辨識（Whisper 提示詞模式）
- **日文歌詞自動附羅馬拼音**（逐字 + 整句）；簡體中文自動轉臺灣繁體
- **KTV 逐字高亮**、點歌詞跳轉
- **7 段 EQ**（平坦 / 柔和 / 去刺耳 / 明亮 / 低音加強）— 瀏覽器內即時調整
- **兩種錄製方式：**
  - **純音訊**：麥克風 + EQ 後伴奏 → `cover.mp3`
  - **Cover 影片**：鏡頭 + 上字幕 → `cover.mp4`（H.264 + AAC）
    - 鏡像預覽（像照鏡子，所見即所得）；字型、字體大小可選，**字幕位置可拖曳**（每首歌記憶）
    - **錄影濾鏡**（美白 / 鮮豔 / 暖陽 / 冷冽 / 復古 / 黑白，強度可調，會錄進影片）
    - **「在剪映中開啟」一鍵接軌**（macOS）— 把 cover.mp4 直接丟進免費剪輯軟體剪映（CapCut）繼續剪
    - 唱歌時看右邊放大的逐字歌詞即可
- 單一工作佇列，8GB 記憶體的電腦也能順跑

## 🖥️ 硬體需求

| 等級 | 規格 | 體驗 |
|---|---|---|
| 入門 | Apple M1/M2 基礎款 8GB、Intel i5-8代 / Ryzen 5 + 16GB | 一首歌約 5~8 分鐘 |
| 建議 | Apple M1 Pro+、16GB，或任何 NVIDIA 顯卡（GTX 1060+） | 去人聲快一倍以上 |
| 舒適 | Apple M2 Pro/Max、RTX 3060+ | 去人聲只要 10~30 秒 |

實測（Apple M1 8GB）：去人聲約 1.5~2 分鐘/首（MPS 加速），辨識約 3~4 分鐘（medium 模型，快取後更快）。

## 🚀 快速開始

**需求：** macOS（Homebrew）或 Windows 10/11 · 約 6GB 可用磁碟

```bash
./scripts/setup.sh    # macOS：自動安裝 uv + ffmpeg，接著安裝後端相依
./scripts/start.sh    # 啟動伺服器並自動開啟 http://localhost:8000
```

Windows：

```bat
scripts\setup.bat     :: 必須先執行：用 winget 安裝 uv、ffmpeg、ffprobe，並安裝後端相依
scripts\start.bat     :: 確認 ffmpeg/ffprobe 後啟動伺服器並開啟 http://localhost:8000
```

第一次處理歌曲會自動下載 AI 模型（Demucs 約 330MB、Whisper medium 約 1.5GB）。
前端已預建置並提交在 repo 內，**一般使用不需要安裝 Node.js**。

### Windows：給 AI agent／自動化的必要步驟

不要只啟動後端或直接執行 `start.bat`；音訊處理**必須**先有 `ffmpeg` 與 `ffprobe`。

```bat
scripts\setup.bat
ffmpeg -version
ffprobe -version
scripts\start.bat
```

`setup.bat` 會以 `winget` 安裝正確的套件識別碼 `Gyan.FFmpeg`，並在同一個終端工作階段加入其路徑；不必關閉或重開終端。`start.bat` 也會再次尋找並驗證兩個工具。若任一驗證失敗，先重新執行 `scripts\setup.bat`，不要略過此步驟。

## 🐣 給完全不會的人：一步步安裝

如果你從來沒用過終端機，照下面做就好：

**macOS**

1. 打開 <https://github.com/Ai110002/ktv-studio> → 點綠色 **Code** → **Download ZIP** → 雙擊解壓縮。
2. 按 `Cmd + 空白鍵`，輸入「終端機」並開啟。
3. 輸入 `cd Downloads/ktv-studio-main` 按 Enter（如果解壓到別的地方，改用那個資料夾路徑）。
4. 輸入 `./scripts/setup.sh` 按 Enter，等它跑完（5~10 分鐘，自動安裝一切）。
5. 輸入 `./scripts/start.sh` 按 Enter，瀏覽器自動打開 App。完成！🎉

**Windows**

1. 打開 <https://github.com/Ai110002/ktv-studio> → 點綠色 **Code** → **Download ZIP** → 解壓縮。
2. 按 Windows 鍵，輸入「PowerShell」並開啟。
3. 輸入 `cd Downloads\ktv-studio-main` 按 Enter（解壓到別處就改路徑）。
4. 輸入 `.\scripts\setup.bat` 按 Enter，等它跑完（5~10 分鐘）；它會安裝並驗證 `ffmpeg` 和 `ffprobe`。
5. 輸入 `.\scripts\start.bat` 按 Enter，瀏覽器自動打開 App。完成！🎉

**第一次使用會發生什麼：** 第一首處理的歌會下載 AI 模型
（Demucs 約 330MB 去人聲、Whisper 約 1.5GB 歌詞辨識）。只有一次，
之後除了從 YouTube 下載音訊外，都可以離線運作。

### 使用方式

1. 貼上 YouTube 網址，或拖放音訊檔。
2. 等待五個步驟：取得音訊 → 分離音軌 → 辨識歌詞 → 整理字幕 → 完成。
3. 按播放、視需要調整 EQ，跟著字幕唱。
4. 錄製：**純音訊**（麥克風 + 伴奏 → MP3）或 **Cover 影片**（鏡頭 + 字幕 → MP4）。
   兩者不能同時錄。

### 開發模式

```bash
cd backend && .venv/bin/python -m uvicorn app.main:app --reload --port 8000
cd frontend && npm install && npm run dev   # Vite dev server 會把 /api 代理到 :8000
npm run build                                # 產出到 backend/app/static/
```

## 📁 專案結構

```
backend/
  app/            # FastAPI：管線、工作佇列（單一執行）、服務
    services/     # downloader（yt-dlp）、separator（demucs）、transcriber（faster-whisper）、
                  # subtitles（羅馬拼音/繁中）、audio（ffmpeg 輔助）
  data/           # 歌曲與工作狀態（gitignored，執行時建立）
frontend/
  src/            # React + Vite：匯入 / 歌曲庫 / 錄唱室
    components/   # KTVLyrics、Equalizer、VideoPanel、RecorderPanel、AudioEngine
scripts/
  setup.sh        # 一鍵安裝
  start.sh        # 一鍵啟動
```

資料模型與 API 合約：[`docs/plans/2026-08-27-ktv-studio-design.md`](docs/plans/2026-08-27-ktv-studio-design.md)

## 🙏 感謝

- [Demucs](https://github.com/facebookresearch/demucs)（MIT）— 去人聲
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper)（MIT）— 語音辨識
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)（Unlicense）— YouTube 音訊與字幕
- [pykakasi](https://github.com/miurahr/pykakasi)（MIT）— 日文羅馬拼音
- [OpenCC](https://github.com/BYVoid/OpenCC)（Apache-2.0）— 簡體轉繁體
- [FastAPI](https://fastapi.tiangolo.com/)（MIT）、[React](https://react.dev/)（MIT）、[Vite](https://vite.dev/)（MIT）

## ⚠️ 免責聲明

本工具會從 YouTube 下載音訊並分離人聲，僅供**個人卡拉 OK 練習**使用。
請遵守你所在地的著作權法與 YouTube 服務條款；只使用你有權使用的內容
（自己的錄音、CC 授權音樂等），請勿散佈受著作權保護的素材。
本專案以「現狀」提供，不附任何擔保。

## 📄 授權

[MIT](LICENSE) © 2026 Ian
