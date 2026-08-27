@echo off
setlocal
chcp 65001 >nul
title KTV Studio - One-click setup (Windows)
echo ============================================================
echo   KTV Studio - one-click setup for Windows
echo   It will install: uv (Python package manager) and ffmpeg
echo   via winget if missing, then install backend dependencies.
echo ============================================================
echo.

set "ROOT=%~dp0.."

REM --- refresh PATH so freshly installed tools are visible ---
set "PATH=%USERPROFILE%\.local\bin;%LOCALAPPDATA%\Microsoft\WinGet\Links;%PATH%"

REM --- check winget ---
where winget >nul 2>nul
if errorlevel 1 (
  echo [ERROR] winget not found. Please update Windows 10/11 (winget is built-in).
  pause
  exit /b 1
)

REM --- uv ---
where uv >nul 2>nul
if errorlevel 1 (
  echo [1/3] Installing uv ^(Python package manager^)...
  winget install --id astral-sh.uv -e --accept-source-agreements --accept-package-agreements >nul
  if errorlevel 1 (
    echo [ERROR] Failed to install uv. Try running this script again after reopening the terminal.
    pause
    exit /b 1
  )
  set "PATH=%USERPROFILE%\.local\bin;%PATH%"
)
echo [OK] uv found.

REM --- ffmpeg ---
where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo [2/3] Installing ffmpeg ^(audio/video processing^)...
  winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements >nul
  if errorlevel 1 (
    echo [ERROR] Failed to install ffmpeg. Try again after reopening the terminal.
    pause
    exit /b 1
  )
)
echo [OK] ffmpeg found.

REM --- install backend dependencies ---
echo [3/3] Installing backend dependencies ^(first run downloads PyTorch, takes a while^)...
cd /d "%ROOT%\backend"
call uv sync
if errorlevel 1 (
  echo [ERROR] Backend dependency installation failed.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   Setup complete!
echo   To start:  scripts\start.bat
echo   Browser will open http://localhost:8000
echo   First song processing downloads AI models
echo   ^(Demucs ~330MB, Whisper medium ~1.5GB^)
echo ============================================================
pause
