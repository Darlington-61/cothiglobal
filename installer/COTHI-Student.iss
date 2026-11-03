; COTHI Student Exam Terminal — one-click installer (Inno Setup)
; Build:  run build_installers.ps1  (or open this file in Inno Setup and press F9)
; Produces: installer\dist\COTHI-Student-Setup.exe  (single file to copy to student PCs)
;
; Installs per-user into a WRITABLE folder so the kiosk can update its config.json
; (auto-discovered server IP) without admin rights.

#define AppName "COTHI Student Exam"
#define AppVersion "1.0.0"
#define AppPublisher "COTHI CBT Systems"
#define AppExe "COTHI-Student-Exam.exe"

[Setup]
AppId={{A1C0THI-5EADER-4CBT-9STU-0000STUDENT1}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Programs\COTHI-Student-Exam
DisableProgramGroupPage=yes
DefaultGroupName=COTHI CBT
OutputDir=dist
OutputBaseFilename=COTHI-Student-Setup
SetupIconFile=..\icon.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"

[Files]
Source: "..\COTHI-Student-App\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\COTHI Student Exam"; Filename: "{app}\{#AppExe}"; IconFilename: "{app}\icon.ico"
Name: "{group}\Uninstall COTHI Student Exam"; Filename: "{uninstallexe}"
Name: "{autodesktop}\COTHI Student Exam"; Filename: "{app}\{#AppExe}"; IconFilename: "{app}\icon.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "Launch COTHI Student Exam now"; Flags: nowait postinstall skipifsilent
