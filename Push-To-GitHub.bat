@echo off
title Push CBT Terminal to GitHub
echo ============================================================
echo      PUSHING CBT OFFLINE TERMINAL TO GITHUB REPOSITORY
echo ============================================================
echo.
echo Pushing branch 'cbt-offline-terminal' to origin...
git push -u origin cbt-offline-terminal
echo.
if %errorlevel% equ 0 (
    echo [SUCCESS] Pushed to branch 'cbt-offline-terminal' successfully!
) else (
    echo [NOTICE] If GitHub prompts for credentials, please sign in via your browser
    echo or paste your GitHub Personal Access Token (PAT).
)
echo.
pause
