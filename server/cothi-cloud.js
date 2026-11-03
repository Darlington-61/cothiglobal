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

function fetchFromEndpoint(host, servername) {
  return new Promise((resolve, reject) => {
    const token = getAuthToken();
    const options = {
      hostname: host,
      port: 443,
      path: '/api/v1/sync',
      method: 'GET',
      headers: {
        'Host': 'cbtbycothi.com.ng',
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 60000
    };
    if (servername) {
      options.servername = servername;
    }

    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`COTHI central cloud returned HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
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
  try {
    return await fetchFromEndpoint('cbtbycothi.com.ng');
  } catch (err) {
    console.warn(`[COTHI CLOUD] Hostname fetch failed (${err.message}). Trying direct IP fallback (66.235.174.177)...`);
  }

  // 2. Direct IP fallback with SNI (bypasses DNS issues on local hotspot/school networks)
  return await fetchFromEndpoint('66.235.174.177', 'cbtbycothi.com.ng');
}

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

  const parsedSchools = [];

  for (const [id, s] of schoolsMap.entries()) {
    const code = (s.code || s.schoolCode || id.replace('school_', '')).trim().toLowerCase();
    const name = (s.name || s.schoolName || 'COTHI School').trim();
    const motto = (s.motto || s.address || 'Excellence in Learning').trim();
    const primaryColor = s.primaryColor || '#2563eb';
    const accentColor = s.accentColor || s.secondaryColor || '#f8fafc';
    const logo = s.logo || s.logoUrl || cloud[`logo_${id}`] || '';

    // Real Students Harvester across all cloud sources for this school
    const schoolStudentsMap = new Map();

    // 1. Check students_registry
    allStudents
      .filter(st => st.schoolId === id || (st.schoolCode && st.schoolCode.toLowerCase() === code))
      .forEach((st, idx) => {
        const reg = (st.username || st.regNo || `${code.toUpperCase()}/${new Date().getFullYear()}/${String(idx + 1).padStart(3, '0')}`).trim();
        schoolStudentsMap.set(reg.toLowerCase(), {
          regNo: reg,
          name: st.name || `Student ${idx + 1}`,
          classLevel: st.classGrade || st.classLevel || 'SS 2',
          pin: st.pin || code || '1234',
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
                // Match by schoolId or if studentId starts with school code (e.g. excel144, era028, k001)
                if (targetSch === code || studentIdLower.startsWith(code)) {
                  if (!schoolStudentsMap.has(studentIdLower)) {
                    schoolStudentsMap.set(studentIdLower, {
                      regNo: studentId,
                      name: r.studentName.trim(),
                      classLevel: 'SS 2',
                      pin: code || '1234',
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
                      regNo: sReg,
                      name: sName,
                      classLevel: 'SS 2',
                      pin: code || '1234',
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
                      regNo: sReg,
                      name: sName,
                      classLevel: 'SS 2',
                      pin: code || '1234',
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
                  pin: code || '1234',
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

    if (combinedExams.length === 0) {
      combinedExams.push({
        id: `exam-${code}-gen`,
        title: `${name} General Knowledge & Aptitude CBT`,
        subject: 'General Knowledge',
        classLevel: 'SS 2',
        durationMinutes: 40,
        passPercentage: 50,
        instructions: 'Answer all questions carefully.',
        questions: [
          {
            id: 1,
            question: "Which organelle is referred to as the powerhouse of the cell?",
            options: { A: "Ribosome", B: "Mitochondria", C: "Golgi apparatus", D: "Nucleus" },
            correctAnswer: "B",
            marks: 5
          },
          {
            id: 2,
            question: "Solve the linear equation: 3x - 7 = 14",
            options: { A: "x = 5", B: "x = 7", C: "x = 6", D: "x = 8" },
            correctAnswer: "B",
            marks: 5
          }
        ]
      });
    }

    parsedSchools.push({
      code: code,
      id: id,
      name: name,
      motto: motto,
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
    try {
      console.log('[COTHI CLOUD] Fetching live school directory from https://cbtbycothi.com.ng/api/v1/sync...');
      const payload = await fetchRawCloudData();
      const schools = parseCloudPayload(payload);

      if (schools && schools.length > 0) {
        const cacheFile = getCacheFilePath();
        let customSchools = [];
        try {
          const customFile = path.join(path.dirname(cacheFile), 'custom_schools.json');
          if (fs.existsSync(customFile)) {
            customSchools = JSON.parse(fs.readFileSync(customFile, 'utf-8'));
          }
        } catch(e) {}

        const schoolMap = new Map();
        // 1. Cloud-fetched schools
        schools.forEach(s => {
          if (s.code) schoolMap.set(s.code.toLowerCase(), s);
        });

        // 2. Merge local / custom schools so they are never lost on cloud refreshes
        (customSchools || []).forEach(cs => {
          if (cs.code) {
            const key = cs.code.toLowerCase();
            if (schoolMap.has(key)) {
              const cloudSch = schoolMap.get(key);
              schoolMap.set(key, {
                ...cloudSch,
                ...cs,
                students: (cs.students && cs.students.length > 0) ? cs.students : cloudSch.students,
                exams: (cs.exams && cs.exams.length > 0) ? cs.exams : cloudSch.exams
              });
            } else {
              schoolMap.set(key, cs);
            }
          }
        });

        const mergedSchools = Array.from(schoolMap.values());
        fs.writeFileSync(cacheFile, JSON.stringify(mergedSchools, null, 2), 'utf-8');
        console.log(`[COTHI CLOUD] Successfully cached ${mergedSchools.length} schools (cloud + local merged) to ${cacheFile}`);
        return { success: true, live: true, schools: mergedSchools, count: mergedSchools.length };
      }
    } catch (err) {
      console.warn('[COTHI CLOUD] Live fetch failed or offline:', err.message);
    }

    // Fallback to local cache
    const cached = this.loadCachedSchools();
    return {
      success: cached.length > 0,
      live: false,
      schools: cached,
      count: cached.length,
      offlineNotice: 'Operating in offline cache mode'
    };
  },

  pushResultsToCloud(schoolCode, submissions) {
    return new Promise(async (resolve) => {
      const token = getAuthToken();
      const postData = JSON.stringify({
        key: `cbt_offline_results_${(schoolCode || 'school').toLowerCase()}`,
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
