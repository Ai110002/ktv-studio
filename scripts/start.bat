@echo off
setlocal
chcp 65001 >nul
title KTV Studio
cd /d "%~dp0..\backend"

REM winget can install FFmpeg after this terminal was opened. Reload the
REM persistent user PATH so the server works on the first run without a restart.
for /f "tokens=2,*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul ^| findstr /i "Path"') do set "PATH=%%B;%PATH%"

if not exist ".venv\Scripts\python.exe" (
  echo [ERROR] Backend not installed yet. Run scripts\setup.bat first.
  pause
  exit /b 1
)

where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo [ERROR] ffmpeg was not found. Run scripts\setup.bat first, then start again.
  pause
  exit /b 1
)
where ffprobe >nul 2>nul
if errorlevel 1 (
  echo [ERROR] ffprobe was not found. Run scripts\setup.bat first, then start again.
  pause
  exit /b 1
)

echo Starting KTV Studio: http://localhost:8000
start "" "http://localhost:8000"
".venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
pause
