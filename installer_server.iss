; Inno Setup Script for COTHI Offline Exam Server (Backward-Compatible with Existing Schools)
#define MyAppName "COTHI CBT Server"
#define MyAppVersion "2.0"
#define MyAppPublisher "COTHI Global Systems"
#define MyAppURL "https://cbtbycothi.com.ng"
#define MyAppExeName "COTHI-Server.exe"
#define SourceDir "C:\Users\WORK SPACE\Downloads\CBT\COTHI-Server-App"

[Setup]
AppId={{E68A91F2-7B53-4E89-879C-C9D6573E3D42}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\COTHI CBT Server
DefaultGroupName=COTHI CBT
DisableProgramGroupPage=yes
OutputDir=C:\Users\WORK SPACE\Downloads\CBT\Installers
OutputBaseFilename=COTHI-Server-Setup
SetupIconFile=C:\Users\WORK SPACE\Downloads\CBT\icon.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
CloseApplications=yes
CloseApplicationsFilter=COTHI-Server.exe

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
; 1. Core Server Code, Binaries, and Public Web UI (Always updated to latest)
; Excludes data directory so former schools' rosters, exams, PINs, and submissions are NEVER overwritten!
Source: "{#SourceDir}\*"; DestDir: "{app}"; Excludes: "resources\app\data\*"; Flags: ignoreversion recursesubdirs createallsubdirs

; 2. Default Seed Data (Only installed on brand new PCs; preserves existing school data on updates)
Source: "{#SourceDir}\resources\app\data\*"; DestDir: "{app}\resources\app\data"; Flags: onlyifdoesntexist recursesubdirs createallsubdirs uninsneveruninstall

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\icon.ico"; AppUserModelID: "ng.com.cbtbycothi.server"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\icon.ico"; AppUserModelID: "ng.com.cbtbycothi.server"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[Code]
// Pre-Install Database Snapshot: Guarantees 100% preservation of former schools' databases
procedure CurStepChanged(CurStep: TSetupStep);
var
  DataDir, BackupDir: String;
  ResultCode: Integer;
begin
  if CurStep = ssInstall then
  begin
    DataDir := ExpandConstant('{app}\resources\app\data');
    if DirExists(DataDir) then
    begin
      BackupDir := ExpandConstant('{app}\data_backups\backup_' + GetDateTimeString('yyyymmdd_hhnnss', #0, #0));
      Exec('cmd.exe', '/c xcopy /E /I /Y "' + DataDir + '" "' + BackupDir + '\"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    end;
  end;
end;
