const { app, BrowserWindow, Menu, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// Disable hardware acceleration to ensure 100% stability on all lab machines and Windows versions
app.disableHardwareAcceleration();

const logFile = path.join(path.dirname(process.execPath), 'server_startup.log');
function log(msg) {
  try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`); } catch (e) {}
}

process.on('uncaughtException', (err) => {
  log('FATAL uncaughtException: ' + (err ? err.stack || err : ''));
});
process.on('unhandledRejection', (reason) => {
  log('FATAL unhandledRejection: ' + (reason ? reason.stack || reason : ''));
});

log('main.js loaded in COTHI-Server');

// Branded app icon (falls back gracefully if the .ico isn't beside the app)
function brandIcon() {
  const cands = [
    path.join(__dirname, 'icon.ico'),
    path.join(path.dirname(process.execPath), 'icon.ico'),
    path.join(path.dirname(process.execPath), 'resources', 'app', 'icon.ico')
  ];
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch (e) {} }
  return undefined;
}
const APP_ICON = brandIcon();

function getAppNativeIcon() {
  const icoPath = brandIcon();
  if (icoPath && fs.existsSync(icoPath)) {
    try {
      const img = nativeImage.createFromPath(icoPath);
      if (!img.isEmpty()) return img;
    } catch (e) {}
  }
  return undefined;
}

// Set unique app name & storage so it never collides with student kiosk
app.setName('COTHI CBT Server');
// Windows taskbar identity — makes the taskbar use our window icon, not Electron's default
try { app.setAppUserModelId('ng.com.cbtbycothi.server'); } catch (e) {}
try {
  app.setPath('userData', path.join(app.getPath('appData'), 'cothi-server-admin'));
} catch (e) {
  log('Error setting userData: ' + e.message);
}

// Single Instance Lock: prevents opening duplicate servers on port 8000
const gotTheLock = app.requestSingleInstanceLock();
log('requestSingleInstanceLock result: ' + gotTheLock);
if (!gotTheLock) {
  log('Did not get single instance lock, quitting.');
  app.quit();
  process.exit(0);
}

log('Before requiring ./server/server');
let startServer, PORT, getLocalIps;
try {
  const srv = require('./server/server');
  startServer = srv.startServer;
  PORT = srv.PORT;
  getLocalIps = srv.getLocalIps;
  log('Successfully required ./server/server');
} catch (reqErr) {
  log('Error requiring ./server/server: ' + reqErr.stack);
}

// Start embedded offline CBT server
try {
  if (startServer) {
    startServer();
    log('startServer called successfully');
  } else {
    log('startServer is undefined');
  }
} catch (err) {
  log('startServer error: ' + err.stack);
}

let adminWin = null;

function createAdminWindow() {
  try {
    log('createAdminWindow starting');
    const appIcon = getAppNativeIcon();
    adminWin = new BrowserWindow({
      width: 1366,
      height: 850,
      minWidth: 1024,
      minHeight: 700,
      title: 'COTHI Offline CBT - Supervisor Console',
      icon: appIcon,
      backgroundColor: '#0f172a',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });
    if (appIcon) {
      try { adminWin.setIcon(appIcon); } catch (e) {}
    }
    log('BrowserWindow instantiated');

    adminWin.on('close', () => log('adminWin close event'));
    adminWin.on('closed', () => {
      log('adminWin closed event');
      adminWin = null;
    });

    log(`Calling adminWin.loadURL(http://localhost:${PORT}/admin/)`);
    adminWin.loadURL(`http://localhost:${PORT}/admin/`);
  } catch (winErr) {
    log('createAdminWindow exception: ' + winErr.stack);
  }

  // Application Menu
  const menuTemplate = [
    {
      label: 'CBT Server',
      submenu: [
        {
          label: 'Open Student Kiosk in New Window',
          accelerator: 'CmdOrCtrl+K',
          click: () => createStudentKioskWindow()
        },
        {
          label: 'Open in Default Web Browser',
          click: () => shell.openExternal(`http://localhost:${PORT}/admin/`)
        },
        { type: 'separator' },
        { label: 'Quit', role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
}

function createStudentKioskWindow() {
  const studentWin = new BrowserWindow({
    width: 1280,
    height: 800,
    fullscreen: true,
    kiosk: true,
    alwaysOnTop: true,
    title: 'COTHI Examination Terminal',
    icon: APP_ICON,
    backgroundColor: '#f8fafc',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  studentWin.loadURL(`http://localhost:${PORT}/student/`);
}

app.on('second-instance', () => {
  if (adminWin) {
    if (adminWin.isMinimized()) adminWin.restore();
    adminWin.focus();
  }
});

app.whenReady().then(() => {
  log('app.whenReady resolved, creating admin window');
  createAdminWindow();

  if (adminWin) {
    adminWin.webContents.on('did-fail-load', (e, code, desc) => {
      log(`adminWin failed to load: ${code} - ${desc}`);
    });
    adminWin.webContents.on('did-finish-load', () => {
      log('adminWin finished loading URL');
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createAdminWindow();
    }
  });
});

app.on('window-all-closed', () => {
  log('window-all-closed event triggered');
  if (process.platform !== 'darwin') {
    log('Calling app.quit() from window-all-closed');
    app.quit();
  }
});
