# ============================================================================
#  COTHI CBT — Build one-click installers
#  Run this ONCE on your Windows build PC (needs internet only the first time
#  you install Inno Setup). It produces two single-file installers you copy to
#  schools:
#     installer\dist\COTHI-Server-Setup.exe   -> teacher / admin PC
#     installer\dist\COTHI-Student-Setup.exe  -> each student PC
#
#  Requirement (one-time): Inno Setup 6 (free) from https://jrsoftware.org/isinfo.php
#  After copying a Setup.exe to a school PC, the school just double-clicks it —
#  no loose files, no folder copying.
# ============================================================================

$ErrorActionPreference = "Stop"
$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $baseDir

Write-Host "==== STEP 1: Packaging the Electron apps (folders) ====" -ForegroundColor Cyan
& (Join-Path $baseDir "package_apps.ps1")

# Locate the Inno Setup command-line compiler (ISCC.exe)
Write-Host "`n==== STEP 2: Locating Inno Setup compiler (ISCC.exe) ====" -ForegroundColor Cyan
$iscc = $null
$candidates = @(
  "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
  "C:\Program Files\Inno Setup 6\ISCC.exe"
)
foreach ($c in $candidates) { if (Test-Path $c) { $iscc = $c; break } }
if (-not $iscc) {
  $cmd = Get-Command ISCC.exe -ErrorAction SilentlyContinue
  if ($cmd) { $iscc = $cmd.Source }
}
if (-not $iscc) {
  Write-Host "`nInno Setup not found." -ForegroundColor Yellow
  Write-Host "Install it once (free) from https://jrsoftware.org/isdl.php then run this script again."
  Write-Host "The packaged app FOLDERS are ready meanwhile:"
  Write-Host "   $baseDir\COTHI-Server-App   and   $baseDir\COTHI-Student-App"
  Write-Host "You can deploy by copying a WHOLE folder to a school PC in the meantime."
  exit 1
}
Write-Host "Found: $iscc"

Write-Host "`n==== STEP 3: Compiling installers ====" -ForegroundColor Cyan
& $iscc (Join-Path $baseDir "installer\COTHI-Server.iss")
& $iscc (Join-Path $baseDir "installer\COTHI-Student.iss")

Write-Host "`n==== DONE ====" -ForegroundColor Green
Write-Host "Installers created in: $baseDir\installer\dist"
Write-Host "  - COTHI-Server-Setup.exe   (copy to the teacher/admin PC, run once)"
Write-Host "  - COTHI-Student-Setup.exe  (copy to each student PC, run once)"
