$baseDir = "C:\Users\WORK SPACE\Downloads\CBT"
$electronBin = Join-Path $baseDir "student-electron-app\electron-bin"
$iconPath = Join-Path $baseDir "icon.ico"

# Detect Primary LAN IP so student terminals default directly to this server PC
$primaryIp = "127.0.0.1"
try {
  $activeNet = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
    Sort-Object -Property InterfaceMetric | Select-Object -First 1
  if ($activeNet) { $primaryIp = $activeNet.IPAddress }
} catch {}
Write-Host "Detected Primary LAN IP: $primaryIp"

# Read active school branding from data/settings.json
$settingsPath = Join-Path $baseDir "data\settings.json"
$activeSettings = $null
if (Test-Path $settingsPath) {
  try {
    $activeSettings = Get-Content $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {}
}

$schoolName = if ($activeSettings -and $activeSettings.schoolName) { $activeSettings.schoolName } else { "COTHIGLOBAL Examination Portal" }
$schoolMotto = if ($activeSettings -and $activeSettings.schoolMotto) { $activeSettings.schoolMotto } else { "Official Computer Based Test Terminal" }
$schoolCode = if ($activeSettings -and $activeSettings.schoolCode) { $activeSettings.schoolCode } else { "cothi" }
$schoolLogo = if ($activeSettings -and $activeSettings.schoolLogo) { $activeSettings.schoolLogo } else { "" }
$primaryColor = if ($activeSettings -and $activeSettings.primaryColor) { $activeSettings.primaryColor } else { "#2563eb" }
$accentColor = if ($activeSettings -and $activeSettings.accentColor) { $activeSettings.accentColor } else { "#f8fafc" }
Write-Host "Active School Branding: $schoolName ($schoolCode)"

# Optional: brand the .exe file icon itself (shown in File Explorer / taskbar).
$rcedit = Join-Path $baseDir "rcedit.exe"
function Set-ExeIcon($exePath) {
  if ((Test-Path $rcedit) -and (Test-Path $iconPath)) {
    & $rcedit $exePath --set-icon $iconPath
    Write-Host "   Branded exe icon: $exePath"
  } else {
    Write-Host "   (rcedit.exe not found - exe keeps Electron icon; window/taskbar icon still branded at runtime)"
  }
}

Write-Host "--- 1. Packaging COTHI Student App (.exe) ---"
$studentAppDir = Join-Path $baseDir "COTHI-Student-App"
if (Test-Path $studentAppDir) { Remove-Item -Recurse -Force $studentAppDir }
Copy-Item -Recurse -Force $electronBin $studentAppDir

$studentAppRes = Join-Path $studentAppDir "resources\app"
New-Item -ItemType Directory -Force -Path $studentAppRes | Out-Null
Copy-Item (Join-Path $baseDir "student-electron-app\package.json") $studentAppRes -Force
Copy-Item (Join-Path $baseDir "student-electron-app\main.js") $studentAppRes -Force
Copy-Item (Join-Path $baseDir "student-electron-app\preload.js") $studentAppRes -Force
Copy-Item -Recurse -Force (Join-Path $baseDir "student-electron-app\renderer") $studentAppRes
if (Test-Path $iconPath) {
  Copy-Item $iconPath $studentAppRes -Force
  Copy-Item $iconPath (Join-Path $studentAppRes "renderer\icon.ico") -Force
  Copy-Item $iconPath $studentAppDir -Force
}

# Bake the active school's real branding and local LAN IP into the client config
$studentCfgObj = [ordered]@{
  serverUrl = "http://${primaryIp}:8000"
  supervisorExitPin = "9999"
  school = [ordered]@{
    name = $schoolName
    motto = $schoolMotto
    code = $schoolCode
    logo = $schoolLogo
    primaryColor = $primaryColor
    accentColor = $accentColor
  }
}
$studentCfgJson = $studentCfgObj | ConvertTo-Json -Depth 5
Set-Content -Path (Join-Path $studentAppRes "config.json") -Value $studentCfgJson -Encoding UTF8
Set-Content -Path (Join-Path $studentAppDir "config.json") -Value $studentCfgJson -Encoding UTF8
Set-Content -Path (Join-Path $baseDir "student-electron-app\config.json") -Value $studentCfgJson -Encoding UTF8
Write-Host "   Baked active school config with server URL: http://${primaryIp}:8000"

# Ensure Electron loads our UNPACKED resources\app (a stray/empty app.asar would break it)
$sAsar = Join-Path $studentAppDir "resources\app.asar"
if (Test-Path $sAsar) { Remove-Item -Force $sAsar }
if (-not (Test-Path (Join-Path $studentAppRes "main.js"))) { throw "Packaging error: student resources\app\main.js missing" }

# Rename electron.exe to COTHI-Student-Exam.exe
Rename-Item (Join-Path $studentAppDir "electron.exe") "COTHI-Student-Exam.exe" -Force
Set-ExeIcon (Join-Path $studentAppDir "COTHI-Student-Exam.exe")
Write-Host "Created: $studentAppDir\COTHI-Student-Exam.exe"

Write-Host "--- 2. Packaging COTHI Server App (.exe) ---"
$serverAppDir = Join-Path $baseDir "COTHI-Server-App"
if (Test-Path $serverAppDir) { Remove-Item -Recurse -Force $serverAppDir }
Copy-Item -Recurse -Force $electronBin $serverAppDir

$serverAppRes = Join-Path $serverAppDir "resources\app"
New-Item -ItemType Directory -Force -Path $serverAppRes | Out-Null
Copy-Item (Join-Path $baseDir "package.json") $serverAppRes -Force
Copy-Item (Join-Path $baseDir "main.js") $serverAppRes -Force
Copy-Item -Recurse -Force (Join-Path $baseDir "server") $serverAppRes
Copy-Item -Recurse -Force (Join-Path $baseDir "data") $serverAppRes
Copy-Item -Recurse -Force (Join-Path $baseDir "public") $serverAppRes
if (Test-Path $iconPath) {
  Copy-Item $iconPath $serverAppRes -Force
  Copy-Item $iconPath (Join-Path $serverAppRes "public\icon.ico") -Force
  Copy-Item $iconPath (Join-Path $serverAppRes "public\student\icon.ico") -Force
  Copy-Item $iconPath (Join-Path $serverAppRes "public\admin\icon.ico") -Force
  Copy-Item $iconPath $serverAppDir -Force
}

# Keep the active school branding in server data, but reset past exam submissions so clean slate for exams
$dataDst = Join-Path $serverAppRes "data"
Set-Content -Path (Join-Path $dataDst "submissions.json") -Value "[]" -Encoding UTF8
Write-Host "   Active school branding and candidate roster preserved in server package."

# Ensure Electron loads our UNPACKED resources\app (a stray/empty app.asar would break it)
$svAsar = Join-Path $serverAppDir "resources\app.asar"
if (Test-Path $svAsar) { Remove-Item -Force $svAsar }
if (-not (Test-Path (Join-Path $serverAppRes "main.js"))) { throw "Packaging error: server resources\app\main.js missing" }

# Rename electron.exe to COTHI-Server.exe
Rename-Item (Join-Path $serverAppDir "electron.exe") "COTHI-Server.exe" -Force
Set-ExeIcon (Join-Path $serverAppDir "COTHI-Server.exe")
Write-Host "Created: $serverAppDir\COTHI-Server.exe"

# 2b. Drop a zero-tool "make shortcut" helper INSIDE each folder, so a school that
#     simply copies the whole folder can double-click it to get a desktop shortcut.
$svBat = @'
@echo off
powershell -NoProfile -Command "$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut([Environment]::GetFolderPath('Desktop')+'\COTHI CBT Server.lnk'); $s.TargetPath='%~dp0COTHI-Server.exe'; $s.WorkingDirectory='%~dp0'; $s.IconLocation='%~dp0icon.ico'; $s.Save()"
echo Desktop shortcut created for COTHI CBT Server.
pause
'@
Set-Content -Path (Join-Path $serverAppDir "Create-Desktop-Shortcut.bat") -Value $svBat -Encoding ASCII

$stBat = @'
@echo off
powershell -NoProfile -Command "$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut([Environment]::GetFolderPath('Desktop')+'\COTHI Student Exam.lnk'); $s.TargetPath='%~dp0COTHI-Student-Exam.exe'; $s.WorkingDirectory='%~dp0'; $s.IconLocation='%~dp0icon.ico'; $s.Save()"
echo Desktop shortcut created for COTHI Student Exam.
pause
'@
Set-Content -Path (Join-Path $studentAppDir "Create-Desktop-Shortcut.bat") -Value $stBat -Encoding ASCII

# 3. Create Desktop Shortcuts on THIS build PC pointing directly to the .exe files
$ws = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')

$s1 = $ws.CreateShortcut("$desktop\COTHI-Server.lnk")
$s1.TargetPath = "$serverAppDir\COTHI-Server.exe"
$s1.WorkingDirectory = $serverAppDir
$s1.Description = "COTHI Offline Exam Server"
if (Test-Path $iconPath) { $s1.IconLocation = $iconPath }
$s1.Save()

$s2 = $ws.CreateShortcut("$desktop\COTHI-Student-Exam.lnk")
$s2.TargetPath = "$studentAppDir\COTHI-Student-Exam.exe"
$s2.WorkingDirectory = $studentAppDir
$s2.Description = "COTHI Student Exam Terminal"
if (Test-Path $iconPath) { $s2.IconLocation = $iconPath }
$s2.Save()

# 4. Compile Single-File Setup Wizards (.exe Installers)
$iscc = "C:\Users\WORK SPACE\AppData\Local\Programs\Inno Setup 6\ISCC.exe"
if (Test-Path $iscc) {
  Write-Host "--- 4. Building Single-File Setup Wizards (.exe) ---"
  $studentIss = Join-Path $baseDir "installer_student.iss"
  $serverIss = Join-Path $baseDir "installer_server.iss"
  if (Test-Path $studentIss) {
    Write-Host "   Compiling COTHI-Student-Setup.exe..."
    & $iscc /Qp $studentIss | Out-Null
    Write-Host "   -> Installers\COTHI-Student-Setup.exe created!"
  }
  if (Test-Path $serverIss) {
    Write-Host "   Compiling COTHI-Server-Setup.exe..."
    & $iscc /Qp $serverIss | Out-Null
    Write-Host "   -> Installers\COTHI-Server-Setup.exe created!"
  }
}

Write-Host "--- SUCCESS! Both Standalone Apps and Single-File Setup Wizards are Ready! ---"
