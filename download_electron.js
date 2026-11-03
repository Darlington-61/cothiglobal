const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DEST_DIR = path.join(__dirname, 'student-electron-app', 'electron-bin');
const ZIP_PATH = path.join(__dirname, 'electron.zip');

const URL = 'https://cdn.npmmirror.com/binaries/electron/v30.0.0/electron-v30.0.0-win32-x64.zip';

console.log(`Starting direct download from:\n${URL}`);

if (!fs.existsSync(DEST_DIR)) {
  fs.mkdirSync(DEST_DIR, { recursive: true });
}

const file = fs.createWriteStream(ZIP_PATH);

https.get(URL, (res) => {
  if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
    console.log(`Redirecting to: ${res.headers.location}`);
    return;
  }
  const total = parseInt(res.headers['content-length'] || '0', 10);
  let downloaded = 0;
  let lastPercent = 0;

  res.on('data', (chunk) => {
    downloaded += chunk.length;
    if (total > 0) {
      const percent = Math.floor((downloaded / total) * 100);
      if (percent >= lastPercent + 15) {
        lastPercent = percent;
        console.log(`Downloaded: ${percent}% (${Math.round(downloaded / 1048576)}MB / ${Math.round(total / 1048576)}MB)`);
      }
    }
  });

  res.pipe(file);

  file.on('finish', () => {
    file.close(() => {
      console.log('Download complete. Extracting using tar.exe...');
      try {
        execSync(`tar.exe -xf "${ZIP_PATH}" -C "${DEST_DIR}"`, { stdio: 'inherit' });
        console.log('Extraction complete! electron.exe is now installed.');
        fs.unlinkSync(ZIP_PATH);
        process.exit(0);
      } catch (e) {
        console.error('Tar extraction failed:', e);
        process.exit(1);
      }
    });
  });
}).on('error', (err) => {
  console.error('Download error:', err);
  process.exit(1);
});
