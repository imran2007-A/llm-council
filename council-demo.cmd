@echo off
title LLM Council (demo)
cd /d "%~dp0"

rem ---------------------------------------------------------------------------
rem  Double-click to run LLM Council.
rem
rem  One process does everything: the FastAPI server also serves the built
rem  interface, so there is no second window and Node is not needed to run it.
rem  Closing this window stops the council.
rem
rem  Demo mode: canned answers, zero API requests. Safe to leave running.
rem ---------------------------------------------------------------------------

if not exist ".venv\Scripts\python.exe" (
  echo.
  echo   Cannot find .venv\Scripts\python.exe
  echo.
  echo   Set the project up once:
  echo     python -m venv .venv
  echo     .venv\Scripts\pip install -r requirements.txt
  echo.
  pause
  exit /b 1
)

if not exist "static_web\index.html" (
  echo.
  echo   Building the interface. This needs Node and only happens once.
  echo.
  pushd web
  call npm install
  call npm run build
  popd
)

rem Give the server a few seconds to bind before the browser asks for the page.
start "" /b powershell -NoProfile -Command "Start-Sleep -Seconds 4; Start-Process 'http://127.0.0.1:8000/?dry=1'"

echo.
echo   LLM Council is starting...
echo   http://127.0.0.1:8000/?dry=1
echo.
echo   Close this window to stop it.
echo.

rem Foreground on purpose: closing this window shuts the server down with it.
".venv\Scripts\python.exe" -m uvicorn server:app --port 8000
