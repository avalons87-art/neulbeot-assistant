@echo off
title Neulbeot - Make Teacher Package
chcp 65001 >nul
cd /d "%~dp0"

REM ===============================================================
REM  Builds a teacher-ready package (node_modules bundled) and zips
REM  it, so each teacher unzips and runs start-server.bat on THEIR
REM  OWN PC (their own folder, their own auto-analysis).
REM
REM  Update flow: teachers use the in-app update button (no git).
REM  Set update-source.txt to your GitHub repo first.
REM
REM  Before running: put the LIMITED shared key in teacher-keys.bat
REM ===============================================================

set "SRC=%CD%"
set "DEST=%CD%\..\Neulbeot-Teacher-Package"
set "ZIP=%CD%\..\Neulbeot-Teacher-Package.zip"

echo Building teacher package (copies node_modules, may take a minute)...
if exist "%DEST%" rmdir /s /q "%DEST%"
mkdir "%DEST%"

robocopy "%SRC%" "%DEST%" /E /NFL /NDL /NJH /NJS /NP /XF my-keys.bat owner.txt work-dir.txt user-folders.json user-profiles.json folder-analysis.json keys.json schedule.json brand.txt brand-teacher.txt teacher-keys.bat make-teacher-package.bat /XD outputs .git .claude >nul

REM Set the teacher-version brand name
if exist "%SRC%\brand-teacher.txt" (
  copy /y "%SRC%\brand-teacher.txt" "%DEST%\brand.txt" >nul
  echo   - Teacher brand name set
)

REM Bundle the shared (limited) key as my-keys.bat inside the package
if exist "%SRC%\teacher-keys.bat" (
  copy /y "%SRC%\teacher-keys.bat" "%DEST%\my-keys.bat" >nul
  echo   - Shared key bundled from teacher-keys.bat
) else (
  echo   [!] teacher-keys.bat NOT found. Teachers would run in demo mode.
)

REM Zip it up
if exist "%ZIP%" del /q "%ZIP%"
powershell -NoProfile -Command "Compress-Archive -Path (Join-Path $env:DEST '*') -DestinationPath $env:ZIP -Force"

echo.
echo ===============================================
echo   Done.
echo   Folder: %DEST%
echo   Zip:    %ZIP%
echo.
echo   Give the ZIP to each teacher.
echo   They unzip, run start-server.bat, pick their own folder.
echo ===============================================
echo.
pause
