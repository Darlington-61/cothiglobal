$ws = New-Object -ComObject WScript.Shell

# Shortcut 1: Server (Native Electron)
$s1 = $ws.CreateShortcut("$([Environment]::GetFolderPath('Desktop'))\COTHI CBT Server (Admin).lnk")
$s1.TargetPath = "C:\Users\WORK SPACE\Downloads\CBT\student-electron-app\electron-bin\electron.exe"
$s1.Arguments = "main.js"
$s1.WorkingDirectory = "C:\Users\WORK SPACE\Downloads\CBT"
$s1.Description = "COTHI Offline CBT Server and Native Electron Admin Console"
$s1.IconLocation = "C:\Users\WORK SPACE\Downloads\CBT\icon.ico"
$s1.Save()

# Shortcut 2: Student Kiosk (Native Electron)
$s2 = $ws.CreateShortcut("$([Environment]::GetFolderPath('Desktop'))\COTHI Student Exam Terminal.lnk")
$s2.TargetPath = "C:\Users\WORK SPACE\Downloads\CBT\student-electron-app\electron-bin\electron.exe"
$s2.Arguments = "."
$s2.WorkingDirectory = "C:\Users\WORK SPACE\Downloads\CBT\student-electron-app"
$s2.Description = "COTHI Student Native Electron Examination App"
$s2.IconLocation = "C:\Users\WORK SPACE\Downloads\CBT\student-electron-app\icon.ico"
$s2.Save()

Write-Host "Both Desktop shortcuts updated to native Electron applications!"
