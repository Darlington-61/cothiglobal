const fs = require('fs');
const path = require('path');
const cothiCloud = require('./cothi-cloud');

let DATA_DIR = path.join(__dirname, '..', 'data');
if (DATA_DIR.includes('app.asar')) {
  DATA_DIR = path.join(path.dirname(process.execPath), 'data');
}
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const EXAMS_FILE = path.join(DATA_DIR, 'exams.json');
const STUDENTS_FILE = path.join(DATA_DIR, 'students.json');
const SUBMISSIONS_FILE = path.join(DATA_DIR, 'submissions.json');
const CUSTOM_SCHOOLS_FILE = path.join(DATA_DIR, 'custom_schools.json');

function readJSON(file, fallback) {
  try {
    if (fs.existsSync(file)) {
      const data = fs.readFileSync(file, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error(`Error reading ${file}:`, err);
  }
  return fallback;
}

function writeJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error(`Error writing ${file}:`, err);
  }
}

const defaultSettings = {
  schoolName: "COTHIGLOBAL Examination Portal",
  schoolMotto: "Official Computer Based Test Terminal",
  schoolCode: "cothi",
  cothiApiEndpoint: "https://cbtbycothi.com.ng/api",
  cothiApiKey: "COTHI-OFFLINE-SERVER",
  primaryColor: "#2563eb",
  accentColor: "#f8fafc",
  schoolLogo: "",
  activeExamId: null,
  adminUser: "admin",
  adminPass: "admin123"
};

// In-memory live sessions for connected kiosk students
const liveSessions = new Map();

const db = {
  getCustomSchools() {
    return readJSON(CUSTOM_SCHOOLS_FILE, []);
  },

  saveCustomSchools(schools) {
    writeJSON(CUSTOM_SCHOOLS_FILE, schools);
  },

  saveSchoolToRegistry(schoolData) {
    if (!schoolData || !schoolData.name) {
      throw new Error('School name is required.');
    }
    const cleanCode = (schoolData.code || schoolData.id || schoolData.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 8)).trim().toLowerCase();
    if (!cleanCode) {
      throw new Error('Valid school code is required.');
    }

    const customSchools = this.getCustomSchools();
    const existingIdx = customSchools.findIndex(s => s.code && s.code.toLowerCase() === cleanCode);

    const schoolRecord = {
      id: schoolData.id || `school_${cleanCode}`,
      code: cleanCode,
      name: (schoolData.name || '').trim(),
      motto: (schoolData.motto || schoolData.schoolMotto || 'Excellence in Learning').trim(),
      primaryColor: schoolData.primaryColor || '#2563eb',
      accentColor: schoolData.accentColor || '#f8fafc',
      logo: schoolData.logo || schoolData.schoolLogo || '',
      isCustom: true,
      students: Array.isArray(schoolData.students) ? schoolData.students : (existingIdx >= 0 ? customSchools[existingIdx].students || [] : []),
      exams: Array.isArray(schoolData.exams) ? schoolData.exams : (existingIdx >= 0 ? customSchools[existingIdx].exams || [] : []),
      updatedAt: new Date().toISOString()
    };

    if (existingIdx >= 0) {
      customSchools[existingIdx] = { ...customSchools[existingIdx], ...schoolRecord };
    } else {
      customSchools.push(schoolRecord);
    }
    this.saveCustomSchools(customSchools);

    // Also upsert into cothi_cache.json so it is visible across all directory views
    const cacheFile = path.join(DATA_DIR, 'cothi_cache.json');
    const cachedSchools = readJSON(cacheFile, []);
    const cacheIdx = cachedSchools.findIndex(s => s.code && s.code.toLowerCase() === cleanCode);
    if (cacheIdx >= 0) {
      cachedSchools[cacheIdx] = { ...cachedSchools[cacheIdx], ...schoolRecord };
    } else {
      cachedSchools.push(schoolRecord);
    }
    writeJSON(cacheFile, cachedSchools);

    return schoolRecord;
  },

  snapshotCurrentSchool() {
    try {
      const cur = this.getSettings();
      const code = (cur.schoolCode || '').trim().toLowerCase();
      if (!code || (code === 'cothi' && !cur.schoolName)) return;

      const currentStudents = this.getStudents();
      const currentExams = this.getExams();

      this.saveSchoolToRegistry({
        code: code,
        name: cur.schoolName,
        motto: cur.schoolMotto,
        logo: cur.schoolLogo,
        primaryColor: cur.primaryColor,
        accentColor: cur.accentColor,
        students: currentStudents,
        exams: currentExams
      });
    } catch (err) {
      console.warn('snapshotCurrentSchool error:', err.message);
    }
  },

  getCothiCentralSchools() {
    const cached = cothiCloud.loadCachedSchools();
    const custom = this.getCustomSchools();

    const map = new Map();
    // 1. Cloud-cached schools
    cached.forEach(s => {
      const key = (s.code || s.id || '').toLowerCase();
      if (key) map.set(key, s);
    });
    // 2. Custom & locally registered schools (always preserved!)
    custom.forEach(s => {
      const key = (s.code || s.id || '').toLowerCase();
      if (key) {
        const existing = map.get(key) || {};
        map.set(key, { ...existing, ...s });
      }
    });

    return Array.from(map.values());
  },

  async refreshCothiSchools() {
    return await cothiCloud.refreshSchoolsFromCloud();
  },

  async syncSchoolFromCothi(schoolCode) {
    const cleanCode = (schoolCode || '').trim().toLowerCase();

    // Snapshot outgoing active school data so candidates and exams are never lost
    this.snapshotCurrentSchool();

    let schools = this.getCothiCentralSchools();

    let found = schools.find(s => s.code && s.code.toLowerCase() === cleanCode);

    if (!found) {
      found = schools.find(s => s.id && s.id.toLowerCase() === cleanCode);
    }

    if (!found) {
      found = schools.find(s => s.name && s.name.toLowerCase().includes(cleanCode));
    }

    // If not found in local cache, attempt a live fetch from cbtbycothi.com.ng
    if (!found) {
      console.log(`School "${schoolCode}" not in local cache. Attempting live fetch from cbtbycothi.com.ng...`);
      try {
        const refreshResult = await cothiCloud.refreshSchoolsFromCloud();
        schools = this.getCothiCentralSchools();
        found = schools.find(s => s.code && s.code.toLowerCase() === cleanCode)
          || schools.find(s => s.id && s.id.toLowerCase() === cleanCode)
          || schools.find(s => s.name && s.name.toLowerCase().includes(cleanCode));
      } catch (err) {
        console.warn('Live fetch failed during school sync:', err.message);
      }
    }

    if (!found) {
      throw new Error(`School with code "${schoolCode}" was not found in school directory.`);
    }

    // Check if this school has local custom data
    const customMatch = this.getCustomSchools().find(s => (s.code || '').toLowerCase() === cleanCode);
    const studentsToUse = (customMatch && Array.isArray(customMatch.students))
      ? customMatch.students
      : (found.students || []);
    const examsToUse = (customMatch && Array.isArray(customMatch.exams))
      ? customMatch.exams
      : (found.exams || []);

    const logoToUse = (customMatch && customMatch.logo !== undefined)
      ? customMatch.logo
      : (found.logo || '');

    // 1. Update Settings / Branding
    const newSettings = this.saveSettings({
      schoolName: found.name,
      schoolMotto: found.motto,
      schoolCode: found.code,
      primaryColor: found.primaryColor || '#2563eb',
      accentColor: found.accentColor || '#f8fafc',
      schoolLogo: logoToUse,
      activeExamId: examsToUse && examsToUse.length > 0 ? examsToUse[0].id : null
    }, false); // pass false so we don't trigger recursive registry write

    // 2. Overwrite / Sync Students for this school
    writeJSON(STUDENTS_FILE, studentsToUse);

    // 3. Overwrite / Sync Exams for this school
    writeJSON(EXAMS_FILE, examsToUse);

    // 4. Reset submissions and live monitoring sessions for this fresh school sync
    writeJSON(SUBMISSIONS_FILE, []);
    liveSessions.clear();

    return {
      success: true,
      school: found,
      studentsCount: studentsToUse.length,
      examsCount: examsToUse.length
    };
  },

  getSettings() {
    return readJSON(SETTINGS_FILE, defaultSettings);
  },
  saveSettings(data, persistToRegistry = true) {
    const current = this.getSettings();
    const updated = { ...current, ...data };

    // If school code changed and no explicit logo was provided in data, look up the target school's logo (never bleed old logo)
    if (data.schoolCode && data.schoolCode.trim().toLowerCase() !== (current.schoolCode || '').trim().toLowerCase()) {
      if (data.schoolLogo === undefined) {
        const cleanCode = data.schoolCode.trim().toLowerCase();
        const custom = this.getCustomSchools().find(s => (s.code || '').toLowerCase() === cleanCode);
        const central = this.getCothiCentralSchools().find(s => (s.code || '').toLowerCase() === cleanCode);
        updated.schoolLogo = (custom && custom.logo) || (central && central.logo) || '';
      }
    }

    writeJSON(SETTINGS_FILE, updated);

    // Automatically ensure this school is preserved in the persistent school registry
    if (persistToRegistry && updated.schoolName && updated.schoolCode) {
      try {
        this.saveSchoolToRegistry({
          name: updated.schoolName,
          code: updated.schoolCode,
          motto: updated.schoolMotto,
          logo: updated.schoolLogo,
          primaryColor: updated.primaryColor,
          accentColor: updated.accentColor,
          students: this.getStudents(),
          exams: this.getExams()
        });
      } catch (err) {
        console.warn('Auto saveSchoolToRegistry failed:', err.message);
      }
    }

    return updated;
  },

  getExams() {
    return readJSON(EXAMS_FILE, []);
  },
  getExamById(id) {
    const exams = this.getExams();
    return exams.find(e => e.id === id);
  },
  saveExam(exam) {
    const exams = this.getExams();
    const index = exams.findIndex(e => e.id === exam.id);
    if (index >= 0) {
      exams[index] = exam;
    } else {
      if (!exam.id) exam.id = 'exam-' + Date.now();
      exams.push(exam);
    }
    writeJSON(EXAMS_FILE, exams);
    this.snapshotCurrentSchool();
    return exam;
  },
  deleteExam(id) {
    let exams = this.getExams();
    exams = exams.filter(e => e.id !== id);
    writeJSON(EXAMS_FILE, exams);
    this.snapshotCurrentSchool();
    return true;
  },

  getCothiExams() {
    const settings = this.getSettings();
    const activeCode = (settings.schoolCode || '').toLowerCase();
    const allSchools = this.getCothiCentralSchools();

    // Only return exams belonging specifically to the active school
    const activeSchool = allSchools.find(s => s.code && s.code.toLowerCase() === activeCode);
    if (activeSchool && Array.isArray(activeSchool.exams)) {
      return activeSchool.exams;
    }
    return [];
  },

  importCothiExam(cothiExamId) {
    const allSchools = this.getCothiCentralSchools();
    let found = null;
    for (const s of allSchools) {
      const match = (s.exams || []).find(e => e.id === cothiExamId);
      if (match) {
        found = match;
        break;
      }
    }
    if (!found) throw new Error("Exam not found in COTHI central repository.");
    this.saveExam(found);
    return found;
  },

  getStudents() {
    return readJSON(STUDENTS_FILE, []);
  },
  getNextRegNo(targetSchoolCode) {
    const settings = this.getSettings();
    const rawCode = (targetSchoolCode || settings.schoolCode || 'STD').trim();
    const prefix = rawCode.toLowerCase().replace(/[^a-z0-9]/g, '') || 'std';
    const students = this.getStudents();

    let maxNum = 0;
    const prefixRegex = new RegExp(`^${prefix}[-_/]?(\\d+)`, 'i');
    const genericRegex = /(\\d+)$/;
    let matchedSpecific = false;

    for (const s of students) {
      if (!s || !s.regNo) continue;
      const cleanReg = String(s.regNo).trim();
      const m = cleanReg.match(prefixRegex);
      if (m) {
        matchedSpecific = true;
        const n = parseInt(m[1], 10);
        if (!isNaN(n) && n > maxNum) maxNum = n;
      }
    }

    if (!matchedSpecific) {
      for (const s of students) {
        if (!s || !s.regNo) continue;
        const cleanReg = String(s.regNo).trim();
        const m = cleanReg.match(genericRegex);
        if (m) {
          const n = parseInt(m[1], 10);
          if (!isNaN(n) && n > maxNum) maxNum = n;
        }
      }
    }

    let nextNum = maxNum + 1;
    let candidate = `${prefix}${String(nextNum).padStart(3, '0')}`;
    
    // Safety check: ensure absolute uniqueness against all existing students
    const existingSet = new Set(students.map(s => (s.regNo || '').toLowerCase().trim()));
    while (existingSet.has(candidate.toLowerCase())) {
      nextNum++;
      candidate = `${prefix}${String(nextNum).padStart(3, '0')}`;
    }

    return candidate;
  },
  findStudent(regNo, pin) {
    const students = this.getStudents();
    const cleanPin = (pin || '').trim().toLowerCase();

    return students.find(s => {
      if (s.regNo.toLowerCase() !== (regNo || '').trim().toLowerCase()) return false;
      // Exact PIN match only. Records with no stored PIN fall back to the default "1234".
      // (The previous 1234 / schoolCode / regNo bypasses let any candidate log in as anyone.)
      const sPin = (s.pin ? s.pin : '1234').trim().toLowerCase();
      return cleanPin !== '' && cleanPin === sPin;
    });
  },
  saveStudent(student) {
    if (!student.regNo || !student.regNo.trim() || student.regNo.trim().toUpperCase() === 'AUTO') {
      student.regNo = this.getNextRegNo();
    }
    const students = this.getStudents();
    const idx = students.findIndex(s => s.regNo.toLowerCase() === student.regNo.toLowerCase());
    if (idx >= 0) {
      students[idx] = student;
    } else {
      students.push(student);
    }
    writeJSON(STUDENTS_FILE, students);
    this.snapshotCurrentSchool();
    return student;
  },
  deleteStudent(regNo) {
    const students = this.getStudents();
    const filtered = students.filter(s => s.regNo.toLowerCase() !== regNo.toLowerCase());
    writeJSON(STUDENTS_FILE, filtered);
    this.snapshotCurrentSchool();
    return true;
  },
  bulkSaveStudents(incomingList) {
    if (!Array.isArray(incomingList)) return { added: 0, updated: 0, total: 0 };
    const students = this.getStudents();
    const settings = this.getSettings();
    const defaultPin = settings.schoolCode || '1234';

    let added = 0;
    let updated = 0;

    incomingList.forEach(raw => {
      const name = (raw.name || '').trim();
      if (!name) return;
      let regNo = (raw.regNo || '').trim();
      if (!regNo || regNo.toUpperCase() === 'AUTO') {
        regNo = this.getNextRegNo();
      }

      const studentObj = {
        name: name,
        regNo: regNo,
        classLevel: (raw.classLevel || raw.class || 'SS 2').trim(),
        pin: (raw.pin || defaultPin).trim(),
        gender: (raw.gender || 'Not Specified').trim()
      };

      const existingIndex = students.findIndex(s => s.regNo.toLowerCase() === regNo.toLowerCase());
      if (existingIndex >= 0) {
        students[existingIndex] = { ...students[existingIndex], ...studentObj };
        updated++;
      } else {
        students.push(studentObj);
        added++;
      }
    });

    writeJSON(STUDENTS_FILE, students);
    this.snapshotCurrentSchool();
    return { added, updated, total: students.length };
  },
  promoteStudents(studentRegNos, targetClass) {
    if (!Array.isArray(studentRegNos) || !targetClass) return 0;
    const students = this.getStudents();
    const set = new Set(studentRegNos.map(r => r.toLowerCase().trim()));
    let count = 0;

    students.forEach(s => {
      if (set.has(s.regNo.toLowerCase().trim())) {
        s.classLevel = targetClass.trim();
        count++;
      }
    });

    writeJSON(STUDENTS_FILE, students);
    return count;
  },
  advanceAllClasses() {
    const progression = {
      'JSS 1': 'JSS 2',
      'JSS 2': 'JSS 3',
      'JSS 3': 'SS 1',
      'SS 1': 'SS 2',
      'SS 2': 'SS 3',
      'SS 3': 'Graduated',
      'JS 1': 'JS 2',
      'JS 2': 'JS 3',
      'JS 3': 'SS 1',
      'SSS 1': 'SSS 2',
      'SSS 2': 'SSS 3',
      'SSS 3': 'Graduated',
      'PRIMARY 1': 'PRIMARY 2',
      'PRIMARY 2': 'PRIMARY 3',
      'PRIMARY 3': 'PRIMARY 4',
      'PRIMARY 4': 'PRIMARY 5',
      'PRIMARY 5': 'PRIMARY 6',
      'PRIMARY 6': 'JSS 1'
    };

    const students = this.getStudents();
    let count = 0;

    students.forEach(s => {
      const current = (s.classLevel || '').toUpperCase().trim();
      if (progression[current]) {
        s.classLevel = progression[current];
        count++;
      }
    });

    writeJSON(STUDENTS_FILE, students);
    return count;
  },

  getSubmissions() {
    return readJSON(SUBMISSIONS_FILE, []);
  },
  addSubmission(sub) {
    const submissions = this.getSubmissions();
    const filtered = submissions.filter(s => !(s.regNo === sub.regNo && s.examId === sub.examId));
    filtered.unshift(sub);
    writeJSON(SUBMISSIONS_FILE, filtered);
    return sub;
  },
  // Full backup / restore of the terminal's data.
  exportAll() {
    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      settings: this.getSettings(),
      students: this.getStudents(),
      exams: this.getExams(),
      submissions: this.getSubmissions(),
      customSchools: this.getCustomSchools()
    };
  },
  importAll(bundle) {
    if (!bundle || typeof bundle !== 'object') throw new Error('Invalid or empty backup file.');
    if (bundle.settings && typeof bundle.settings === 'object') writeJSON(SETTINGS_FILE, bundle.settings);
    if (Array.isArray(bundle.students)) writeJSON(STUDENTS_FILE, bundle.students);
    if (Array.isArray(bundle.exams)) writeJSON(EXAMS_FILE, bundle.exams);
    if (Array.isArray(bundle.submissions)) writeJSON(SUBMISSIONS_FILE, bundle.submissions);
    if (Array.isArray(bundle.customSchools)) {
      writeJSON(CUSTOM_SCHOOLS_FILE, bundle.customSchools);
      // Merge into cothi_cache.json as well
      const cacheFile = path.join(DATA_DIR, 'cothi_cache.json');
      const cached = readJSON(cacheFile, []);
      const map = new Map();
      cached.forEach(s => { if (s.code) map.set(s.code.toLowerCase(), s); });
      bundle.customSchools.forEach(cs => { if (cs.code) map.set(cs.code.toLowerCase(), cs); });
      writeJSON(cacheFile, Array.from(map.values()));
    }
    return {
      students: (bundle.students || []).length,
      exams: (bundle.exams || []).length,
      submissions: (bundle.submissions || []).length,
      customSchools: (bundle.customSchools || []).length
    };
  },

  // Attach photos to candidates in bulk, matching by a normalized reg number
  // (case/punctuation-insensitive), so filenames like ERA_2026_014.jpg match ERA/2026/014.
  setStudentPhotos(photoList) {
    if (!Array.isArray(photoList)) return { matched: 0, total: 0 };
    const students = this.getStudents();
    const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const byKey = {};
    students.forEach(st => { byKey[norm(st.regNo)] = st; });
    let matched = 0;
    const unmatched = [];
    photoList.forEach(p => {
      const st = byKey[norm(p.regNo)];
      if (st && p.photo) { st.photo = p.photo; matched++; }
      else unmatched.push(p.regNo);
    });
    writeJSON(STUDENTS_FILE, students);
    return { matched, total: photoList.length, unmatched };
  },
  setStudentPhoto(regNo, photo) {
    const students = this.getStudents();
    const st = students.find(s => s.regNo.toLowerCase() === (regNo || '').toLowerCase());
    if (!st) return false;
    st.photo = photo || '';
    writeJSON(STUDENTS_FILE, students);
    return true;
  },
  updateSubmission(submissionId, patch) {
    const subs = this.getSubmissions();
    const i = subs.findIndex(s => s.submissionId === submissionId);
    if (i < 0) return null;
    subs[i] = { ...subs[i], ...patch };
    writeJSON(SUBMISSIONS_FILE, subs);
    return subs[i];
  },

  // Live real-time memory
  getLiveSession(regNo) {
    const key = (regNo || '').trim().toLowerCase();
    return liveSessions.get(key) || null;
  },
  getLiveSessions() {
    const now = Date.now();
    return Array.from(liveSessions.values()).map(s => {
      const isOnline = (now - (s.lastSeen || 0)) < 25000;
      let effectiveStatus = s.status || 'WRITING';
      if (effectiveStatus !== 'SUBMITTED') {
        effectiveStatus = isOnline ? 'WRITING' : 'DISCONNECTED';
      }
      return {
        ...s,
        isOnline,
        status: effectiveStatus
      };
    });
  },
  setLiveSession(regNo, data) {
    const key = (regNo || '').trim().toLowerCase();
    if (!key) return;
    const existing = liveSessions.get(key) || {};
    liveSessions.set(key, {
      ...existing,
      ...data,
      regNo: data.regNo || existing.regNo || regNo,
      lastSeen: Date.now()
    });
  },
  removeLiveSession(regNo) {
    const key = (regNo || '').trim().toLowerCase();
    liveSessions.delete(key);
  },

  // Wipe this terminal clean for a NEW school: clears roster, exams and
  // submissions, resets branding/active exam to defaults, and keeps the admin
  // login, the COTHI cloud settings and the cached school directory.
  resetTerminal() {
    // Preserve current school first so its data is saved in custom_schools.json / cothi_cache.json
    this.snapshotCurrentSchool();

    writeJSON(STUDENTS_FILE, []);
    writeJSON(EXAMS_FILE, []);
    writeJSON(SUBMISSIONS_FILE, []);
    const cur = this.getSettings();
    const reset = {
      ...defaultSettings,
      adminUser: cur.adminUser || defaultSettings.adminUser,
      adminPass: cur.adminPass || defaultSettings.adminPass,
      cothiApiEndpoint: cur.cothiApiEndpoint || defaultSettings.cothiApiEndpoint,
      cothiApiKey: cur.cothiApiKey || defaultSettings.cothiApiKey,
      activeExamId: null
    };
    writeJSON(SETTINGS_FILE, reset);
    liveSessions.clear();
    return reset;
  }
};

module.exports = db;
