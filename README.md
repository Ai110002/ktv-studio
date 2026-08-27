# 🎤 KTV Studio — Local Karaoke Cover Studio

Turn any YouTube video or audio file into a personal karaoke studio on your own computer.
It separates vocals, generates KTV-style subtitles (with **romaji for Japanese**), gives you a
simple 7-band EQ, and lets you **record audio or video covers** — all processed locally, nothing leaves your machine.

> 🇹🇼 [繁體中文版](README.zh-TW.md)

## ✨ Features

- **Import from YouTube URL or local audio file** (MP3 / M4A / WAV / WebM…)
- **AI vocal separation** (Demucs) — produces clean instrumental + vocals tracks with quality settings (`--shifts 1 --overlap 0.5`)
- **Vocal stabilization** — fixes the uneven loudness ("忽大忽小") common after separation (dynaudnorm)
- **Instrumental loudness normalization** (EBU R128, −16 LUFS)
- **KTV subtitles, two sources:**
  - YouTube subtitles when available (with rolling-caption cleanup)
  - Otherwise automatic speech recognition (faster-whisper) with **word-level timestamps**
- **Japanese lyrics come with romaji** (per-word + per-line); Chinese is converted to Traditional (Taiwan)
- **KTV word-by-word highlight**, click a line to seek
- **7-band EQ** with presets (Flat / Soft / De-harsh / Bright / Bass boost) — real-time in the browser
- **Record covers two ways:**
  - **Audio**: mic + EQ'd instrumental → `cover.mp3`
  - **Video**: webcam + burned-in subtitle → `cover.mp4` (H.264 + AAC)
    - mirrored preview (like a mirror), subtitle font & size selectable, **drag subtitle position** (remembered per song)
    - a ~50% transparent word-flowing karaoke aid overlay while singing (not burned into the video)
- Single-job queue tuned for 8 GB RAM machines

## 🖥️ Hardware Requirements

| Tier | Specs | Experience |
|---|---|---|
| Minimum | Apple M1/M2 base (8 GB), Intel i5-8th gen / Ryzen 5 + 16 GB | ~5–8 min per song |
| Recommended | Apple M1 Pro+, 16 GB, or any NVIDIA GPU (GTX 1060+) | separation is 2×+ faster |
| Comfortable | Apple M2 Pro/Max, RTX 3060+ | separation in 10–30 s |

Measured on Apple M1 (8 GB): separation ≈ 1.5–2 min per 3.5-min song (MPS), transcription ≈ 3–4 min (medium model, cached after first run).

## 🚀 Quick Start

**Requirements:** macOS (Homebrew) or Windows 10/11 · ~6 GB free disk

```bash
./scripts/setup.sh    # macOS: installs uv + ffmpeg automatically, then installs backend deps
./scripts/start.sh    # starts the server and opens http://localhost:8000
```

Windows:

```bat
scripts\setup.bat     :: installs uv + ffmpeg via winget, then installs backend deps
scripts\start.bat     :: starts the server and opens http://localhost:8000
```

First song processing downloads AI models automatically (Demucs ≈ 330 MB, Whisper medium ≈ 1.5 GB).
The frontend is pre-built and committed, so **Node.js is not required** for normal use.

> ⚠️ The Windows scripts follow the standard winget flow but have not been tested on a real Windows machine yet.

## 🐣 Installation for Absolute Beginners

If you have never used a terminal before, follow these steps:

**macOS**

1. Go to <https://github.com/Ai110002/ktv-studio> → click green **Code** → **Download ZIP** → double-click to unzip.
2. Press `Cmd + Space`, type `Terminal` and open it.
3. Type `cd Downloads/ktv-studio-main` and press Enter. (If you unzipped elsewhere, use that folder instead.)
4. Type `./scripts/setup.sh` and press Enter. Wait — it installs everything automatically (5–10 min).
5. Type `./scripts/start.sh` and press Enter. Your browser opens the app. Done! 🎉

**Windows**

1. Go to <https://github.com/Ai110002/ktv-studio> → click green **Code** → **Download ZIP** → extract it.
2. Press the Windows key, type `PowerShell` and open it.
3. Type `cd Downloads\ktv-studio-main` (adjust if you extracted elsewhere) and press Enter.
4. Type `.\scripts\setup.bat` and press Enter. Wait — it installs everything automatically (5–10 min).
5. Type `.\scripts\start.bat` and press Enter. Your browser opens the app. Done! 🎉

**What happens on first use:** the first song you process downloads the AI models
(Demucs ≈ 330 MB for vocal separation, Whisper ≈ 1.5 GB for lyrics recognition).
This happens once; afterwards everything runs offline (except YouTube downloads).

### Usage

1. Paste a YouTube URL or drop an audio file.
2. Wait for the 5 steps: fetch → separate → transcribe → subtitles → finalize.
3. Press play, adjust EQ if needed, sing along with the subtitles.
4. Record: **audio-only** (mic + instrumental → MP3) or **video** (webcam + subtitles → MP4).
   Video and audio recording are mutually exclusive.

### Development

```bash
cd backend && .venv/bin/python -m uvicorn app.main:app --reload --port 8000
cd frontend && npm install && npm run dev   # Vite dev server proxies /api to :8000
npm run build                                # outputs to backend/app/static/
```

## 📁 Project Structure

```
backend/
  app/            # FastAPI app: pipeline, jobs (single-flight queue), services
    services/     # downloader (yt-dlp), separator (demucs), transcriber (faster-whisper),
                  # subtitles (romaji / traditional Chinese), audio (ffmpeg helpers)
  data/           # songs & jobs (gitignored, created at runtime)
frontend/
  src/            # React + Vite: Import / Library / Studio pages
    components/   # KTVLyrics, Equalizer, VideoPanel, RecorderPanel, AudioEngine
scripts/
  setup.sh        # one-command install
  start.sh        # one-command launch
```

Data model & API contract: [`docs/plans/2026-08-27-ktv-studio-design.md`](docs/plans/2026-08-27-ktv-studio-design.md)

## 🙏 Credits

- [Demucs](https://github.com/facebookresearch/demucs) (MIT) — vocal separation
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (MIT) — speech recognition
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense) — YouTube audio & subtitles
- [pykakasi](https://github.com/miurahr/pykakasi) (MIT) — Japanese romaji
- [OpenCC](https://github.com/BYVoid/OpenCC) (Apache-2.0) — Simplified → Traditional Chinese
- [FastAPI](https://fastapi.tiangolo.com/) (MIT), [React](https://react.dev/) (MIT), [Vite](https://vite.dev/) (MIT)

## ⚠️ Disclaimer

This tool downloads audio from YouTube and separates vocals for **personal karaoke practice**.
Please respect copyright law and YouTube's Terms of Service in your jurisdiction. Only use
content you are allowed to use (your own recordings, CC-licensed music, etc.), and do not
redistribute copyrighted material. The project is provided "AS IS" without warranty.

## 📄 License

[MIT](LICENSE) © 2026 Ian
