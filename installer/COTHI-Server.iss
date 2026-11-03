; COTHI CBT Server — one-click installer (Inno Setup)
; Build:  run build_installers.ps1  (or open this file in Inno Setup and press F9)
; Produces: installer\dist\COTHI-Server-Setup.exe  (single file to copy to a school)
;
; Installs per-user into a WRITABLE folder (LocalAppData) so the server can save
; submissions, settings and synced questions without admin rights.

#define AppName "COTHI CBT Server"
#define AppVersion "1.0.0"
#define AppPublisher "COTHI CBT Systems"
#define AppExe "COTHI-Server.exe"

[Setup]
AppId={{A1C0THI-5EADER-4CBT-9SRV-0000SERVER01}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
; Per-user install into a writable location (no admin needed, data stays writable)
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Programs\COTHI-CBT-Server
DisableProgramGroupPage=yes
DefaultGroupName=COTHI CBT
OutputDir=dist
OutputBaseFilename=COTHI-Server-Setup
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
; The whole packaged server app folder (built by package_apps.ps1)
Source: "..\COTHI-Server-App\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\COTHI CBT Server"; Filename: "{app}\{#AppExe}"; IconFilename: "{app}\icon.ico"
Name: "{group}\Uninstall COTHI CBT Server"; Filename: "{uninstallexe}"
Name: "{autodesktop}\COTHI CBT Server"; Filename: "{app}\{#AppExe}"; IconFilename: "{app}\icon.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "Launch COTHI CBT Server now"; Flags: nowait postinstall skipifsilent
