const https = require('https');
const fs = require('fs');
const path = require('path');

function getCacheFilePath() {
  let dataDir = path.join(__dirname, '..', 'data');
  if (dataDir.includes('app.asar')) {
    dataDir = path.join(path.dirname(process.execPath), 'data');
  }
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return path.join(dataDir, 'cothi_cache.json');
}

function normalizeQuestions(questions) {
  if (!Array.isArray(questions)) return [];
  return questions.map((q, idx) => {
    let optionsObj = {};
    let correct = 'A';

    if (Array.isArray(q.options)) {
      q.options.forEach((opt, oIdx) => {
        const letter = (opt.id || String.fromCharCode(65 + oIdx)).toUpperCase();
        optionsObj[letter] = opt.text || opt.title || '';
        if (opt.isCorrect || opt.correct) {
          correct = letter;
        }
      });
    } else if (typeof q.options === 'object' && q.options !== null) {
      optionsObj = q.options;
      correct = (q.correctAnswer || q.correct || 'A').toUpperCase();
    } else {
      optionsObj = {
        A: q.optionA || q.a || 'Option A',
        B: q.optionB || q.b || 'Option B',
        C: q.optionC || q.c || 'Option C',
        D: q.optionD || q.d || 'Option D'
      };
      correct = (q.correctAnswer || q.correct || 'A').toUpperCase();
    }

    return {
      id: q.id || (idx + 1),
      question: q.text || q.question || `Question ${idx + 1}`,
      options: optionsObj,
      correctAnswer: correct,
      marks: q.marks || 2.5
    };
  });
}

function getAuthToken() {
  try {
    const dataDir = path.dirname(getCacheFilePath());
    const sFile = path.join(dataDir, 'settings.json');
    if (fs.existsSync(sFile)) {
      const st = JSON.parse(fs.readFileSync(sFile, 'utf-8'));
      if (st.cothiApiKey && st.cothiApiKey.trim()) {
        return st.cothiApiKey.trim();
      }
    }
  } catch(e) {}
  return 'mock-access-token';
}

// The cloud currently accepts a shared "mock-access-token". Until cbtbycothi.com.ng
// stops accepting it, the fallback stays ON by default so downloads keep working;
// set "allowLegacyCloudToken": false in data/settings.json to switch it off.
function legacyTokenAllowed() {
  try {
    const sFile = path.join(path.dirname(getCacheFilePath()), 'settings.json');
    if (fs.existsSync(sFile)) {
      const st = JSON.parse(fs.readFileSync(sFile, 'utf-8'));
      if (st.allowLegacyCloudToken === false) return false;
    }
  } catch (e) {}
  return true;
}

// Keep names/reg numbers from the cloud free of HTML so they can't inject markup.
function cleanText(v) { return String(v == null ? '' : v).replace(/[<>"`]/g, '').trim(); }

function fetchFromEndpoint(host, servername, authToken) {
  return new Promise((resolve, reject) => {
    const token = authToken || getAuthToken();
    const options = {
      hostname: host,
      port: 443,
      path: '/api/v1/sync',
      method: 'GET',
      headers: {
        'Host': 'cbtbycothi.com.ng',
        'Authorization': `Bearer ${token}`,
        'Accept': '*/*',
        'User-Agent': 'curl/8.4.0'
      },
      timeout: 30000
    };
    if (servername) {
      options.servername = servername;
    }

    const req = https.request(options, (res) => {
      // If server rejects custom token with 401 or 403, retry with universal mock-access-token
      if ((res.statusCode === 401 || res.statusCode === 403) && token !== 'mock-access-token' && legacyTokenAllowed()) {
        console.log(`[COTHI CLOUD] Token rejected (HTTP ${res.statusCode}). Retrying with universal sync token...`);
        fetchFromEndpoint(host, servername, 'mock-access-token').then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`COTHI central cloud returned HTTP ${res.statusCode}`));
        return;
      }
      let chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          resolve(parsed);
        } catch (e) {
          reject(new Error('Invalid response received from COTHI central cloud.'));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Connection to ${host} timed out.`));
    });

    req.on('error', (err) => {
      reject(new Error(`Unable to connect to ${host}: ${err.message}`));
    });

    req.end();
  });
}

async function fetchRawCloudData() {
  // 1. Try standard hostname
  let firstErr = null;
  try {
    return await fetchFromEndpoint('cbtbycothi.com.ng');
  } catch (err) {
    firstErr = err;
    console.warn(`[COTHI CLOUD] Hostname fetch failed (${err.message}). Trying direct IP fallback (66.235.174.177)...`);
  }

  // 2. Direct IP fallback with SNI (bypasses DNS issues on local hotspot/school networks)
  try {
    return await fetchFromEndpoint('66.235.174.177', 'cbtbycothi.com.ng');
  } catch (err2) {
    throw new Error(`${firstErr ? firstErr.message : ''} / IP fallback: ${err2.message}`);
  }
}

// Only obvious throw-away test codes are skipped. ("kingskid" and "anchor" used to be
// listed here, which is why Kings Kids / Anchor could never be downloaded.)
const IGNORED_TEST_CODES = new Set(['f', 'dd', 'w', 'h', 'kk', 'central', 'cothi']);

// Explicit code aliases (old code on the cloud -> code used on the terminal).
const CODE_ALIASES = { icss: 'immaculate', god: 'godscare', excel_royal: 'excel' };
function aliasesFor(code) {
  const out = [code];
  Object.keys(CODE_ALIASES).forEach(a => {
    if (CODE_ALIASES[a] === code) out.push(a);
    if (a === code) out.push(CODE_ALIASES[a]);
  });
  return Array.from(new Set(out));
}
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function parseCloudPayload(cloud) {
  let reg1 = [];
  let reg2 = [];
  let allStudents = [];
  let allSaExams = [];

  try { reg1 = JSON.parse(cloud['schools_registry'] || '[]'); } catch(e){}
  try { reg2 = JSON.parse(cloud['superadmin_extended_schools'] || '[]'); } catch(e){}
  try { allStudents = JSON.parse(cloud['students_registry'] || '[]'); } catch(e){}
  try { allSaExams = JSON.parse(cloud['sa_cbt_exams'] || '[]'); } catch(e){}

  const rawSchools = [...reg2, ...reg1];
  const schoolsMap = new Map();

  rawSchools.forEach(s => {
    const id = s.id || s.schoolId || ('school_' + (s.code || ''));
    if (!schoolsMap.has(id)) {
      schoolsMap.set(id, s);
    }
  });

  // Also harvest dynamically provisioned schools from activityLogs_school_* and classes_school_*
  Object.keys(cloud).forEach(k => {
    const m = k.match(/^activityLogs_school_([a-zA-Z0-9_-]+)/);
    if (m) {
      const rawCode = m[1].toLowerCase();
      if (!IGNORED_TEST_CODES.has(rawCode)) {
        const code = CODE_ALIASES[rawCode] || rawCode;

        let schName = '';
        try {
          const logs = JSON.parse(cloud[k]);
          const prov = logs.find(l => l.action && l.action.toLowerCase().includes('provisioned school:'));
          if (prov) {
            const mName = prov.action.match(/provisioned school:\s*(.+)/i);
            if (mName) schName = mName[1].trim();
          }
        } catch(e) {}

        const id = `school_${rawCode}`;
        if (!schoolsMap.has(id)) {
          schoolsMap.set(id, {
            id: id,
            code: code,
            name: schName || (code === 'immaculate' ? 'IMMACULATE COMPREHENSIVE SECONDARY SCHOOL, ENUGU' : code.toUpperCase()),
            motto: code === 'immaculate' ? '48 Ochi Street, Achara Layout, Enugu' : 'Excellence in Learning',
            primaryColor: code === 'immaculate' ? '#1e3a8a' : '#2563eb',
            accentColor: code === 'immaculate' ? '#d97706' : '#f8fafc',
            logo: cloud[`logo_${id}`] || cloud[`logo_school_${code}`] || ''
          });
        }
      }
    }
  });

  const parsedSchools = [];

  for (const [id, s] of schoolsMap.entries()) {
    const code = (s.code || s.schoolCode || id.replace('school_', '')).trim().toLowerCase();
    if (IGNORED_TEST_CODES.has(code)) continue;
    const name = (s.name || s.schoolName || 'COTHI School').trim();
    const motto = (s.motto || s.address || 'Excellence in Learning').trim();
    const primaryColor = s.primaryColor || '#2563eb';
    const accentColor = s.accentColor || s.secondaryColor || '#f8fafc';
    const logo = s.logo || s.logoUrl || cloud[`logo_${id}`] || '';

    // Real Students Harvester across all cloud sources for this school
    const schoolStudentsMap = new Map();

    // Codes and IDs to match for this school (supports aliases like icss <-> immaculate, god <-> godscare)
    // Exact code + explicit aliases only. (excel_enugu used to also pull in "excel"
    // students, mixing two schools' rosters.)
    const codesToMatch = aliasesFor(code);
    const regPrefixRe = new RegExp('^(' + codesToMatch.map(escRe).join('|') + ')[-_/]?\\d', 'i');

    // 1. Check students_registry
    allStudents
      .filter(st => {
        const stSchId = (st.schoolId || '').toLowerCase().replace('school_', '');
        const stSchCode = (st.schoolCode || '').toLowerCase();
        return codesToMatch.some(c => stSchId === c || stSchCode === c || id === `school_${c}`);
      })
      .forEach((st, idx) => {
        const reg = (st.username || st.regNo || `${code.toUpperCase()}/${new Date().getFullYear()}/${String(idx + 1).padStart(3, '0')}`).trim();
        schoolStudentsMap.set(reg.toLowerCase(), {
          regNo: cleanText(reg),
          name: cleanText(st.name || `Student ${idx + 1}`),
          classLevel: cleanText(st.classGrade || st.classLevel || 'SS 2'),
          pin: st.pin ? String(st.pin).trim() : '',
          gender: st.gender || 'Not Specified'
        });
      });

    // 2. Harvest from examResults_* for this school
    Object.keys(cloud).forEach(k => {
      if (k.startsWith('examResults_')) {
        try {
          const results = JSON.parse(cloud[k]);
          if (Array.isArray(results)) {
            results.forEach(r => {
              if (r.studentId && r.studentName) {
                const targetSch = (r.schoolId || '').replace('school_', '').toLowerCase();
                const studentId = r.studentId.trim();
                const studentIdLower = studentId.toLowerCase();
                // Match by schoolId, or a reg no that is the school code followed by digits
                // (e.g. excel144, era028). A bare startsWith() let code "k" claim every
                // student whose id began with k, and "excel" claim excel_enugu students.
                if ((targetSch && codesToMatch.includes(targetSch)) || (!targetSch && regPrefixRe.test(studentId))) {
                  if (!schoolStudentsMap.has(studentIdLower)) {
                    schoolStudentsMap.set(studentIdLower, {
                      regNo: cleanText(studentId),
                      name: cleanText(r.studentName),
                      classLevel: 'SS 2',
                      pin: '',
                      gender: 'Not Specified'
                    });
                  }
                }
              }
            });
          }
        } catch(e) {}
      }
    });

    // 3. Harvest from activityLogs_* for this school
    Object.keys(cloud).forEach(k => {
      if (k === `activityLogs_${id}` || k === `activityLogs_school_${code}`) {
        try {
          const logs = JSON.parse(cloud[k]);
          if (Array.isArray(logs)) {
            logs.forEach(l => {
              if (l.action && l.action.includes('Onboarded student:')) {
                const match = l.action.match(/Onboarded student:\s*(.+?)\s*\(([^)]+)\)/i);
                if (match) {
                  const sName = match[1].trim();
                  const sReg = match[2].trim();
                  if (!schoolStudentsMap.has(sReg.toLowerCase())) {
                    schoolStudentsMap.set(sReg.toLowerCase(), {
                      regNo: cleanText(sReg),
                      name: cleanText(sName),
                      classLevel: 'SS 2',
                      pin: '',
                      gender: 'Not Specified'
                    });
                  }
                }
              } else if (l.action && l.action.includes('Added student:')) {
                const match = l.action.match(/Added student:\s*(.+)/i);
                if (match) {
                  const sName = match[1].trim();
                  const sReg = `${code}${String(schoolStudentsMap.size + 1).padStart(3, '0')}`;
                  if (!schoolStudentsMap.has(sReg.toLowerCase())) {
                    schoolStudentsMap.set(sReg.toLowerCase(), {
                      regNo: cleanText(sReg),
                      name: cleanText(sName),
                      classLevel: 'SS 2',
                      pin: '',
                      gender: 'Not Specified'
                    });
                  }
                }
              }
            });
          }
        } catch(e) {}
      }
    });

    // 4. Harvest from attempts_school_* for this school
    const attemptsKey = `attempts_${id}` in cloud ? `attempts_${id}` : `attempts_school_${code}`;
    if (attemptsKey in cloud) {
      try {
        const attempts = JSON.parse(cloud[attemptsKey]);
        if (Array.isArray(attempts)) {
          attempts.forEach((att, aIdx) => {
            if (att.studentId) {
              const reg = att.studentId.trim();
              const regLower = reg.toLowerCase();
              if (!schoolStudentsMap.has(regLower)) {
                schoolStudentsMap.set(regLower, {
                  regNo: reg,
                  name: `Candidate ${reg.toUpperCase()}`,
                  classLevel: 'SS 2',
                  pin: '',
                  gender: 'Not Specified'
                });
              }
            }
          });
        }
      } catch(e) {}
    }

    let students = Array.from(schoolStudentsMap.values());
    // Never fabricate mock students — schools without cloud students start with a clean empty list

    // Exams for this school
    let customExams = [];
    try { customExams = JSON.parse(cloud[`customExams_${id}`] || '[]'); } catch(e){}
    const saExams = allSaExams.filter(e => e.schoolId === id || (e.schoolCode && e.schoolCode.toLowerCase() === code));

    const combinedExams = [];
    const seenExamIds = new Set();

    customExams.forEach(ex => {
      if (!seenExamIds.has(ex.id)) {
        seenExamIds.add(ex.id);
        combinedExams.push({
          id: ex.id,
          title: ex.title || `${name} Examination`,
          subject: ex.subject || 'General Studies',
          classLevel: ex.classGrade || ex.classLevel || 'SS 2',
          durationMinutes: Math.round((ex.duration || 2400) / 60),
          passPercentage: ex.passMark || 50,
          instructions: ex.instructions || 'Answer all questions carefully.',
          questions: normalizeQuestions(ex.questions)
        });
      }
    });

    saExams.forEach(ex => {
      if (!seenExamIds.has(ex.id)) {
        seenExamIds.add(ex.id);
        let qList = [];
        try {
          const qbKey = 'qb_' + id;
          if (cloud[qbKey]) {
            const bank = JSON.parse(cloud[qbKey]);
            const match = bank.find(b => b.id === ex.id || b.subjectId === ex.subject);
            if (match && match.questions) qList = match.questions;
          }
        } catch(e){}

        combinedExams.push({
          id: ex.id,
          title: ex.title || `${name} Central Paper`,
          subject: ex.subject || 'General Studies',
          classLevel: ex.classGrade || 'SS 2',
          durationMinutes: Math.round((ex.duration || 2400) / 60),
          passPercentage: ex.passMark || 50,
          instructions: 'Answer all questions within the allocated time.',
          questions: normalizeQuestions(qList)
        });
      }
    });

    // No exams on the cloud for this school: leave the list empty instead of inventing
    // a placeholder "General Knowledge" paper (which made schools look downloaded).

    parsedSchools.push({
      code: code,
      id: id,
      name: cleanText(name),
      motto: cleanText(motto),
      primaryColor: primaryColor,
      accentColor: accentColor,
      logo: logo,
      students: students,
      exams: combinedExams
    });
  }

  return parsedSchools;
}

const cothiCloud = {
  loadCachedSchools() {
    const cacheFile = getCacheFilePath();
    try {
      if (fs.existsSync(cacheFile)) {
        const raw = fs.readFileSync(cacheFile, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch(e) {
      console.error('Error reading cothi_cache.json:', e);
    }
    return [];
  },

  async refreshSchoolsFromCloud() {
    let lastError = null;
    try {
      console.log('[COTHI CLOUD] Fetching live school directory from https://cbtbycothi.com.ng/api/v1/sync...');
      const payload = await fetchRawCloudData();
      const schools = parseCloudPayload(payload);

      if (schools && schools.length > 0) {
        // The cache holds ONLY what the cloud returned. Local snapshots/custom schools
        // live in custom_schools.json and are merged at read time (db.getCothiCentralSchools),
        // so stale local copies can no longer overwrite fresh cloud data here.
        const cacheFile = getCacheFilePath();
        fs.writeFileSync(cacheFile, JSON.stringify(schools, null, 2), 'utf-8');
        console.log(`[COTHI CLOUD] Cached ${schools.length} cloud schools to ${cacheFile}`);
        return { success: true, live: true, schools, count: schools.length };
      }
      lastError = 'The cloud responded but contained no schools.';
    } catch (err) {
      lastError = err.message;
      console.warn('[COTHI CLOUD] Live fetch failed or offline:', err.message);
    }

    // Fallback to local cache
    const cached = this.loadCachedSchools();
    return {
      success: cached.length > 0,
      live: false,
      schools: cached,
      count: cached.length,
      error: lastError,
      offlineNotice: 'Could not download from COTHI Cloud (' + (lastError || 'unknown error') + '). Showing the last saved copy.'
    };
  },

  pushResultsToCloud(schoolCode, submissions, terminalId) {
    return new Promise(async (resolve) => {
      const token = getAuthToken();
      const postData = JSON.stringify({
        key: terminalId ? `cbt_offline_results_${(schoolCode || 'school').toLowerCase()}_${terminalId}` : `cbt_offline_results_${(schoolCode || 'school').toLowerCase()}`,
        value: JSON.stringify({
          syncedAt: new Date().toISOString(),
          schoolCode: schoolCode,
          totalSubmissions: (submissions || []).length,
          records: submissions || []
        })
      });

      function sendToHost(host, servername) {
        return new Promise((resResolve, resReject) => {
          const options = {
            hostname: host,
            port: 443,
            path: '/api/v1/sync',
            method: 'POST',
            headers: {
              'Host': 'cbtbycothi.com.ng',
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
              'Accept': '*/*',
              'User-Agent': 'curl/8.4.0',
              'Content-Length': Buffer.byteLength(postData)
            },
            timeout: 20000
          };
          if (servername) options.servername = servername;

          const req = https.request(options, (res) => {
            resResolve({ success: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode });
          });
          req.on('error', (e) => resReject(e));
          req.on('timeout', () => { req.destroy(); resReject(new Error('Timeout')); });
          req.write(postData);
          req.end();
        });
      }

      try {
        const result = await sendToHost('cbtbycothi.com.ng');
        resolve(result);
      } catch (err) {
        console.warn(`[COTHI CLOUD] Result push via hostname failed (${err.message}). Trying direct IP...`);
        try {
          const ipResult = await sendToHost('66.235.174.177', 'cbtbycothi.com.ng');
          resolve(ipResult);
        } catch (ipErr) {
          resolve({ success: false, error: ipErr.message });
        }
      }
    });
  },

  pushSchoolToCloud(school) {
    return new Promise(async (resolve) => {
      if (!school || !school.code) return resolve({ success: false, error: 'Invalid school' });
      const token = getAuthToken();
      const postData = JSON.stringify({
        key: `custom_school_${school.code.toLowerCase()}`,
        value: JSON.stringify({
          id: school.id || `school_${school.code}`,
          code: school.code,
          name: school.name,
          motto: school.motto || 'Excellence in Learning',
          primaryColor: school.primaryColor || '#2563eb',
          accentColor: school.accentColor || '#f8fafc',
          logo: school.logo || '',
          syncedAt: new Date().toISOString()
        })
      });

      function sendToHost(host, servername) {
        return new Promise((resResolve, resReject) => {
          const options = {
            hostname: host,
            port: 443,
            path: '/api/v1/sync',
            method: 'POST',
            headers: {
              'Host': 'cbtbycothi.com.ng',
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
              'Accept': '*/*',
              'User-Agent': 'curl/8.4.0',
              'Content-Length': Buffer.byteLength(postData)
            },
            timeout: 15000
          };
          if (servername) options.servername = servername;

          const req = https.request(options, (res) => {
            resResolve({ success: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode });
          });
          req.on('error', (e) => resReject(e));
          req.on('timeout', () => { req.destroy(); resReject(new Error('Timeout')); });
          req.write(postData);
          req.end();
        });
      }

      try {
        const result = await sendToHost('cbtbycothi.com.ng');
        resolve(result);
      } catch (err) {
        try {
          const ipResult = await sendToHost('66.235.174.177', 'cbtbycothi.com.ng');
          resolve(ipResult);
        } catch (ipErr) {
          resolve({ success: false, error: ipErr.message });
        }
      }
    });
  }
};

module.exports = cothiCloud;
module.exports.aliasesFor = aliasesFor;
module.exports.cleanText = cleanText;
