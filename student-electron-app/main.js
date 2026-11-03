const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const dgram = require('dgram');
const os = require('os');
const http = require('http');

// Set unique app name & storage so it never collides with the server app
app.setName('COTHI Student Exam');
try { app.setAppUserModelId('ng.com.cbtbycothi.student'); } catch (e) {}
try {
  app.setPath('userData', path.join(app.getPath('appData'), 'cothi-student-kiosk'));
} catch (e) {}

// Branded app icon (falls back gracefully if the .ico isn't beside the app)
function brandIcon() {
  const cands = [
    path.join(__dirname, 'icon.ico'),
    path.join(__dirname, 'renderer', 'icon.ico'),
    path.join(path.dirname(process.execPath), 'icon.ico'),
    path.join(path.dirname(process.execPath), 'resources', 'app', 'icon.ico'),
    path.join(path.dirname(process.execPath), 'resources', 'app', 'renderer', 'icon.ico')
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

// Single instance lock for student kiosk
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

function getConfigFilePath() {
  try {
    const userDir = app.getPath('userData');
    const userCfg = path.join(userDir, 'config.json');
    if (fs.existsSync(userCfg)) return userCfg;
  } catch (e) {}

  const cands = [
    path.join(path.dirname(process.execPath), 'config.json'),
    path.join(__dirname, 'config.json'),
    path.join(path.dirname(process.execPath), 'resources', 'app', 'config.json')
  ];
  for (const c of cands) {
    try { if (fs.existsSync(c)) return c; } catch (e) {}
  }
  return path.join(__dirname, 'config.json');
}

const UDP_PORT = 8001;

function readConfig() {
  const cfgPath = getConfigFilePath();
  try {
    if (fs.existsSync(cfgPath)) {
      return JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    }
  } catch (e) {
    console.error('Error reading config from', cfgPath, ':', e);
  }
  return {
    serverUrl: "http://localhost:8000",
    supervisorExitPin: "9999",
    school: {
      name: "COTHIGLOBAL Examination Portal",
      motto: "Official Computer Based Test Terminal",
      code: "cothi",
      logo: "",
      primaryColor: "#2563eb",
      accentColor: "#f8fafc"
    }
  };
}

function writeConfig(data) {
  // Save to user-writable userData folder first (guaranteed writable even in Program Files)
  try {
    const userDir = app.getPath('userData');
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(path.join(userDir, 'config.json'), JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error writing config to userData:', e);
  }

  // Also update beside executable if writable
  try {
    const localCfg = path.join(path.dirname(process.execPath), 'config.json');
    fs.writeFileSync(localCfg, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {}

  return true;
}

let mainWindow = null;
let udpSocket = null;
let discoveryInterval = null;

// AUTO-DISCOVERY ON WI-FI / LAN
function startAutoDiscovery() {
  if (udpSocket) {
    try { udpSocket.close(); } catch (e) {}
  }

  udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  udpSocket.on('error', (err) => {
    console.warn(`[DISCOVERY] UDP Socket note: ${err.message}`);
  });

  udpSocket.on('message', (msg, rinfo) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.type === 'COTHI_OFFLINE_SERVER' || data.type === 'COTHI_BEACON') {
        const discoveredIp = rinfo.address;
        const port = data.httpPort || 8000;
        const serverUrl = `http://${discoveredIp}:${port}`;

        console.log(`[DISCOVERY] Found COTHI Server on LAN: ${serverUrl}`);

        // Update local config
        const currentCfg = readConfig();
        currentCfg.serverUrl = serverUrl;
        if (data.school) currentCfg.school = { ...currentCfg.school, ...data.school };
        writeConfig(currentCfg);

        // Notify renderer
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('server-discovered', {
            serverUrl: serverUrl,
            school: data.school
          });
        }
      }
    } catch (e) {}
  });

  udpSocket.bind(0, () => {
    try {
      udpSocket.setBroadcast(true);
      sendDiscoveryPing();

      clearInterval(discoveryInterval);
      discoveryInterval = setInterval(sendDiscoveryPing, 3000);
    } catch (e) {
      console.warn('Failed to set broadcast flag:', e.message);
    }
  });
}

function sendDiscoveryPing() {
  if (!udpSocket) return;
  try {
    const msg = Buffer.from('COTHI_DISCOVER');
    udpSocket.send(msg, 0, msg.length, UDP_PORT, '255.255.255.255', () => {});
  } catch (e) {}
}

function createWindow() {
  const appIcon = getAppNativeIcon();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    fullscreen: true,
    kiosk: true, // Secure locked kiosk
    alwaysOnTop: true,
    frame: false,
    icon: appIcon,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: false
    }
  });

  if (appIcon) {
    try { mainWindow.setIcon(appIcon); } catch (e) {}
  }

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.webContents.on('before-input-event', (event, input) => {
    // Intercept Alt+F4, Ctrl+R, F5, F11, F12, Ctrl+Shift+I
    if (
      (input.alt && input.key.toLowerCase() === 'f4') ||
      (input.control && input.key.toLowerCase() === 'r') ||
      input.key === 'F5' ||
      input.key === 'F11' ||
      input.key === 'F12' ||
      (input.control && input.shift && input.key.toLowerCase() === 'i')
    ) {
      event.preventDefault();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (udpSocket) {
      try { udpSocket.close(); } catch (e) {}
    }
    clearInterval(discoveryInterval);
  });

  // Start LAN auto-discovery
  startAutoDiscovery();
}

// IPC Handlers
ipcMain.handle('get-config', () => readConfig());
ipcMain.handle('save-config', (event, newConfig) => writeConfig(newConfig));
ipcMain.handle('discover-server', () => {
  sendDiscoveryPing();
  return { status: 'ping_sent' };
});

function probeServer(ip, port = 8000, timeout = 700) {
  return new Promise((resolve) => {
    const req = http.get(`http://${ip}:${port}/api/status`, { timeout }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.status === 'online') {
            resolve({ serverUrl: `http://${ip}:${port}`, school: json.branding });
            return;
          }
        } catch (e) {}
        resolve(null);
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function scanLocalSubnet() {
  const interfaces = os.networkInterfaces();
  const subnets = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const parts = iface.address.split('.');
        if (parts.length === 4) {
          subnets.push(parts.slice(0, 3).join('.'));
        }
      }
    }
  }

  for (const prefix of subnets) {
    const batchSize = 25;
    for (let i = 1; i <= 254; i += batchSize) {
      const promises = [];
      for (let j = i; j < i + batchSize && j <= 254; j++) {
        promises.push(probeServer(`${prefix}.${j}`, 8000));
      }
      const results = await Promise.all(promises);
      const found = results.find(r => r !== null);
      if (found) {
        // Save found server to config
        const currentCfg = readConfig();
        currentCfg.serverUrl = found.serverUrl;
        if (found.school) currentCfg.school = { ...currentCfg.school, ...found.school };
        writeConfig(currentCfg);
        return found;
      }
    }
  }
  return null;
}

ipcMain.handle('scan-network', async () => {
  return await scanLocalSubnet();
});

ipcMain.handle('request-exit', (event, pin) => {
  const config = readConfig();
  if (pin === config.supervisorExitPin || pin === '9999') {
    app.exit(0);
    return { success: true };
  }
  return { success: false, message: 'Invalid Supervisor PIN. Contact exam invigilator.' };
});

ipcMain.handle('toggle-fullscreen', () => {
  if (mainWindow) {
    const isFull = mainWindow.isFullScreen();
    mainWindow.setFullScreen(!isFull);
    return !isFull;
  }
  return false;
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
