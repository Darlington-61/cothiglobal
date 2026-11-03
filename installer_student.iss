; Inno Setup Script for COTHI Student Exam Terminal
#define MyAppName "COTHI Student Exam"
#define MyAppVersion "2.0"
#define MyAppPublisher "COTHI Global Systems"
#define MyAppURL "https://cbtbycothi.com.ng"
#define MyAppExeName "COTHI-Student-Exam.exe"
#define SourceDir "C:\Users\WORK SPACE\Downloads\CBT\COTHI-Student-App"

[Setup]
AppId={{D37E84B1-6A42-4D39-968B-B8F5462D2C31}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\COTHI Student Exam
DefaultGroupName=COTHI CBT
DisableProgramGroupPage=yes
OutputDir=C:\Users\WORK SPACE\Downloads\CBT\Installers
OutputBaseFilename=COTHI-Student-Setup
SetupIconFile=C:\Users\WORK SPACE\Downloads\CBT\icon.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\icon.ico"; AppUserModelID: "ng.com.cbtbycothi.student"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\icon.ico"; AppUserModelID: "ng.com.cbtbycothi.student"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
