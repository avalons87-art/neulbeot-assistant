@echo off
title Neulbeot - Update
chcp 65001 >nul
cd /d "%~dp0"

REM ============================================================
REM  Updates the app to the latest version (downloads from GitHub).
REM  No git needed. Your keys / folders / schedule are kept.
REM  Close the running app first, then run this.
REM ============================================================

where node >nul 2>&1
if errorlevel 1 (
  echo [!] Node.js is not installed. Install from https://nodejs.org then run again.
  start "" https://nodejs.org/en/download
  pause & exit /b
)

echo Downloading and applying the latest version...
node --use-system-ca -e "require('./src/updater').applyUpdate().then(r=>console.log('  updated files:',r.copied)).catch(e=>{console.error('  FAILED:',e.message);process.exit(1)})"
if errorlevel 1 ( echo. & echo Update failed. Check update-source.txt / internet. & pause & exit /b )

echo Updating dependencies...
call npm install --no-audit --no-fund

echo.
echo ============================================
echo   Done. Launch start-server.bat to run it.
echo ============================================
echo.
pause
