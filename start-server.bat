@echo off
title Neulbeot Assistant
chcp 65001 >nul
cd /d "%~dp0"

REM =============================================================
REM  Neulbeot Assistant - pixel AI team helper
REM  Double-click to run. Closing this window stops the server.
REM  API keys live in my-keys.bat  (edit only that file).
REM =============================================================

set PORT=4000

REM Node.js check (teachers need it installed)
where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo [!] Node.js is not installed on this PC.
  echo     1^) Download the LTS version from https://nodejs.org
  echo     2^) Install it, then run start-server.bat again
  echo.
  start "" https://nodejs.org/en/download
  pause
  exit /b
)

REM Load API keys if the key file exists (otherwise runs in demo mode)
if exist "%~dp0my-keys.bat" call "%~dp0my-keys.bat"

echo ===============================================
echo   Neulbeot Assistant
echo   URL: http://localhost:%PORT%
echo   (Closing this window stops the server)
echo ===============================================
echo.

REM Open the browser after 3 seconds
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:%PORT%"

:run
REM --use-system-ca : trust the Windows certificate store so Gemini API works
REM   behind the school's HTTPS-inspecting network (fixes "fetch failed / self-signed cert")
node --use-system-ca src\server.js
echo.
echo [!] Server stopped. Restarting in 5 seconds... (close window to stop)
timeout /t 5 /nobreak >nul
goto run
