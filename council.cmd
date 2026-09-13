@echo off
title LLM Council
cd /d "%~dp0"

rem ---------------------------------------------------------------------------
rem  Double-click to run LLM Council.
rem
rem  One process does everything: the FastAPI server also serves the built
rem  interface, so there is no second window and Node is not needed to run it.
rem  Closing this window stops the council.
rem
rem  Real models. Each question spends roughly 9-11 of your 50 daily requests.
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

rem Wait until the server actually answers before opening the browser.
rem A fixed delay was wrong: uvicorn takes eight or nine seconds to bind on a
rem cold start, the browser arrived after four, and the first thing anyone saw
rem was "site can't be reached".
start "" /b powershell -NoProfile -Command "for($i=0;$i -lt 120;$i++){ try{ $null = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/api/config' -UseBasicParsing -TimeoutSec 1; Start-Process 'http://127.0.0.1:8000/'; break } catch { Start-Sleep -Milliseconds 400 } }"

echo.
echo   Starting. The browser opens when the council is ready
echo   ^(about ten seconds on a cold start^).
echo   http://127.0.0.1:8000/
echo.
echo   Close this window to stop it.
echo.

rem Foreground on purpose: closing this window shuts the server down with it.
".venv\Scripts\python.exe" -m uvicorn server:app --port 8000
