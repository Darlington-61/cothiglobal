@echo off
title COTHI Examination Terminal - Secure Kiosk
cls
echo ======================================================================
echo           COTHI EXAMINATION TERMINAL - SECURE KIOSK
echo ======================================================================
echo.
set /p SERVER_IP="Enter Host Admin IP (Press Enter for localhost / same PC): "
if "%SERVER_IP%"=="" set SERVER_IP=localhost

set URL=http://%SERVER_IP%:8000/student/

echo Launching Fullscreen Kiosk at %URL%...

REM Check for Edge (Built-in on all Windows 10/11)
start msedge.exe --kiosk "%URL%" --edge-kiosk-type=fullscreen --no-first-run
if %errorlevel% neq 0 (
  REM Fallback to Chrome
  start chrome.exe --kiosk "%URL%"
)
