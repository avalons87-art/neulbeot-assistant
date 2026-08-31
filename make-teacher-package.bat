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

robocopy "%SRC%" "%DEST%" /E /NFL /NDL /NJH /NJS /NP /XF README.md my-keys.bat owner.txt work-dir.txt user-folders.json user-profiles.json folder-analysis.json keys.json schedule.json brand.txt brand-teacher.txt teacher-keys.bat make-teacher-package.bat /XD outputs .git .claude dev-docs >nul

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

REM Let antivirus/indexer settle on freshly-copied files (avoids incomplete zip)
ping -n 4 127.0.0.1 >nul

REM Zip it up (robust .NET method) and verify the shared key made it inside
if exist "%ZIP%" del /q "%ZIP%"
powershell -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; try { [System.IO.Compression.ZipFile]::CreateFromDirectory($env:DEST, $env:ZIP, 'Optimal', $false) } catch { Write-Host ('  [!] ZIP FAILED: ' + $_.Exception.Message); Write-Host '  [!] Close all running Neulbeot server windows, then run this again.'; exit 1 }; $z=[System.IO.Compression.ZipFile]::OpenRead($env:ZIP); $n=$z.Entries.Where({$_.FullName -eq 'my-keys.bat'}).Count; $z.Dispose(); if($n -ne 1){ Write-Host '  [!] WARNING: my-keys.bat NOT in zip - teachers would run in DEMO mode. Close servers and rebuild.' } else { Write-Host '  - Zip verified: shared key included' }"

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
