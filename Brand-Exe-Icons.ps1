# ============================================================================
#  Brand the .exe FILE icons (the icon File Explorer shows on the .exe itself)
#  Double-click is not enough for .ps1 — run it like this:
#     1. Right-click this file  ->  "Run with PowerShell"
#        (if blocked: open PowerShell in this folder and run:
#         powershell -ExecutionPolicy Bypass -File Brand-Exe-Icons.ps1 )
#
#  IMPORTANT: close COTHI-Server / COTHI-Student first — Windows can't change
#  the icon of a running .exe.
# ============================================================================

$ErrorActionPreference = "Stop"
$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rcedit  = Join-Path $baseDir "rcedit.exe"
$icon    = Join-Path $baseDir "icon.ico"

if (-not (Test-Path $rcedit)) { Write-Host "rcedit.exe not found in this folder." -ForegroundColor Red; Read-Host "Press Enter to exit"; exit 1 }
if (-not (Test-Path $icon))   { Write-Host "icon.ico not found in this folder."   -ForegroundColor Red; Read-Host "Press Enter to exit"; exit 1 }

# Every COTHI launcher .exe we want to brand (only the ones that exist get stamped)
$targets = @(
  (Join-Path $baseDir "COTHI-Server-App\COTHI-Server.exe"),
  (Join-Path $baseDir "COTHI-Student-App\COTHI-Student-Exam.exe"),
  (Join-Path $baseDir "student-electron-app\electron-bin\electron.exe")
)

$done = 0
foreach ($exe in $targets) {
  if (Test-Path $exe) {
    try {
      & $rcedit $exe --set-icon $icon
      Write-Host ("Branded: " + $exe) -ForegroundColor Green
      $done++
    } catch {
      Write-Host ("FAILED (is it running? close it and retry): " + $exe) -ForegroundColor Yellow
    }
  }
}

if ($done -eq 0) {
  Write-Host "`nNo COTHI .exe files found yet. Run package_apps.ps1 first, then run this." -ForegroundColor Yellow
} else {
  Write-Host "`nStamped $done file(s)." -ForegroundColor Cyan
  # Nudge Windows to refresh its icon cache so the new icon shows right away
  try { ie4uinit.exe -show } catch {}
  try { ie4uinit.exe -ClearIconCache } catch {}
  Write-Host "If Explorer still shows the old icon, press F5, or sign out/in once."
}
Read-Host "`nDone. Press Enter to close"
