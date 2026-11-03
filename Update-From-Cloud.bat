@echo off
title COTHI CBT - Over-The-Air (OTA) Remote Update
color 0b
echo ============================================================
echo           COTHI OFFLINE CBT TERMINAL - OTA UPDATE
echo ============================================================
echo.
echo [1/4] Checking Internet Connection (Wi-Fi or Phone Hotspot)...
ping -n 1 8.8.8.8 >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] No internet connection detected!
    echo Please turn on your phone hotspot or connect to Wi-Fi, then run this again.
    echo.
    pause
    exit /b 1
)
echo [OK] Internet is active!

echo.
echo [2/4] Pulling latest code and bug fixes from GitHub...
where git >nul 2>&1
if %errorlevel% equ 0 (
    git fetch origin cbt-offline-terminal
    git pull --no-edit origin cbt-offline-terminal
    echo [OK] Latest code pulled from branch cbt-offline-terminal.
) else (
    echo [INFO] Git CLI not found in PATH. Proceeding with Cloud Data & Asset Sync...
)

echo.
echo [3/4] Syncing latest questions, schools, and cloud records...
node -e "const ota = require('./server/ota'); ota.applyUpdate().then(r => { console.log(r.message); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });"

echo.
echo [4/4] Verifying Distribution Server & Student Assets...
if exist "COTHI-Server-App\resources\app\server" (
    xcopy /E /I /Y "server\*" "COTHI-Server-App\resources\app\server\" >nul 2>&1
    xcopy /E /I /Y "public\*" "COTHI-Server-App\resources\app\public\" >nul 2>&1
    echo [OK] Packaged Server files synchronized.
)

echo.
echo ============================================================
echo   UPDATE COMPLETED! All bug fixes, features, and questions
echo   are now up to date. You can now disconnect the hotspot.
echo ============================================================
echo.
pause
