@echo off
cd /d "%~dp0"
title COTHI Offline CBT - Local Wi-Fi Exam Server (Electron Desktop)
color 0A
cls
echo ======================================================================
echo           COTHI OFFLINE CBT LOCAL SERVER - EXAM CONTROLLER
echo ======================================================================
echo.
echo  Starting local exam server and Native Electron Admin Console...
echo  Zero Internet Data Required!
echo.
echo ======================================================================
echo.

if exist "student-electron-app\electron-bin\electron.exe" (
  start "" "student-electron-app\electron-bin\electron.exe" "main.js"
  exit /b
)

REM Fallback if electron not found
start "" "http://localhost:8000/admin/"
node server\server.js
pause
