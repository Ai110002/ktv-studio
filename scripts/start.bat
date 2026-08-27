@echo off
setlocal
chcp 65001 >nul
title KTV Studio
cd /d "%~dp0..\backend"

if not exist ".venv\Scripts\python.exe" (
  echo [ERROR] Backend not installed yet. Run scripts\setup.bat first.
  pause
  exit /b 1
)

echo Starting KTV Studio: http://localhost:8000
start "" "http://localhost:8000"
".venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
pause
