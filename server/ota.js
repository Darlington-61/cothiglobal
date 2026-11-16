const { exec } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const cothiCloud = require('./cothi-cloud');

const crypto = require('crypto');

const GITHUB_REPO = 'Darlington-61/cothiglobal';
const GITHUB_BRANCH = 'cbt-offline-terminal';
const ROOT_DIR = path.resolve(__dirname, '..');
const OTA_VERSION_FILE = path.join(ROOT_DIR, 'data', 'ota_version.json');
const CURRENT_CODE_VERSION = '1.0.2';

function fetchCothiJson(urlPath, timeoutMs = 15000) {
  function tryHost(host, servername) {
    return new Promise((resolve, reject) => {
      const opts = {
        hostname: host,
        port: 443,
        path: urlPath,
        method: 'GET',
        headers: {
          'Host': 'cbtbycothi.com.ng',
          'Accept': 'application/json',
          'User-Agent': 'curl/8.4.0'
        },
        timeout: timeoutMs
      };
      if (servername) opts.servername = servername;
      const req = https.request(opts, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} from ${host}${urlPath}`));
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (e) {
            reject(new Error(`Invalid JSON from ${host}${urlPath}`));
          }
        });
      });
      req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout fetching ${host}${urlPath}`)); });
      req.on('error', reject);
      req.end();
    });
  }
  return tryHost('cbtbycothi.com.ng').catch(() => tryHost('66.235.174.177', 'cbtbycothi.com.ng'));
}

function getLocalOtaVersion() {
  try {
    if (fs.existsSync(OTA_VERSION_FILE)) {
      return JSON.parse(fs.readFileSync(OTA_VERSION_FILE, 'utf8'));
    }
  } catch (_) {}
  return { version: CURRENT_CODE_VERSION, commit: '' };
}

function saveLocalOtaVersion(meta) {
  try {
    const dir = path.dirname(OTA_VERSION_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(OTA_VERSION_FILE, JSON.stringify(meta, null, 2));
  } catch (_) {}
}

/**
 * Checks internet connectivity by pinging GitHub or COTHI Cloud
 */
function testInternetConnectivity(timeoutMs = 6000) {
  return new Promise((resolve) => {
    const req = https.get('https://raw.githubusercontent.com', {
      headers: { 'User-Agent': 'COTHI-CBT-OTA' },
      timeout: timeoutMs
    }, (res) => {
      resolve(true);
    });
    req.on('error', () => {
      // Test fallback to cbtbycothi.com.ng
      const req2 = https.get('https://cbtbycothi.com.ng', {
        headers: { 'User-Agent': 'COTHI-CBT-OTA' },
        timeout: timeoutMs
      }, () => resolve(true));
      req2.on('error', () => resolve(false));
      req2.on('timeout', () => { req2.destroy(); resolve(false); });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Runs a command asynchronously with a timeout
 */
function runCmd(command, cwd = ROOT_DIR, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    exec(command, { cwd, timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        return reject({ error, stderr: (stderr || '').trim(), stdout: (stdout || '').trim() });
      }
      resolve((stdout || '').trim());
    });
  });
}

/**
 * Checks whether an OTA update is available
 */
async function checkForUpdates() {
  const isOnline = await testInternetConnectivity();
  if (!isOnline) {
    return {
      online: false,
      updateAvailable: false,
      message: 'No internet connection detected. Please connect to Wi-Fi or phone hotspot to check for updates.'
    };
  }

  // 1. Try Git-based update check
  let gitAvailable = false;
  let localCommit = null;
  let remoteCommit = null;
  let commitMessage = '';

  try {
    await runCmd('git --version');
    gitAvailable = true;
  } catch (e) {
    gitAvailable = false;
  }

  if (gitAvailable) {
    try {
      localCommit = await runCmd('git rev-parse --short HEAD');
      // Fetch latest references silently
      await runCmd(`git fetch origin ${GITHUB_BRANCH}`);
      remoteCommit = await runCmd(`git rev-parse --short origin/${GITHUB_BRANCH}`);
      
      if (localCommit !== remoteCommit) {
        try {
          commitMessage = await runCmd(`git log -1 --pretty=format:"%s" origin/${GITHUB_BRANCH}`);
        } catch (_) {}
        return {
          online: true,
          gitAvailable: true,
          updateAvailable: true,
          currentVersion: localCommit,
          latestVersion: remoteCommit,
          commitMessage: commitMessage || 'Latest bug fixes & improvements',
          message: `Update available (${localCommit} → ${remoteCommit}): ${commitMessage || 'New improvements'}`
        };
      } else {
        return {
          online: true,
          gitAvailable: true,
          updateAvailable: false,
          currentVersion: localCommit,
          latestVersion: remoteCommit,
          message: `System is up to date (Commit ${localCommit}).`
        };
      }
    } catch (gitErr) {
      // Git command failed (e.g. not a git clone directory), fallback to HTTP check
    }
  }

  // 2. Check COTHI Cloud OTA manifest (works without Git on all installed PCs)
  try {
    const manifest = await fetchCothiJson('/ota/version.json', 8000);
    if (manifest && manifest.version) {
      const localMeta = getLocalOtaVersion();
      const hasUpdate = (manifest.version !== localMeta.version) || (manifest.commit && manifest.commit !== localMeta.commit);
      return {
        online: true,
        gitAvailable: false,
        cothiOta: true,
        updateAvailable: hasUpdate,
        currentVersion: localMeta.version || CURRENT_CODE_VERSION,
        latestVersion: manifest.version,
        commitMessage: manifest.notes || `COTHI Cloud Update v${manifest.version}`,
        message: hasUpdate
          ? `COTHI Cloud update available (v${manifest.version}): ${manifest.notes || 'Latest fixes & improvements'}`
          : `System is up to date (COTHI v${localMeta.version}).`
      };
    }
  } catch (cothiOtaErr) {
    // Fallback to GitHub Public Commit API if COTHI OTA manifest is unreachable
  }

  // 3. HTTP Fallback check via GitHub Public Commit API
  try {
    const commitData = await new Promise((resolve, reject) => {
      const opts = {
        hostname: 'api.github.com',
        path: `/repos/${GITHUB_REPO}/commits/${GITHUB_BRANCH}`,
        headers: {
          'User-Agent': 'COTHI-CBT-OTA',
          'Accept': 'application/vnd.github.v3+json'
        },
        timeout: 8000
      };
      const req = https.get(opts, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });

    if (commitData && commitData.sha) {
      const remoteSha = commitData.sha.substring(0, 7);
      const commitMsg = commitData.commit && commitData.commit.message ? commitData.commit.message.split('\n')[0] : '';
      return {
        online: true,
        gitAvailable: false,
        updateAvailable: true,
        latestVersion: remoteSha,
        commitMessage: commitMsg,
        message: `Cloud update available: ${commitMsg} (${remoteSha})`
      };
    }
  } catch (httpErr) {
    // If GitHub API rate limits or fails, check COTHI Cloud
  }

  return {
    online: true,
    gitAvailable,
    updateAvailable: false,
    message: 'System is connected. You can click "Sync All Cloud Data & Code" to force refresh questions and files.'
  };
}

/**
 * Applies OTA Update and refreshes question banks + custom schools
 */
async function applyUpdate() {
  const statusLog = [];
  const addLog = (msg) => {
    const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
    statusLog.push(entry);
    console.log(`[OTA] ${msg}`);
  };

  addLog('Starting Over-The-Air (OTA) System Update...');
  let preUpdateBackupDir = null;

  const isOnline = await testInternetConnectivity();
  if (!isOnline) {
    addLog('FAILED: No internet detected. Please enable Wi-Fi or phone hotspot.');
    return { success: false, log: statusLog, error: 'No internet connection' };
  }
  addLog('Internet connectivity verified.');

  // Step 1: Backup current custom data before update
  try {
    const backupDir = path.join(ROOT_DIR, 'data', 'backups', `pre-ota-${Date.now()}`);
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    
    // Back up EVERY data file (not just four), so it can be restored after the pull.
    const dataDir = path.join(ROOT_DIR, 'data');
    for (const file of (fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : [])) {
      const src = path.join(dataDir, file);
      if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(backupDir, file));
    }
    preUpdateBackupDir = backupDir;
    addLog(`Local student submissions and school directory safely backed up to ${path.basename(backupDir)}.`);
  } catch (backupErr) {
    addLog(`Warning: Backup creation notice: ${backupErr.message}`);
  }

  // Step 2: Code update via Git or Cloud
  let gitSuccess = false;
  let cloudOk = true;
  try {
    await runCmd('git --version');
    addLog('Executing Git pull from repository...');
    // Set local changes aside, pull, then put them back. (Previously the stash was
    // never restored, so exam data tracked in git appeared to vanish after an update.)
    let stashed = false;
    try {
      const before = await runCmd('git stash list');
      await runCmd('git stash push -m cothi-ota-autostash');
      const after = await runCmd('git stash list');
      stashed = after !== before;
    } catch (_) {}
    try {
      const pullOut = await runCmd(`git pull --no-edit origin ${GITHUB_BRANCH}`);
      addLog(`Git update output: ${pullOut}`);
      gitSuccess = true;
    } finally {
      if (stashed) {
        try { await runCmd('git stash pop'); addLog('Local changes restored after update.'); }
        catch (popErr) { addLog('WARNING: could not re-apply local changes automatically. They are kept in "git stash" (cothi-ota-autostash); a backup was also made in data/backups.'); }
      }
    }
  } catch (err) {
    addLog(`Git pull skipped or unavailable: ${err.stderr || err.message || 'Not a git working copy'}`);
  }

  // Step 2c: If Git didn't update (e.g. non-Git installed Setup.exe), pull code bundle directly from COTHI Cloud
  let cothiBundleApplied = false;
  if (!gitSuccess) {
    try {
      addLog('Downloading code update bundle from COTHI Cloud (cbtbycothi.com.ng/ota)...');
      const bundle = await fetchCothiJson('/ota/ota-bundle.json', 30000);
      if (bundle && bundle.version && Array.isArray(bundle.files)) {
        let updatedCount = 0;
        for (const entry of bundle.files) {
          const rel = String(entry.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
          if (!rel || rel.includes('..') || !(rel.startsWith('server/') || rel.startsWith('public/'))) continue;
          const buf = Buffer.from(entry.contentBase64 || '', 'base64');
          const hash = crypto.createHash('sha256').update(buf).digest('hex');
          if (entry.sha256 && hash !== entry.sha256) {
            throw new Error(`Checksum mismatch for ${rel}`);
          }
          const dest = path.join(ROOT_DIR, rel);
          const dir = path.dirname(dest);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const tmp = dest + '.ota.tmp';
          fs.writeFileSync(tmp, buf);
          fs.renameSync(tmp, dest);
          updatedCount++;
        }
        saveLocalOtaVersion({ version: bundle.version, commit: bundle.commit || '', updatedAt: new Date().toISOString() });
        cothiBundleApplied = true;
        addLog(`Applied COTHI Cloud code bundle v${bundle.version} (${updatedCount} files updated).`);
      }
    } catch (bundleErr) {
      addLog(`COTHI Cloud code bundle notice: ${bundleErr.message}`);
    }
  }

  // Step 2b: data/ is no longer tracked in git. On a PC whose copy still tracked it,
  // the pull removes those files — put back anything that went missing.
  if (preUpdateBackupDir) {
    try {
      const dataDir = path.join(ROOT_DIR, 'data');
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      let restored = 0;
      for (const file of fs.readdirSync(preUpdateBackupDir)) {
        const dst = path.join(dataDir, file);
        if (!fs.existsSync(dst)) { fs.copyFileSync(path.join(preUpdateBackupDir, file), dst); restored++; }
      }
      if (restored) addLog(`Restored ${restored} data file(s) from the pre-update backup.`);
    } catch (rErr) { addLog(`WARNING: data restore check failed: ${rErr.message}`); }
  }

  // Step 3: Refresh COTHI Cloud Question Banks and Schools
  try {
    addLog('Syncing latest exam questions and school directories from COTHI Cloud...');
    const refresh = await db.refreshCothiSchools();
    if (!refresh.live) {
      cloudOk = false;
      addLog(`Cloud download FAILED: ${refresh.error || 'unknown error'}. Using last saved copy.`);
    } else {
      addLog(`COTHI Central directory refreshed: ${refresh.count} schools downloaded.`);
      const currentCode = (db.getSettings().schoolCode || '').trim();
      if (currentCode && currentCode !== 'cothi') {
        const schoolResult = await db.syncSchoolFromCothi(currentCode, { live: false });
        addLog(`School [${currentCode}] exam bank updated: ${schoolResult.examsCount} exams now available.`);
      }
    }
  } catch (cloudErr) {
    cloudOk = false;
    addLog(`Cloud questions sync FAILED: ${cloudErr.message}`);
  }

  // Step 4: Push any offline created schools or pending submissions to cloud
  try {
    addLog('Pushing any local submissions or offline registered schools to COTHI Cloud...');
    const st = db.getSettings();
    const subs = db.getSubmissions();
    const push = subs.length ? await cothiCloud.pushResultsToCloud(st.schoolCode, subs) : { success: true };
    if (!push.success) cloudOk = false;
    addLog(subs.length ? (push.success ? `Uploaded ${subs.length} result(s).` : `Result upload FAILED (${push.error || 'HTTP ' + push.statusCode}).`) : 'No results to upload.');
  } catch (syncErr) {
    cloudOk = false;
    addLog(`Upload sync FAILED: ${syncErr.message}`);
  }

  // Step 5: Keep distribution app synced if running in dev folder
  try {
    const distServerDir = path.join(ROOT_DIR, 'COTHI-Server-App', 'resources', 'app');
    if (fs.existsSync(distServerDir)) {
      // Sync public and server
      const copyDirRecursive = (src, dest) => {
        if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
        const items = fs.readdirSync(src);
        for (const item of items) {
          const s = path.join(src, item);
          const d = path.join(dest, item);
          if (fs.statSync(s).isDirectory()) {
            copyDirRecursive(s, d);
          } else {
            fs.copyFileSync(s, d);
          }
        }
      };
      copyDirRecursive(path.join(ROOT_DIR, 'server'), path.join(distServerDir, 'server'));
      copyDirRecursive(path.join(ROOT_DIR, 'public'), path.join(distServerDir, 'public'));
      addLog('Installed COTHI-Server-App distribution synchronized with latest code.');
    }
  } catch (_) {}

  const allOk = cloudOk;
  addLog(allOk ? '✅ Update and cloud sync completed.' : '⚠️ Update finished with problems — see the lines marked FAILED above.');

  return {
    success: allOk,
    gitUpdated: gitSuccess,
    cothiUpdated: cothiBundleApplied,
    log: statusLog,
    message: allOk ? 'System updated. Questions, schools and code are in sync.' : 'Update finished, but some steps failed. Check the log.'
  };
}

let autoOtaRunning = false;
let lastCheckedOtaVersion = null;

/**
 * Automatically checks COTHI Cloud OTA when the server connects to the internet
 * and applies updates immediately if a newer version is available (when no live exam is active).
 */
async function autoUpdateOnConnect() {
  if (autoOtaRunning) return;
  autoOtaRunning = true;
  try {
    const isOnline = await testInternetConnectivity(5000);
    if (!isOnline) return;

    // Never auto-update code while candidates are actively writing an exam
    const live = db.getLiveSessions ? db.getLiveSessions() : [];
    const activeCount = Array.isArray(live) ? live.filter(s => s.status === 'ACTIVE').length : 0;
    if (activeCount > 0) return;

    const manifest = await fetchCothiJson('/ota/version.json', 8000);
    if (!manifest || !manifest.version) return;
    if (lastCheckedOtaVersion === manifest.version) return;

    const localMeta = getLocalOtaVersion();
    const hasUpdate = (manifest.version !== localMeta.version) || (manifest.commit && manifest.commit !== localMeta.commit);
    if (!hasUpdate) {
      lastCheckedOtaVersion = manifest.version;
      return;
    }

    console.log(`[AUTO-OTA] Internet connected! New COTHI update detected (${localMeta.version} -> ${manifest.version}). Applying automatically...`);
    const result = await applyUpdate();
    if (result && (result.cothiUpdated || result.gitUpdated)) {
      lastCheckedOtaVersion = manifest.version;
      console.log(`[AUTO-OTA] Successfully updated to v${manifest.version}.`);
    }
  } catch (e) {
    // Silent on offline / transient errors
  } finally {
    autoOtaRunning = false;
  }
}

module.exports = {
  testInternetConnectivity,
  checkForUpdates,
  applyUpdate,
  autoUpdateOnConnect
};
