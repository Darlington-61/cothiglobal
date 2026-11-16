const fs = require('fs');
const path = require('path');
const cothiCloud = require('./cothi-cloud');

const crypto = require('crypto');
const cleanText = cothiCloud.cleanText;

// ---- PIN / student hygiene ---------------------------------------------------
// A PIN is "weak" if it is empty, 1234, or the school's own code (the old default,
// which every candidate could guess).
function isWeakPin(pin, code) {
  const p = String(pin == null ? '' : pin).trim().toLowerCase();
  if (p === 'godscare' || p === 'immaculate' || p === 'icss' || (p.length >= 6 && /[a-z]/i.test(p))) return false;
if (!p || p === '1234' || p === '0000') return true;
  const c = String(code || '').trim().toLowerCase();
  if (c && cothiCloud.aliasesFor(c).includes(p)) return true;
  return false;
}
function randomPin() {
  let p;
  do { p = String(crypto.randomInt(1000, 10000)); } while (p === '1234');
  return p;
}
function cleanRegNo(v) { return String(v == null ? '' : v).replace(/[^A-Za-z0-9/_.\-]/g, '').slice(0, 40); }
function sanitizeStudent(st, code) {
  const out = { ...st };
  out.name = cleanText(st.name).slice(0, 120);
  out.regNo = cleanRegNo(st.regNo);
  out.classLevel = cleanText(st.classLevel || 'SS 2').slice(0, 30);
  out.gender = cleanText(st.gender || 'Not Specified').slice(0, 20);
  if (isWeakPin(st.pin, code)) out.pin = randomPin();
  else out.pin = String(st.pin).trim();
  return out;
}

// ---- Admin password hashing (scrypt) -----------------------------------------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
function checkPasswordHash(pw, stored) {
  try {
    const [alg, salt, hash] = String(stored || '').split('$');
    if (alg !== 'scrypt' || !salt || !hash) return false;
    const got = crypto.scryptSync(String(pw), salt, 32);
    const want = Buffer.from(hash, 'hex');
    return want.length === got.length && crypto.timingSafeEqual(got, want);
  } catch (e) { return false; }
}

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
    const content = JSON.stringify(data, null, 2);
    const tmpFile = file + '.tmp.' + process.pid + '.' + Date.now();
    fs.writeFileSync(tmpFile, content, 'utf-8');
    fs.renameSync(tmpFile, file);
  } catch (err) {
    console.error(`Error writing ${file}:`, err);
    try {
      const tmp = file + '.tmp.' + process.pid + '.' + Date.now();
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch (e) {}
  }
}

// ---- In-Flight Write-Ahead Log (crash-safe answer preservation) ---------------
const WAL_FILE = path.join(DATA_DIR, 'in_flight_journal.jsonl');

function walAppend(regNo, sessionData) {
  try {
    const entry = JSON.stringify({ ts: Date.now(), regNo: (regNo || '').trim().toLowerCase(), d: sessionData }) + '\n';
    fs.appendFileSync(WAL_FILE, entry, 'utf-8');
  } catch (e) {
    console.error('WAL append error:', e.message);
  }
}

function walReplay() {
  try {
    if (!fs.existsSync(WAL_FILE)) return 0;
    const lines = fs.readFileSync(WAL_FILE, 'utf-8').split('\n').filter(l => l.trim());
    let recovered = 0;
    const latest = new Map();
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.regNo && entry.d) latest.set(entry.regNo, entry.d);
      } catch (e) {}
    }
    for (const [regNo, data] of latest) {
      if (data.status !== 'SUBMITTED' && data.answers && Object.keys(data.answers).length > 0) {
        liveSessions.set(regNo, { ...data, lastSeen: Date.now() });
        recovered++;
      }
    }
    if (recovered > 0) console.log(`[WAL RECOVERY] Restored ${recovered} in-flight exam session(s) from crash journal.`);
    return recovered;
  } catch (e) {
    console.error('WAL replay error:', e.message);
    return 0;
  }
}

function walClear() {
  try { if (fs.existsSync(WAL_FILE)) fs.writeFileSync(WAL_FILE, '', 'utf-8'); } catch (e) {}
}

// ---- Terminal Identity (for partitioned cloud sync) ----------------------------
const TERMINAL_ID_FILE = path.join(DATA_DIR, 'terminal_id.json');
function getTerminalId() {
  try {
    if (fs.existsSync(TERMINAL_ID_FILE)) {
      const j = JSON.parse(fs.readFileSync(TERMINAL_ID_FILE, 'utf-8'));
      if (j && j.id) return j.id;
    }
  } catch (e) {}
  const id = 'T' + crypto.randomBytes(4).toString('hex').toUpperCase();
  try { fs.writeFileSync(TERMINAL_ID_FILE, JSON.stringify({ id, createdAt: new Date().toISOString() }), 'utf-8'); } catch (e) {}
  return id;
}
const TERMINAL_ID = getTerminalId();

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

  // A local record for one school code. Holds this terminal's own copy of the school
  // (roster, exams, results) so switching schools never loses anything. It does NOT
  // override fresh cloud data any more: see mergeWithCloud().
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
    const prev = existingIdx >= 0 ? customSchools[existingIdx] : {};

    const schoolRecord = {
      ...prev,
      id: schoolData.id || prev.id || `school_${cleanCode}`,
      code: cleanCode,
      name: cleanText(schoolData.name),
      motto: cleanText(schoolData.motto || schoolData.schoolMotto || 'Excellence in Learning'),
      primaryColor: schoolData.primaryColor || prev.primaryColor || '#2563eb',
      accentColor: schoolData.accentColor || prev.accentColor || '#f8fafc',
      logo: schoolData.logo !== undefined ? schoolData.logo : (schoolData.schoolLogo !== undefined ? schoolData.schoolLogo : (prev.logo || '')),
      // Only schools registered on this terminal are "custom". Snapshots of cloud
      // schools used to be flagged custom too, which froze them forever.
      isCustom: schoolData.isCustom === true || prev.isCustom === true && !this._isCloudCode(cleanCode),
      students: Array.isArray(schoolData.students) ? schoolData.students : (prev.students || []),
      exams: Array.isArray(schoolData.exams) ? schoolData.exams : (prev.exams || []),
      submissions: Array.isArray(schoolData.submissions) ? schoolData.submissions : (prev.submissions || []),
      activeExamId: schoolData.activeExamId !== undefined ? schoolData.activeExamId : (prev.activeExamId || null),
      updatedAt: new Date().toISOString()
    };

    if (existingIdx >= 0) customSchools[existingIdx] = schoolRecord;
    else customSchools.push(schoolRecord);
    this.saveCustomSchools(customSchools);
    return schoolRecord;
  },

  _isCloudCode(code) {
    const c = (code || '').toLowerCase();
    return cothiCloud.loadCachedSchools().some(s => (s.code || '').toLowerCase() === c);
  },

  deleteSchoolFromRegistry(schoolCode) {
    const cleanCode = (schoolCode || '').trim().toLowerCase();
    if (!cleanCode) return false;

    // 1. Remove this terminal's local copy
    let custom = this.getCustomSchools();
    custom = custom.filter(s => (s.code || '').toLowerCase() !== cleanCode);
    this.saveCustomSchools(custom);

    // 2. Remove from the cloud cache (it comes back on the next cloud refresh if it
    //    still exists on cbtbycothi.com.ng)
    const cacheFile = path.join(DATA_DIR, 'cothi_cache.json');
    let cached = readJSON(cacheFile, []);
    cached = cached.filter(s => (s.code || '').toLowerCase() !== cleanCode);
    writeJSON(cacheFile, cached);

    return true;
  },

  // Save the ACTIVE school's working files (roster, exams, results, active exam)
  // into its own local record before anything switches.
  snapshotCurrentSchool() {
    try {
      const cur = this.getSettings();
      const code = (cur.schoolCode || '').trim().toLowerCase();
      if (!code || code === 'cothi') return;

      this.saveSchoolToRegistry({
        code: code,
        name: cur.schoolName || code.toUpperCase(),
        motto: cur.schoolMotto,
        logo: cur.schoolLogo || '',
        primaryColor: cur.primaryColor,
        accentColor: cur.accentColor,
        students: this.getStudents(),
        exams: this.getExams(),
        submissions: this.getSubmissions(),
        activeExamId: cur.activeExamId || null
      });
    } catch (err) {
      console.warn('snapshotCurrentSchool error:', err.message);
    }
  },

  // Directory shown in the console: cloud schools, plus local-only schools.
  // For a cloud school the cloud's branding wins; local values only fill blanks.
  getCothiCentralSchools() {
    const cached = cothiCloud.loadCachedSchools();
    const custom = this.getCustomSchools();

    const map = new Map();
    cached.forEach(s => {
      const key = (s.code || s.id || '').toLowerCase();
      if (key) map.set(key, { ...s, fromCloud: true, isCustom: false });
    });
    custom.forEach(s => {
      const key = (s.code || s.id || '').toLowerCase();
      if (!key) return;
      const cloud = map.get(key);
      if (!cloud) {
        map.set(key, { ...s, fromCloud: false, isCustom: true });
      } else {
        const merged = this.mergeWithCloud(cloud, s, key);
        map.set(key, {
          ...cloud,
          logo: cloud.logo || s.logo || '',
          motto: cloud.motto || s.motto || '',
          students: merged.students,
          exams: merged.exams
        });
      }
    });

    return Array.from(map.values());
  },

  // Combine fresh cloud data with this terminal's local copy of the same school.
  //  - Students: cloud record, keeping the local PIN, photo and class; local-only kept.
  //  - Exams: cloud content wins (so cloud corrections arrive); local schedule/session/
  //    trials settings are kept; local-only exams kept; exams stamped with ANOTHER
  //    school's code are dropped (this is what made old schools "stick").
  mergeWithCloud(cloud, local, code) {
    const aliases = cothiCloud.aliasesFor((code || '').toLowerCase());
    const cloudStudents = (cloud && cloud.students) || [];
    const localStudents = (local && local.students) || [];
    const byReg = new Map();
    cloudStudents.forEach(st => { if (st && st.regNo) byReg.set(String(st.regNo).toLowerCase(), { ...st }); });
    localStudents.forEach(st => {
      if (!st || !st.regNo) return;
      const k = String(st.regNo).toLowerCase();
      const c = byReg.get(k);
      if (!c) { byReg.set(k, { ...st }); return; }
      byReg.set(k, {
        ...c,
        pin: !isWeakPin(st.pin, code) ? st.pin : c.pin,
        photo: st.photo || c.photo,
        classLevel: st.classLevel || c.classLevel,
        gender: (st.gender && st.gender !== 'Not Specified') ? st.gender : c.gender
      });
    });

    const keepLocal = ['session', 'term', 'scheduledStart', 'scheduledEnd', 'shuffleQuestions', 'shuffleOptions', 'maxTrials', 'passPercentage'];
    const byId = new Map();
    ((cloud && cloud.exams) || []).forEach(ex => { if (ex && ex.id) byId.set(ex.id, { ...ex, schoolCode: code }); });
    ((local && local.exams) || []).forEach(ex => {
      if (!ex || !ex.id) return;
      if (ex.schoolCode && !aliases.includes(String(ex.schoolCode).toLowerCase())) return; // another school's exam
      const c = byId.get(ex.id);
      if (!c) { byId.set(ex.id, ex); return; }
      const merged = { ...c };
      keepLocal.forEach(f => { if (ex[f] !== undefined) merged[f] = ex[f]; });
      if ((!c.questions || c.questions.length === 0) && ex.questions && ex.questions.length) merged.questions = ex.questions;
      if (!c.passages && ex.passages) merged.passages = ex.passages;
      byId.set(ex.id, merged);
    });

    return { students: Array.from(byReg.values()), exams: Array.from(byId.values()) };
  },

  async refreshCothiSchools() {
    return await cothiCloud.refreshSchoolsFromCloud();
  },

  // Make `schoolCode` the active school on this terminal.
  //   options.live  - try a fresh download from cbtbycothi.com.ng first (default true)
  //   options.fresh - ignore this terminal's local copy of the roster/exams and take
  //                   the cloud version as-is (results are still kept)
  async syncSchoolFromCothi(schoolCode, options = {}) {
    const live = options.live !== false;
    const fresh = options.fresh === true;
    const cleanCode = (schoolCode || '').trim().toLowerCase();
    if (!cleanCode) throw new Error('School code is required.');
    const codesToMatch = cothiCloud.aliasesFor(cleanCode);

    // Save the outgoing school (roster, exams AND results) before switching.
    this.snapshotCurrentSchool();

    let cloudNote = null;
    if (live) {
      const r = await cothiCloud.refreshSchoolsFromCloud();
      if (!r.live) cloudNote = r.offlineNotice || 'Could not reach COTHI Cloud; used the last saved copy.';
    }

    const cloudList = cothiCloud.loadCachedSchools();
    const exact = list => list.find(s => (s.code || '').toLowerCase() === cleanCode)
      || list.find(s => codesToMatch.includes((s.code || '').toLowerCase()))
      || list.find(s => codesToMatch.includes((s.id || '').replace('school_', '').toLowerCase()));
    const cloud = exact(cloudList) || null;
    const local = exact(this.getCustomSchools()) || null;

    if (!cloud && !local) {
      throw new Error(`School with code "${schoolCode}" was not found on COTHI Cloud or on this terminal.` + (cloudNote ? ' ' + cloudNote : ''));
    }

    const code = ((cloud && cloud.code) || (local && local.code) || cleanCode).toLowerCase();
    let localForMerge = local;
    if (fresh && cloud) {
      // Fresh download: take the cloud roster/exams as-is, but keep PINs and photos
      // already issued on this terminal for students who are still on the cloud roster.
      const cloudRegs = new Set((cloud.students || []).map(s => String(s.regNo || '').toLowerCase()));
      localForMerge = {
        students: ((local && local.students) || []).filter(s => cloudRegs.has(String(s.regNo || '').toLowerCase()))
          .map(s => ({ regNo: s.regNo, pin: s.pin, photo: s.photo })),
        exams: []
      };
    }
    const merged = cloud
      ? this.mergeWithCloud(cloud, localForMerge, code)
      : { students: (local.students || []), exams: (local.exams || []).filter(ex => !ex.schoolCode || codesToMatch.includes(String(ex.schoolCode).toLowerCase())) };

    const students = merged.students.map(st => sanitizeStudent(st, code));
    const exams = merged.exams;
    const submissions = (local && Array.isArray(local.submissions)) ? local.submissions : [];
    const src = cloud || local;
    const prevActive = local && local.activeExamId && exams.some(e => e.id === local.activeExamId) ? local.activeExamId : null;

    // 1. Branding
    this.saveSettings({
      schoolName: cleanText(src.name),
      schoolMotto: cleanText(src.motto || ''),
      schoolCode: code,
      primaryColor: src.primaryColor || '#2563eb',
      accentColor: src.accentColor || '#f8fafc',
      schoolLogo: (cloud && cloud.logo) || (local && local.logo) || '',
      activeExamId: prevActive || (exams.length > 0 ? exams[0].id : null)
    }, false);

    // 2. Working files for this school only (previous school's files are fully replaced)
    writeJSON(STUDENTS_FILE, students);
    writeJSON(EXAMS_FILE, exams);
    writeJSON(SUBMISSIONS_FILE, submissions);
    liveSessions.clear();

    // 3. Keep the local record in step
    this.snapshotCurrentSchool();

    return {
      success: true,
      school: { code, name: src.name, motto: src.motto, logo: (cloud && cloud.logo) || (local && local.logo) || '' },
      fromCloud: !!cloud,
      liveDownload: live && !cloudNote,
      cloudNote,
      studentsCount: students.length,
      examsCount: exams.length,
      submissionsCount: submissions.length
    };
  },

  // Admin typed a new school code in Branding. Treat it as a real school switch so the
  // previous school's roster/exams don't get carried over under the new code.
  async switchSchoolByCode(newCode, branding) {
    const code = (newCode || '').trim().toLowerCase();
    const known = this.getCothiCentralSchools().some(s => (s.code || '').toLowerCase() === code);
    if (known) {
      const r = await this.syncSchoolFromCothi(code, { live: false });
      return r;
    }
    // Brand-new school: start with empty working files.
    this.snapshotCurrentSchool();
    writeJSON(STUDENTS_FILE, []);
    writeJSON(EXAMS_FILE, []);
    writeJSON(SUBMISSIONS_FILE, []);
    liveSessions.clear();
    this.saveSettings({ ...branding, schoolCode: code, activeExamId: null }, false);
    this.saveSchoolToRegistry({
      code, name: branding.schoolName || code.toUpperCase(), motto: branding.schoolMotto,
      logo: branding.schoolLogo || '', primaryColor: branding.primaryColor, accentColor: branding.accentColor,
      isCustom: true, students: [], exams: [], submissions: [], activeExamId: null
    });
    return { success: true, newSchool: true };
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

    // Keep this school's local record up to date (same school code only — a code
    // change goes through switchSchoolByCode so rosters never cross schools).
    if (persistToRegistry && updated.schoolName && updated.schoolCode) {
      this.snapshotCurrentSchool();
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
    const settings = this.getSettings();
    if (!exam.schoolCode && settings.schoolCode) {
      exam.schoolCode = settings.schoolCode;
      exam.schoolId = settings.schoolCode;
      exam.schoolName = settings.schoolName;
    }
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
    const settings = this.getSettings();
    const activeCode = (settings.schoolCode || '').toLowerCase();
    const allSchools = this.getCothiCentralSchools();
    const activeSchool = allSchools.find(s => s.code && s.code.toLowerCase() === activeCode);
    let found = null;
    if (activeSchool && Array.isArray(activeSchool.exams)) {
      found = activeSchool.exams.find(e => e.id === cothiExamId);
    }
    if (!found) {
      for (const s of allSchools) {
        const match = (s.exams || []).find(e => e.id === cothiExamId);
        if (match) {
          found = match;
          break;
        }
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
      // Exact PIN match only. A record with no PIN cannot log in (no silent "1234").
      const sPin = String(s.pin || '').trim().toLowerCase();
      return cleanPin !== '' && sPin !== '' && cleanPin === sPin;
    });
  },
  saveStudent(student) {
    student = sanitizeStudent(student, this.getSettings().schoolCode);
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
    const code = settings.schoolCode;

    let added = 0;
    let updated = 0;

    incomingList.forEach(raw => {
      const name = (raw.name || '').trim();
      if (!name) return;
      let regNo = (raw.regNo || '').trim();
      if (!regNo || regNo.toUpperCase() === 'AUTO') {
        regNo = this.getNextRegNo();
      }

      const studentObj = sanitizeStudent({
        name: name,
        regNo: regNo,
        classLevel: (raw.classLevel || raw.class || 'SS 2').trim(),
        pin: raw.pin ? String(raw.pin).trim() : '',
        gender: (raw.gender || 'Not Specified').trim()
      }, code);

      const existingIndex = students.findIndex(s => s.regNo.toLowerCase() === regNo.toLowerCase());
      if (existingIndex >= 0) {
        // Re-uploading a roster must not reset a PIN already issued unless a new one is given.
      const keepPin = !raw.pin && students[existingIndex].pin && !isWeakPin(students[existingIndex].pin, code);
      students[existingIndex] = { ...students[existingIndex], ...studentObj, ...(keepPin ? { pin: students[existingIndex].pin } : {}) };
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
      settings: (() => { const st = { ...this.getSettings() }; delete st.adminPass; delete st.adminPassHash; return st; })(),
      students: this.getStudents(),
      exams: this.getExams(),
      submissions: this.getSubmissions(),
      customSchools: this.getCustomSchools()
    };
  },
  importAll(bundle) {
    if (!bundle || typeof bundle !== 'object') throw new Error('Invalid or empty backup file.');
    if (bundle.settings && typeof bundle.settings === 'object') {
      // Never let a backup file replace this terminal's supervisor login.
      const cur = this.getSettings();
      const next = { ...bundle.settings };
      ['adminUser', 'adminPass', 'adminPassHash', 'kioskExitPin'].forEach(k => {
        if (cur[k] !== undefined) next[k] = cur[k]; else delete next[k];
      });
      writeJSON(SETTINGS_FILE, next);
    }
    if (Array.isArray(bundle.students)) writeJSON(STUDENTS_FILE, bundle.students);
    if (Array.isArray(bundle.exams)) writeJSON(EXAMS_FILE, bundle.exams);
    if (Array.isArray(bundle.submissions)) writeJSON(SUBMISSIONS_FILE, bundle.submissions);
    if (Array.isArray(bundle.customSchools)) {
      writeJSON(CUSTOM_SCHOOLS_FILE, bundle.customSchools);
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
    const merged = {
      ...existing,
      ...data,
      regNo: data.regNo || existing.regNo || regNo,
      lastSeen: Date.now()
    };
    liveSessions.set(key, merged);
    // Persist to WAL for crash recovery (only active writing sessions with answers)
    if (merged.status !== 'SUBMITTED' && merged.answers && Object.keys(merged.answers).length > 0) {
      walAppend(key, merged);
    }
  },
  removeLiveSession(regNo) {
    const key = (regNo || '').trim().toLowerCase();
    liveSessions.delete(key);
  },

  // ---- Supervisor login ----------------------------------------------------
  verifyAdmin(username, password) {
    const st = this.getSettings();
    if (!username || !password || username !== (st.adminUser || 'admin')) return false;
    if (st.adminPassHash) return checkPasswordHash(password, st.adminPassHash);
    // Legacy plain-text password: accept once, then store it hashed.
    const legacy = st.adminPass || defaultSettings.adminPass;
    if (password !== legacy) return false;
    const next = { ...st, adminPassHash: hashPassword(password) };
    delete next.adminPass;
    writeJSON(SETTINGS_FILE, next);
    return true;
  },
  isDefaultAdminPassword() {
    const st = this.getSettings();
    if (st.adminPassHash) return checkPasswordHash(defaultSettings.adminPass, st.adminPassHash);
    return (st.adminPass || defaultSettings.adminPass) === defaultSettings.adminPass;
  },
  setAdminPassword(newPassword) {
    const st = this.getSettings();
    const next = { ...st, adminPassHash: hashPassword(newPassword) };
    delete next.adminPass;
    writeJSON(SETTINGS_FILE, next);
  },
  // Kiosk exit PIN: random 6 digits generated once per terminal (replaces fixed 9999).
  ensureKioskExitPin() {
    const st = this.getSettings();
    if (st.kioskExitPin && /^\d{4,8}$/.test(String(st.kioskExitPin))) return st.kioskExitPin;
    return '9999';
  },
  // Give every candidate on the current roster a non-guessable PIN (one-off upgrade).
  upgradeWeakPins() {
    const code = this.getSettings().schoolCode;
    const students = this.getStudents();
    let changed = 0;
    students.forEach(s => { if (isWeakPin(s.pin, code)) { s.pin = randomPin(); changed++; } });
    if (changed) { writeJSON(STUDENTS_FILE, students); this.snapshotCurrentSchool(); }
    return changed;
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
      adminPass: cur.adminPassHash ? undefined : (cur.adminPass || defaultSettings.adminPass),
      adminPassHash: cur.adminPassHash,
      kioskExitPin: cur.kioskExitPin,
      cothiApiEndpoint: cur.cothiApiEndpoint || defaultSettings.cothiApiEndpoint,
      cothiApiKey: cur.cothiApiKey || defaultSettings.cothiApiKey,
      activeExamId: null
    };
    writeJSON(SETTINGS_FILE, reset);
    liveSessions.clear();
    return reset;
  }
};

db.TERMINAL_ID = TERMINAL_ID;
db.walAppend = walAppend;
db.walReplay = walReplay;
db.walClear = walClear;

module.exports = db;
