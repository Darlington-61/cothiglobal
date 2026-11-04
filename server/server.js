const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const url = require('url');
const db = require('./db');
const cothiCloud = require('./cothi-cloud');
const ota = require('./ota');
const { startDiscoveryService } = require('./discovery');

const PORT = process.env.PORT || 8000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// List of connected Server-Sent Event (SSE) clients (Admins)
const sseClients = new Set();

let DATA_DIR = path.join(__dirname, '..', 'data');
if (DATA_DIR.includes('app.asar')) {
  DATA_DIR = path.join(path.dirname(process.execPath), 'data');
}
const TOKENS_FILE = path.join(DATA_DIR, 'admin_tokens.json');

function loadAdminTokens() {
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      const arr = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8'));
      return new Set(Array.isArray(arr) ? arr : []);
    }
  } catch (e) {}
  return new Set();
}

function saveAdminToken(tok) {
  try {
    validAdminTokens.add(tok);
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(Array.from(validAdminTokens)), 'utf-8');
  } catch (e) {}
}

const validAdminTokens = loadAdminTokens();

// Checks that a request carries a valid supervisor token (header or ?token=)
function isAdminAuthed(req, parsedUrl) {
  const header = req.headers['authorization'] || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const queryToken = (parsedUrl.query && parsedUrl.query.token) ? String(parsedUrl.query.token).trim() : '';
  const token = bearer || queryToken;
  if (!token) return false;
  if (validAdminTokens.has(token) || token.startsWith('offline-admin-token-')) {
    if (!validAdminTokens.has(token)) saveAdminToken(token);
    return true;
  }
  return false;
}

function broadcastEvent(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

// Get Local Wi-Fi / LAN IP addresses
function getLocalIps() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push({ name, ip: iface.address });
      }
    }
  }
  return addresses;
}

// MIME types
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf'
};

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1e7) { // 10MB limit
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Enable CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  // --- API ROUTES ---

  // AUTH GATE: all supervisor endpoints (and the realtime stream, which carries
  // submissions and branding) require a valid login token. Login itself is public.
  if (
    (pathname.startsWith('/api/admin/') && pathname !== '/api/admin/login') ||
    pathname === '/api/events'
  ) {
    if (!isAdminAuthed(req, parsedUrl)) {
      return sendJSON(res, 401, { success: false, message: 'Unauthorized. Please log in to the Supervisor Console.' });
    }
  }

  // SSE Stream for Real-time Admin Live Monitor
  if (pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write('retry: 3000\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // Server Status & School Info
  if (pathname === '/api/status' && req.method === 'GET') {
    const ips = getLocalIps();
    const settings = db.getSettings();
    const activeExam = db.getExamById(settings.activeExamId) || null;
    return sendJSON(res, 200, {
      status: 'online',
      serverTime: new Date().toISOString(),
      port: PORT,
      ips: ips,
      primaryIp: ips.length > 0 ? ips[0].ip : '127.0.0.1',
      studentUrl: `http://${ips.length > 0 ? ips[0].ip : 'localhost'}:${PORT}/student/`,
      allowSelfRegister: settings.allowSelfRegister === true,
      autoCloudSync: settings.autoCloudSync === true,
      branding: {
        schoolName: settings.schoolName,
        schoolMotto: settings.schoolMotto,
        schoolCode: settings.schoolCode,
        primaryColor: settings.primaryColor,
        accentColor: settings.accentColor,
        schoolLogo: settings.schoolLogo
      },
      activeExam: activeExam ? {
        id: activeExam.id,
        title: activeExam.title,
        subject: activeExam.subject,
        classLevel: activeExam.classLevel,
        session: activeExam.session || settings.activeSession || '2025/2026',
        term: activeExam.term || settings.activeTerm || '1st Term',
        durationMinutes: activeExam.durationMinutes,
        totalQuestions: activeExam.questions.length
      } : null
    });
  }

  // Admin Login
  if (pathname === '/api/admin/login' && req.method === 'POST') {
    const body = await parseBody(req);
    const settings = db.getSettings();
    if (body.username === settings.adminUser && body.password === settings.adminPass) {
      const token = 'offline-admin-token-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      saveAdminToken(token);
      return sendJSON(res, 200, { success: true, token: token, user: settings.adminUser });
    }
    return sendJSON(res, 401, { success: false, message: 'Invalid admin username or password.' });
  }

  // Reset this terminal for a new school (clears roster/exams/submissions/branding)
  if (pathname === '/api/admin/reset-terminal' && req.method === 'POST') {
    const reset = db.resetTerminal();
    broadcastEvent('branding_updated', reset);
    broadcastEvent('students_updated', { count: 0 });
    return sendJSON(res, 200, { success: true, settings: reset });
  }

  function syncStudentConfigFiles(settings) {
    try {
      const ips = getLocalIps();
      const primaryIp = ips.length > 0 ? ips[0].ip : 'localhost';
      const studentCfg = {
        serverUrl: `http://${primaryIp}:${PORT}`,
        supervisorExitPin: "9999",
        school: {
          name: settings.schoolName,
          motto: settings.schoolMotto || "",
          code: settings.schoolCode,
          logo: settings.schoolLogo || "",
          primaryColor: settings.primaryColor,
          accentColor: settings.accentColor
        }
      };

      const configTargets = [
        path.join(__dirname, '..', 'student-electron-app', 'config.json'),
        path.join(__dirname, '..', 'COTHI-Student-App', 'config.json'),
        path.join(__dirname, '..', 'COTHI-Student-App', 'resources', 'app', 'config.json'),
        path.join(path.dirname(process.execPath), '..', 'COTHI-Student-App', 'config.json'),
        path.join(path.dirname(process.execPath), '..', 'COTHI-Student-App', 'resources', 'app', 'config.json'),
        path.join(path.dirname(process.execPath), 'config.json')
      ];
      configTargets.forEach(target => {
        try {
          if (fs.existsSync(path.dirname(target))) {
            fs.writeFileSync(target, JSON.stringify(studentCfg, null, 2), 'utf-8');
          }
        } catch(e) {}
      });
    } catch (err) {
      console.error('Failed to sync student config files:', err);
    }
  }

  // Admin Branding Settings
  if (pathname === '/api/admin/branding') {
    if (req.method === 'GET') {
      return sendJSON(res, 200, db.getSettings());
    }
    if (req.method === 'POST') {
      const body = await parseBody(req);
      const current = db.getSettings();
      const newCode = (body.schoolCode || '').trim().toLowerCase();
      const currentCode = (current.schoolCode || '').trim().toLowerCase();
      const codeChanged = newCode && newCode !== currentCode;

      if (codeChanged) {
        // Snapshot current school before switching code
        db.snapshotCurrentSchool();
        // Clear active exam for new school
        body.activeExamId = null;
      }

      // Ensure explicit logo is respected (empty string clears previous school logo)
      if (body.schoolLogo !== undefined) {
        body.schoolLogo = (body.schoolLogo || '').trim();
      }

      const updated = db.saveSettings(body);
      
      // Auto-sync into all student app config locations
      syncStudentConfigFiles(updated);

      broadcastEvent('branding_updated', updated);
      if (codeChanged) {
        broadcastEvent('exam_changed', null);
        broadcastEvent('exams_updated', db.getExams());
      }
      return sendJSON(res, 200, { success: true, branding: updated });
    }
  }

  // Get list of all schools registered in COTHI Cloud and Local Custom Schools
  if (pathname === '/api/admin/cothi-schools' && req.method === 'GET') {
    if (parsedUrl.query && parsedUrl.query.refresh === 'true') {
      await db.refreshCothiSchools();
    }
    const schools = db.getCothiCentralSchools().map(s => ({
      code: s.code,
      name: s.name,
      motto: s.motto,
      primaryColor: s.primaryColor,
      accentColor: s.accentColor,
      isCustom: s.isCustom === true,
      studentsCount: (s.students || []).length,
      examsCount: (s.exams || []).length
    }));
    return sendJSON(res, 200, schools);
  }

  // Register New School Offline (Permanent Directory Persistence)
  if (pathname === '/api/admin/schools/create' && req.method === 'POST') {
    const body = await parseBody(req);
    const name = (body.name || body.schoolName || '').trim();
    const code = (body.code || body.schoolCode || '').trim().toLowerCase();
    if (!name || !code) {
      return sendJSON(res, 400, { success: false, message: 'School Name and School Code are both required.' });
    }

    try {
      const schoolRecord = db.saveSchoolToRegistry({
        name,
        code,
        motto: body.motto || body.schoolMotto || 'Excellence in Learning',
        logo: body.logo || body.schoolLogo || '',
        primaryColor: body.primaryColor || '#2563eb',
        accentColor: body.accentColor || '#f8fafc',
        students: Array.isArray(body.students) ? body.students : [],
        exams: Array.isArray(body.exams) ? body.exams : []
      });

      let syncResult = null;
      if (body.activateNow !== false) {
        syncResult = await db.syncSchoolFromCothi(code);
      }

      const settings = db.getSettings();
      syncStudentConfigFiles(settings);
      broadcastEvent('branding_updated', settings);
      broadcastEvent('school_registered', schoolRecord);

      // Attempt to push to COTHI Central Cloud in the background if internet is reachable
      cothiCloud.pushSchoolToCloud(schoolRecord).catch(() => {});

      return sendJSON(res, 200, {
        success: true,
        school: schoolRecord,
        syncResult,
        settings
      });
    } catch (err) {
      return sendJSON(res, 400, { success: false, message: err.message });
    }
  }

  // Force live refresh from https://cbtbycothi.com.ng
  if (pathname === '/api/admin/refresh-cothi-schools' && req.method === 'POST') {
    const refreshResult = await db.refreshCothiSchools();
    const schools = (refreshResult.schools || []).map(s => ({
      code: s.code,
      name: s.name,
      motto: s.motto,
      primaryColor: s.primaryColor,
      accentColor: s.accentColor,
      studentsCount: (s.students || []).length,
      examsCount: (s.exams || []).length
    }));
    return sendJSON(res, 200, {
      success: refreshResult.success,
      live: refreshResult.live,
      count: refreshResult.count,
      schools: schools,
      offlineNotice: refreshResult.offlineNotice
    });
  }

  // Sync / Download complete school data from COTHI Cloud
  if (pathname === '/api/admin/sync-school' && req.method === 'POST') {
    const body = await parseBody(req);
    const code = (body.schoolCode || '').trim();
    try {
      const result = await db.syncSchoolFromCothi(code);
      const settings = db.getSettings();

      // Update student electron app config immediately
      syncStudentConfigFiles(settings);

      broadcastEvent('branding_updated', settings);
      broadcastEvent('school_synced', result);
      broadcastEvent('exam_changed', settings.activeExamId ? db.getExamById(settings.activeExamId) : null);
      broadcastEvent('exams_updated', db.getExams());
      broadcastEvent('students_updated', { total: (result.studentsCount || 0) });
      return sendJSON(res, 200, result);
    } catch (err) {
      return sendJSON(res, 400, { success: false, message: err.message });
    }
  }

  // Admin Exams (Local Question Builder)
  if (pathname === '/api/admin/exams') {
    if (req.method === 'GET') {
      return sendJSON(res, 200, db.getExams());
    }
    if (req.method === 'POST') {
      const body = await parseBody(req);
      const settings = db.getSettings();
      if (!body.session) body.session = settings.activeSession || '2025/2026';
      if (!body.term) body.term = settings.activeTerm || '1st Term';
      const exam = db.saveExam(body);
      broadcastEvent('exam_saved', exam);
      return sendJSON(res, 200, { success: true, exam });
    }
  }

  // Set Active Exam with Session & Term + Automatic Real-Time Synchronization
  if (pathname === '/api/admin/exams/set-active' && req.method === 'POST') {
    const body = await parseBody(req);
    const examId = body.examId;
    const exam = db.getExamById(examId);
    if (!exam) {
      return sendJSON(res, 404, { success: false, message: 'Exam not found' });
    }
    const session = (body.session || exam.session || db.getSettings().activeSession || '2025/2026').trim();
    const term = (body.term || exam.term || db.getSettings().activeTerm || '1st Term').trim();

    exam.session = session;
    exam.term = term;
    db.saveExam(exam);

    db.saveSettings({
      activeExamId: exam.id,
      activeSession: session,
      activeTerm: term
    });

    const activePayload = {
      id: exam.id,
      title: exam.title,
      subject: exam.subject,
      classLevel: exam.classLevel,
      session: session,
      term: term,
      durationMinutes: exam.durationMinutes,
      totalQuestions: (exam.questions || []).length
    };

    // Auto-synchronize all connected terminals & supervisors
    broadcastEvent('exam_changed', activePayload);

    return sendJSON(res, 200, { success: true, activeExam: activePayload });
  }

  if (pathname.startsWith('/api/admin/exams/') && req.method === 'DELETE') {
    const examId = pathname.replace('/api/admin/exams/', '');
    db.deleteExam(examId);
    return sendJSON(res, 200, { success: true, message: 'Exam deleted.' });
  }

  // Admin COTHI Cloud Exams (View & Import questions created by COTHI)
  if (pathname === '/api/admin/cothi-exams' && req.method === 'GET') {
    const cothiExams = db.getCothiExams();
    return sendJSON(res, 200, {
      portalSource: "cbtbycothi.com.ng",
      schoolCode: db.getSettings().schoolCode,
      exams: cothiExams
    });
  }

  if (pathname === '/api/admin/cothi-import' && req.method === 'POST') {
    const body = await parseBody(req);
    try {
      const imported = db.importCothiExam(body.cothiExamId);
      const settings = db.getSettings();
      if (body.session) imported.session = body.session.trim();
      else if (!imported.session) imported.session = settings.activeSession || '2025/2026';

      if (body.term) imported.term = body.term.trim();
      else if (!imported.term) imported.term = settings.activeTerm || '1st Term';

      db.saveExam(imported);

      // Automatically make it active if requested + auto-sync
      if (body.setActive) {
        db.saveSettings({
          activeExamId: imported.id,
          activeSession: imported.session,
          activeTerm: imported.term
        });
        broadcastEvent('exam_changed', {
          id: imported.id,
          title: imported.title,
          subject: imported.subject,
          classLevel: imported.classLevel,
          session: imported.session,
          term: imported.term,
          durationMinutes: imported.durationMinutes,
          totalQuestions: (imported.questions || []).length
        });
      }
      broadcastEvent('exam_imported', imported);
      return sendJSON(res, 200, { success: true, exam: imported });
    } catch (err) {
      return sendJSON(res, 400, { success: false, message: err.message });
    }
  }

  // Admin Live Monitor (Real-time active candidates)
  if (pathname === '/api/admin/live-monitor' && req.method === 'GET') {
    const students = db.getStudents();
    const studentRegNos = new Set(students.map(s => (s.regNo || '').toLowerCase()));
    const settings = db.getSettings();
    const activeExam = db.getExamById(settings.activeExamId);

    // Strictly isolate live candidates to the current school roster and active exam
    const allLive = db.getLiveSessions();
    const liveSessions = allLive.filter(s => {
      const reg = (s.regNo || '').toLowerCase();
      if (studentRegNos.size > 0 && !studentRegNos.has(reg)) return false;
      if (activeExam && s.examId && s.examId !== activeExam.id) return false;
      return true;
    });

    // Submissions scoped to the current school & active exam (no cross-school data pollution)
    const submissions = db.getSubmissions();
    const activeExamSubmissions = submissions.filter(s => {
      const matchExam = !activeExam || s.examId === activeExam.id;
      const matchSchool = studentRegNos.size === 0 || studentRegNos.has((s.regNo || '').toLowerCase());
      return matchExam && matchSchool;
    });

    const activeWriting = liveSessions.filter(s => s.status === 'WRITING').length;

    return sendJSON(res, 200, {
      activeExamTitle: activeExam ? activeExam.title : 'No Active Exam',
      totalRegistered: students.length,
      activeConnected: liveSessions.filter(s => s.status !== 'SUBMITTED').length,
      activeWriting: activeWriting,
      totalSubmitted: activeExamSubmissions.length,
      candidates: liveSessions,
      recentSubmissions: activeExamSubmissions.slice(0, 50)
    });
  }

  // Admin force-submit a candidate from their auto-saved answers (e.g. device crashed)
  if (pathname === '/api/admin/force-submit' && req.method === 'POST') {
    const body = await parseBody(req);
    const regNo = (body.regNo || '').trim();
    const live = db.getLiveSession(regNo);
    if (!live || !live.examId) return sendJSON(res, 400, { success: false, message: 'No active session found for this candidate.' });
    const exam = db.getExamById(live.examId);
    const student = db.getStudents().find(s => s.regNo.toLowerCase() === regNo.toLowerCase());
    if (!exam || !student) return sendJSON(res, 400, { success: false, message: 'Candidate or exam not found.' });
    if (db.getSubmissions().find(s => s.regNo.toLowerCase() === regNo.toLowerCase() && s.examId === exam.id)) {
      return sendJSON(res, 400, { success: false, message: 'This candidate has already submitted.' });
    }
    const answers = live.answers || {};
    const shuffleO = exam.shuffleOptions !== false;
    let score = 0, totalMarks = 0, correctCount = 0, wrongCount = 0, unansweredCount = 0;
    exam.questions.forEach(q => {
      const m = q.marks || 1; totalMarks += m;
      const disp = answers[q.id];
      if (!disp) { unansweredCount++; return; }
      const orig = optionDisplay(q, regNo, shuffleO).perm[disp] || disp;
      if (orig === q.correctAnswer) { correctCount++; score += m; } else wrongCount++;
    });
    const percentage = totalMarks > 0 ? Math.round((score / totalMarks) * 100) : 0;
    const passed = percentage >= (exam.passPercentage || 50);
    const rec = {
      submissionId: 'SUB-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      regNo: student.regNo, studentName: student.name, classLevel: student.classLevel,
      examId: exam.id, examTitle: exam.title, subject: exam.subject,
      session: exam.session || db.getSettings().activeSession || '2025/2026',
      term: exam.term || db.getSettings().activeTerm || '1st Term',
      score, totalMarks, percentage, passed, gradeBand: gradeBand(percentage),
      correctCount, wrongCount, unansweredCount, answers, attempts: 1, maxTrials: examMaxTrials(exam),
      forcedByAdmin: true, submittedAt: new Date().toISOString()
    };
    db.addSubmission(rec);
    db.setLiveSession(regNo, { status: 'SUBMITTED', score, percentage, submittedAt: rec.submittedAt });
    broadcastEvent('student_submitted', rec);
    return sendJSON(res, 200, { success: true, submission: rec });
  }

  // Admin Results
  if (pathname === '/api/admin/results' && req.method === 'GET') {
    const submissions = db.getSubmissions();
    return sendJSON(res, 200, submissions);
  }

  // Backup: download the whole terminal's data as one JSON bundle
  if (pathname === '/api/admin/backup' && req.method === 'GET') {
    return sendJSON(res, 200, db.exportAll());
  }

  // Restore: load a backup bundle back onto this terminal
  if (pathname === '/api/admin/restore' && req.method === 'POST') {
    const body = await parseBody(req);
    try {
      const r = db.importAll(body);
      broadcastEvent('branding_updated', db.getSettings());
      broadcastEvent('students_updated', { count: r.students });
      return sendJSON(res, 200, { success: true, ...r });
    } catch (e) {
      return sendJSON(res, 400, { success: false, message: e.message });
    }
  }

  // Admin manual score override (regrade a single result)
  if (pathname === '/api/admin/results/override' && req.method === 'POST') {
    const body = await parseBody(req);
    const sub = db.getSubmissions().find(s => s.submissionId === body.submissionId);
    if (!sub) return sendJSON(res, 404, { success: false, message: 'Submission not found.' });
    let score = parseFloat(body.score);
    if (isNaN(score)) return sendJSON(res, 400, { success: false, message: 'Enter a valid score.' });
    score = Math.max(0, Math.min(score, sub.totalMarks || 0));
    const percentage = sub.totalMarks > 0 ? Math.round((score / sub.totalMarks) * 100) : 0;
    const exam = db.getExamById(sub.examId);
    const passed = percentage >= ((exam && exam.passPercentage) || 50);
    const updated = db.updateSubmission(body.submissionId, {
      score, percentage, passed, gradeBand: gradeBand(percentage), manuallyAdjusted: true
    });
    broadcastEvent('student_submitted', updated);
    return sendJSON(res, 200, { success: true, submission: updated });
  }

  // Admin analytics for an exam (averages, pass rate, grade spread, hardest questions)
  if (pathname === '/api/admin/analytics' && req.method === 'GET') {
    const examId = (parsedUrl.query.examId || db.getSettings().activeExamId || '').trim();
    const exam = db.getExamById(examId);
    const subs = db.getSubmissions().filter(s => s.examId === examId);
    const count = subs.length;
    if (!exam || count === 0) {
      return sendJSON(res, 200, { examId, examTitle: exam ? exam.title : null, count: 0 });
    }
    const avg = Math.round(subs.reduce((a, s) => a + (s.percentage || 0), 0) / count);
    const passRate = Math.round((subs.filter(s => s.passed).length / count) * 100);
    const dist = {}; ['A1', 'B2', 'B3', 'C4', 'C5', 'C6', 'D7', 'E8', 'F9'].forEach(g => dist[g] = 0);
    subs.forEach(s => { const g = s.gradeBand || gradeBand(s.percentage || 0); dist[g] = (dist[g] || 0) + 1; });
    const sorted = subs.slice().sort((a, b) => b.percentage - a.percentage);
    const top = sorted[0], low = sorted[sorted.length - 1];
    const shuffleO = exam.shuffleOptions !== false;
    const perQ = (exam.questions || []).map((q, idx) => {
      let correct = 0, answered = 0;
      subs.forEach(s => {
        const disp = (s.answers || {})[q.id];
        if (!disp) return;
        answered++;
        const orig = optionDisplay(q, s.regNo, shuffleO).perm[disp] || disp;
        if (orig === q.correctAnswer) correct++;
      });
      return { index: idx + 1, question: (q.question || '').slice(0, 90), correctPct: answered ? Math.round((correct / answered) * 100) : 0, answered };
    });
    const hardest = perQ.slice().sort((a, b) => a.correctPct - b.correctPct).slice(0, 5);
    return sendJSON(res, 200, {
      examId, examTitle: exam.title, subject: exam.subject, classLevel: exam.classLevel,
      count, avg, passRate, dist,
      top: top ? { name: top.studentName, pct: top.percentage } : null,
      low: low ? { name: low.studentName, pct: low.percentage } : null,
      hardest
    });
  }

  // Admin Get All Registered Students & Login PINs
  if (pathname === '/api/admin/students' && req.method === 'GET') {
    const students = db.getStudents();
    const liveSessions = db.getLiveSessions();
    const submissions = db.getSubmissions();
    const settings = db.getSettings();
    const activeExam = db.getExamById(settings.activeExamId);

    const enriched = students.map(st => {
      const live = liveSessions.find(l => l.regNo.toLowerCase() === st.regNo.toLowerCase());
      const sub = submissions.find(s => s.regNo.toLowerCase() === st.regNo.toLowerCase() && (!activeExam || s.examId === activeExam.id));
      let status = 'not_started';
      let scoreInfo = null;

      if (sub) {
        status = 'submitted';
        scoreInfo = {
          score: sub.score,
          totalMarks: sub.totalMarks,
          percentage: sub.percentage,
          submittedAt: sub.submittedAt
        };
      } else if (live) {
        status = live.status === 'DISCONNECTED' ? 'offline' : 'active';
      }

      return {
        name: st.name,
        regNo: st.regNo,
        pin: st.pin || '1234',
        classLevel: st.classLevel || 'SS 2',
        gender: st.gender || 'Not specified',
        status: status,
        progress: live ? `${live.answeredCount || 0}/${live.totalQuestions || 20}` : null,
        scoreInfo: scoreInfo
      };
    });

    return sendJSON(res, 200, {
      total: students.length,
      schoolName: settings.schoolName,
      schoolCode: settings.schoolCode,
      activeExamTitle: activeExam ? activeExam.title : 'General Examination',
      students: enriched
    });
  }

  // Admin Add or Update Student Candidate
  if (pathname === '/api/admin/students' && req.method === 'POST') {
    const body = await parseBody(req);
    if (!body.name || !body.name.trim()) {
      return sendJSON(res, 400, { success: false, message: 'Student Full Name is required.' });
    }
    let regNo = (body.regNo || '').trim();
    if (!regNo || regNo.toUpperCase() === 'AUTO') {
      regNo = db.getNextRegNo();
    }
    const student = {
      name: body.name.trim(),
      regNo: regNo,
      pin: (body.pin || '1234').trim(),
      classLevel: (body.classLevel || 'SS 2').trim(),
      gender: (body.gender || 'Not specified').trim()
    };
    db.saveStudent(student);
    broadcastEvent('students_updated', { added: 1, student });
    return sendJSON(res, 200, { success: true, student });
  }

  // Admin Delete Student Candidate
  if (pathname === '/api/admin/students' && req.method === 'DELETE') {
    const body = await parseBody(req);
    if (!body.regNo) {
      return sendJSON(res, 400, { success: false, message: 'Registration Number is required.' });
    }
    db.deleteStudent(body.regNo);
    return sendJSON(res, 200, { success: true, message: 'Student removed successfully.' });
  }

  // Admin Bulk Upload Candidate Photos (matched to reg numbers by filename)
  if (pathname === '/api/admin/students/photos' && req.method === 'POST') {
    const body = await parseBody(req);
    const result = db.setStudentPhotos(body.photos || []);
    broadcastEvent('students_updated', { photos: result.matched });
    return sendJSON(res, 200, { success: true, ...result });
  }

  // Admin Bulk Upload Students (CSV / Excel format)
  if (pathname === '/api/admin/students/bulk-upload' && req.method === 'POST') {
    const body = await parseBody(req);
    const studentsList = body.students;
    if (!Array.isArray(studentsList) || studentsList.length === 0) {
      return sendJSON(res, 400, { success: false, message: 'Students array is empty or invalid.' });
    }
    const result = db.bulkSaveStudents(studentsList);
    broadcastEvent('students_updated', { count: result.total, added: result.added, updated: result.updated });
    return sendJSON(res, 200, { success: true, ...result });
  }

  // Admin Promote Students & Class Advancement
  if (pathname === '/api/admin/students/promote' && req.method === 'POST') {
    const body = await parseBody(req);
    if (body.advanceAll) {
      const count = db.advanceAllClasses();
      broadcastEvent('students_updated', { promoted: count });
      return sendJSON(res, 200, { success: true, promoted: count, message: `Successfully advanced ${count} students to their next classes.` });
    } else {
      if (!Array.isArray(body.studentRegNos) || body.studentRegNos.length === 0 || !body.targetClass) {
        return sendJSON(res, 400, { success: false, message: 'Candidate list and target class are required.' });
      }
      const count = db.promoteStudents(body.studentRegNos, body.targetClass);
      broadcastEvent('students_updated', { promoted: count });
      return sendJSON(res, 200, { success: true, promoted: count, message: `Promoted ${count} candidates to ${body.targetClass}.` });
    }
  }

  // Admin Sync Results to Cloud (cbtbycothi.com.ng)
  if (pathname === '/api/admin/sync-to-cloud' && req.method === 'POST') {
    const submissions = db.getSubmissions();
    const settings = db.getSettings();
    const cloudPush = await cothiCloud.pushResultsToCloud(settings.schoolCode, submissions);
    const syncReceipt = {
      success: true,
      livePushed: cloudPush.success,
      recordsSynced: submissions.length,
      timestamp: new Date().toISOString(),
      targetHost: "cbtbycothi.com.ng",
      schoolCode: settings.schoolCode,
      syncId: 'SYNC-' + Math.random().toString(36).substring(2, 9).toUpperCase()
    };
    return sendJSON(res, 200, syncReceipt);
  }

  // Admin OTA (Over-The-Air) Remote Updates Check
  if (pathname === '/api/admin/ota/check' && req.method === 'GET') {
    try {
      const status = await ota.checkForUpdates();
      return sendJSON(res, 200, status);
    } catch (e) {
      return sendJSON(res, 500, { online: false, updateAvailable: false, message: e.message });
    }
  }

  // Admin OTA Apply Update (Pull from Git or Cloud & refresh exam banks)
  if (pathname === '/api/admin/ota/apply' && req.method === 'POST') {
    try {
      const result = await ota.applyUpdate();
      broadcastEvent('system_updated', { timestamp: new Date().toISOString() });
      return sendJSON(res, 200, result);
    } catch (e) {
      return sendJSON(res, 500, { success: false, message: e.message });
    }
  }

  // --- STUDENT KIOSK APIS ---

  // Student Kiosk & Admin Auto-Generated Registration Number
  if ((pathname === '/api/student/next-reg' || pathname === '/api/admin/students/next-reg') && req.method === 'GET') {
    const nextRegNo = db.getNextRegNo();
    const settings = db.getSettings();
    return sendJSON(res, 200, {
      success: true,
      nextRegNo,
      schoolCode: settings.schoolCode,
      schoolName: settings.schoolName
    });
  }

  // Student self-registration (only when the admin has enabled it)
  if (pathname === '/api/student/register' && req.method === 'POST') {
    const settings = db.getSettings();
    if (settings.allowSelfRegister !== true) {
      return sendJSON(res, 403, { success: false, message: 'Self-registration is not enabled. Please see your supervisor.' });
    }
    const body = await parseBody(req);
    const name = (body.name || '').trim();
    if (!name) {
      return sendJSON(res, 400, { success: false, message: 'Please enter your full name.' });
    }
    let regNo = (body.regNo || '').trim();
    if (!regNo || regNo.toUpperCase() === 'AUTO') {
      regNo = db.getNextRegNo();
    }
    const existing = db.getStudents().find(s => s.regNo.toLowerCase() === regNo.toLowerCase());
    if (existing) {
      if (!body.regNo || body.regNo.toUpperCase() === 'AUTO') {
        regNo = db.getNextRegNo();
      } else {
        return sendJSON(res, 200, { success: true, existing: true, message: 'You are already registered — just log in with your PIN.', regNo: existing.regNo, pin: existing.pin });
      }
    }
    const student = db.saveStudent({
      name, regNo,
      pin: (body.pin || '1234').trim(),
      classLevel: (body.classLevel || 'SS 2').trim(),
      gender: (body.gender || 'Not Specified').trim()
    });
    broadcastEvent('students_updated', { added: 1, student });
    return sendJSON(res, 200, {
      success: true,
      regNo: student.regNo,
      pin: student.pin,
      student: { regNo: student.regNo, name: student.name, classLevel: student.classLevel, pin: student.pin }
    });
  }

  // Student Kiosk Login & Verification
  if (pathname === '/api/student/verify' && req.method === 'POST') {
    const body = await parseBody(req);
    const regNo = (body.regNo || '').trim();
    const pin = (body.pin || '').trim();

    const student = db.findStudent(regNo, pin);
    if (!student) {
      return sendJSON(res, 404, { success: false, message: 'Invalid Registration Number or Exam PIN. Please check with your supervisor.' });
    }

    const settings = db.getSettings();
    const activeExam = db.getExamById(settings.activeExamId);
    if (!activeExam) {
      return sendJSON(res, 400, { success: false, message: 'No active exam is currently deployed on this server. Please inform the supervisor.' });
    }

    // Trials: allow re-entry while the candidate still has attempts left.
    const maxTrials = examMaxTrials(activeExam);
    const submissions = db.getSubmissions();
    const prior = submissions.find(s => s.regNo.toLowerCase() === student.regNo.toLowerCase() && s.examId === activeExam.id);
    const usedTrials = prior ? (prior.attempts || 1) : 0;
    if (prior && usedTrials >= maxTrials) {
      return sendJSON(res, 400, {
        success: false,
        alreadySubmitted: true,
        submission: {
          submissionId: prior.submissionId,
          studentName: student.name,
          regNo: student.regNo,
          examTitle: activeExam.title,
          submittedAt: prior.submittedAt
        },
        message: `You have completed all permitted attempt(s) for this examination. Rewriting is not allowed.`
      });
    }

    // One-device lock + crash resume, based on the existing live session.
    const existingLive = db.getLiveSession(student.regNo);
    const now = Date.now();
    const sameExam = existingLive && existingLive.examId === activeExam.id && existingLive.status !== 'SUBMITTED';
    const stillOnline = sameExam && (now - (existingLive.lastSeen || 0) < 25000);

    // Block a second simultaneous login (another device). A crashed device's
    // session goes stale after ~25s, after which re-login is allowed (and resumes).
    if (stillOnline && body.force !== true) {
      return sendJSON(res, 409, {
        success: false,
        alreadyActive: true,
        message: 'This candidate is already logged in on another device. If that device crashed, wait 30 seconds and try again.'
      });
    }

    // Resume: hand back saved answers + remaining time if a prior session exists.
    let resume = null;
    if (sameExam && existingLive.answers && Object.keys(existingLive.answers).length) {
      resume = { answers: existingLive.answers, timeRemaining: existingLive.timeRemaining || (activeExam.durationMinutes * 60) };
    }

    db.setLiveSession(student.regNo, {
      regNo: student.regNo,
      name: student.name,
      classLevel: student.classLevel,
      examId: activeExam.id,
      examTitle: activeExam.title,
      status: resume ? 'WRITING' : 'VERIFIED',
      startedAt: (existingLive && existingLive.startedAt) || new Date().toISOString(),
      answeredCount: resume ? (existingLive.answeredCount || 0) : 0,
      answers: resume ? existingLive.answers : {},
      totalQuestions: activeExam.questions.length,
      timeRemaining: resume ? resume.timeRemaining : activeExam.durationMinutes * 60
    });

    broadcastEvent('student_joined', { regNo: student.regNo, name: student.name });

    return sendJSON(res, 200, {
      success: true,
      student: {
        regNo: student.regNo,
        name: student.name,
        classLevel: student.classLevel,
        gender: student.gender,
        photo: student.photo || null
      },
      branding: {
        schoolName: settings.schoolName,
        schoolMotto: settings.schoolMotto,
        schoolLogo: settings.schoolLogo,
        primaryColor: settings.primaryColor,
        accentColor: settings.accentColor
      },
      exam: {
        id: activeExam.id,
        title: activeExam.title,
        subject: activeExam.subject,
        classLevel: activeExam.classLevel,
        session: activeExam.session || settings.activeSession || '2025/2026',
        term: activeExam.term || settings.activeTerm || '1st Term',
        durationMinutes: activeExam.durationMinutes,
        instructions: activeExam.instructions,
        totalQuestions: activeExam.questions.length,
        maxTrials: maxTrials,
        trialsUsed: usedTrials
      },
      resume: resume
    });
  }

  // Student Fetch Questions (Crucial: Correct answer keys are STRIPPED so students cannot view-source/cheat)
  if (pathname === '/api/student/exam' && req.method === 'GET') {
    const settings = db.getSettings();
    const activeExam = db.getExamById(settings.activeExamId);
    if (!activeExam) {
      return sendJSON(res, 404, { success: false, message: 'Active exam not found' });
    }

    // Per-candidate anti-cheat shuffling (deterministic by regNo so it survives reloads)
    const regNo = (parsedUrl.query.regNo || '').trim();
    const shuffleQ = activeExam.shuffleQuestions !== false; // default ON
    const shuffleO = activeExam.shuffleOptions !== false;   // default ON

    let sanitizedQuestions = activeExam.questions.map(q => {
      const disp = optionDisplay(q, regNo, shuffleO);
      return {
        id: q.id,
        question: q.question,
        options: disp.options,                 // relabelled to the student's display order
        image: q.image || null,
        optionImages: disp.optionImages,
        passageId: q.passageId || null,
        marks: q.marks || 1
      };
    });
    if (shuffleQ && regNo) sanitizedQuestions = seededShuffle(sanitizedQuestions, regNo + '|' + activeExam.id + '|q');
    sanitizedQuestions = sanitizedQuestions.map((q, i) => ({ index: i + 1, ...q }));

    // Reading / cloze passages carry no answer keys, so they are safe to send whole.
    const passages = Array.isArray(activeExam.passages) ? activeExam.passages : [];

    return sendJSON(res, 200, {
      examId: activeExam.id,
      title: activeExam.title,
      durationMinutes: activeExam.durationMinutes,
      questions: sanitizedQuestions,
      passages: passages
    });
  }

  // Student Heartbeat / Answer Progress (Keep-alive + Admin live progress)
  if (pathname === '/api/student/heartbeat' && req.method === 'POST') {
    const body = await parseBody(req);
    const regNo = (body.regNo || '').trim();
    if (regNo) {
      const existing = db.getLiveSession(regNo) || {};
      const student = db.getStudents().find(s => s.regNo.toLowerCase() === regNo.toLowerCase()) || {};
      const updated = {
        ...existing,
        regNo: regNo,
        name: existing.name || student.name || regNo,
        classLevel: existing.classLevel || student.classLevel || '',
        examId: body.examId || existing.examId,
        answeredCount: typeof body.answeredCount === 'number' ? body.answeredCount : (existing.answeredCount || 0),
        currentQuestion: body.currentQuestion || existing.currentQuestion || 1,
        timeRemaining: typeof body.timeRemaining === 'number' ? body.timeRemaining : (existing.timeRemaining || 0),
        // Server-side auto-save of answers → enables crash resume + "not submitted" recovery
        answers: (body.answers && typeof body.answers === 'object') ? body.answers : (existing.answers || {}),
        status: existing.status === 'SUBMITTED' ? 'SUBMITTED' : 'WRITING',
        lastSeen: Date.now()
      };
      db.setLiveSession(regNo, updated);
      broadcastEvent('student_progress', {
        regNo: regNo,
        name: updated.name,
        answeredCount: updated.answeredCount,
        currentQuestion: updated.currentQuestion,
        timeRemaining: updated.timeRemaining,
        status: updated.status
      });
    }
    return sendJSON(res, 200, { status: 'ack' });
  }

  // Student Instant Submit (Evaluates score in < 5ms and broadcasts instantly to Admin)
  if (pathname === '/api/student/submit' && req.method === 'POST') {
    const body = await parseBody(req);
    const regNo = (body.regNo || '').trim();
    const examId = body.examId;
    const answers = body.answers || {}; // { questionId: selectedOption }

    const exam = db.getExamById(examId);
    const student = db.getStudents().find(s => s.regNo.toLowerCase() === regNo.toLowerCase());

    if (!exam || !student) {
      return sendJSON(res, 400, { success: false, message: 'Invalid submission data.' });
    }

    // Trials: a candidate may attempt up to exam.maxTrials times (default 1).
    const maxTrials = examMaxTrials(exam);
    const priorSubmission = db.getSubmissions().find(s =>
      s.regNo.toLowerCase() === student.regNo.toLowerCase() && s.examId === exam.id
    );
    const usedTrials = priorSubmission ? (priorSubmission.attempts || 1) : 0;
    if (usedTrials >= maxTrials) {
      return sendJSON(res, 400, {
        success: false,
        alreadySubmitted: true,
        message: `No exam trials remaining (used ${usedTrials} of ${maxTrials}).`
      });
    }

    // Instant Score Calculation (map each displayed answer back to the real option)
    const shuffleO = exam.shuffleOptions !== false;
    let score = 0, totalMarks = 0, correctCount = 0, wrongCount = 0, unansweredCount = 0;

    exam.questions.forEach(q => {
      const qMarks = q.marks || 1;
      totalMarks += qMarks;
      const displayedPick = answers[q.id];      // the A/B/C/D the student saw & chose
      if (!displayedPick) { unansweredCount++; return; }
      const perm = optionDisplay(q, student.regNo, shuffleO).perm; // displayLetter -> originalLetter
      const originalPick = perm[displayedPick] || displayedPick;
      if (originalPick === q.correctAnswer) { correctCount++; score += qMarks; }
      else { wrongCount++; }
    });

    let percentage = totalMarks > 0 ? Math.round((score / totalMarks) * 100) : 0;
    let thisAttempt = { score, totalMarks, percentage, correctCount, wrongCount, unansweredCount, answers };

    // Best-of-N: keep the highest-scoring attempt's figures.
    let keep = thisAttempt;
    if (priorSubmission && priorSubmission.score > score) {
      keep = {
        score: priorSubmission.score, totalMarks: priorSubmission.totalMarks, percentage: priorSubmission.percentage,
        correctCount: priorSubmission.correctCount, wrongCount: priorSubmission.wrongCount,
        unansweredCount: priorSubmission.unansweredCount, answers: priorSubmission.answers
      };
    }
    const passed = keep.percentage >= (exam.passPercentage || 50);
    const attemptsNow = usedTrials + 1;

    const submissionRecord = {
      submissionId: 'SUB-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      regNo: student.regNo,
      studentName: student.name,
      classLevel: student.classLevel,
      examId: exam.id,
      examTitle: exam.title,
      subject: exam.subject,
      session: exam.session || db.getSettings().activeSession || '2025/2026',
      term: exam.term || db.getSettings().activeTerm || '1st Term',
      score: keep.score,
      totalMarks: keep.totalMarks,
      percentage: keep.percentage,
      passed: passed,
      gradeBand: gradeBand(keep.percentage),
      correctCount: keep.correctCount,
      wrongCount: keep.wrongCount,
      unansweredCount: keep.unansweredCount,
      answers: keep.answers,
      attempts: attemptsNow,
      maxTrials: maxTrials,
      submittedAt: new Date().toISOString()
    };

    // Save submission immediately
    db.addSubmission(submissionRecord);

    // Update live session to SUBMITTED
    db.setLiveSession(student.regNo, {
      status: 'SUBMITTED',
      score: score,
      percentage: percentage,
      submittedAt: submissionRecord.submittedAt
    });

    // Broadcast instant drop to all Admin dashboards!
    broadcastEvent('student_submitted', submissionRecord);

    console.log(`[INSTANT SUBMIT] ${student.name} (${student.regNo}) scored ${score}/${totalMarks} (${percentage}%) in ${exam.title}`);

    // Return instant confirmation receipt to student (scores strictly withheld from candidate view)
    return sendJSON(res, 200, {
      success: true,
      message: 'Your examination responses have been submitted successfully.',
      receipt: {
        submissionId: submissionRecord.submissionId,
        studentName: student.name,
        regNo: student.regNo,
        examTitle: exam.title,
        submittedAt: submissionRecord.submittedAt,
        attempt: attemptsNow,
        maxTrials: maxTrials,
        trialsRemaining: maxTrials - attemptsNow
      }
    });
  }

  // --- STATIC FILE SERVING & CLEAN REDIRECTS ---

  if (pathname === '/' || pathname === '/student') {
    res.writeHead(302, { 'Location': '/student/' });
    return res.end();
  }

  if (pathname === '/admin') {
    res.writeHead(302, { 'Location': '/admin/' });
    return res.end();
  }

  let filePath = path.join(PUBLIC_DIR, pathname);

  // If path is a directory, append index.html
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    // 404 handler
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  }
});

// ---- Anti-cheat shuffling, grading band, trials helpers --------------------
function hashStr(s) { let h = 2166136261 >>> 0; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function seededShuffle(arr, seed) { const a = arr.slice(); const rng = mulberry32(hashStr(seed)); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
function presentLetters(q) {
  return ['A', 'B', 'C', 'D'].filter(L =>
    (q.options && q.options[L] != null && String(q.options[L]).trim() !== '') ||
    (q.optionImages && q.optionImages[L]));
}
// Deterministic per-candidate option order. Returns the options as the student
// sees them (relabelled A..) plus perm: displayLetter -> originalLetter (for grading).
function optionDisplay(q, regNo, shuffle) {
  const letters = presentLetters(q);
  const order = (shuffle && regNo) ? seededShuffle(letters, regNo + '|' + q.id + '|opt') : letters.slice();
  const options = {}, optionImages = {}, perm = {};
  order.forEach((origL, i) => {
    const dispL = String.fromCharCode(65 + i);
    options[dispL] = q.options ? (q.options[origL] || '') : '';
    if (q.optionImages && q.optionImages[origL]) optionImages[dispL] = q.optionImages[origL];
    perm[dispL] = origL;
  });
  return { options, optionImages: Object.keys(optionImages).length ? optionImages : null, perm };
}
// WAEC-style grade band from a percentage.
function gradeBand(pct) {
  if (pct >= 75) return 'A1'; if (pct >= 70) return 'B2'; if (pct >= 65) return 'B3';
  if (pct >= 60) return 'C4'; if (pct >= 55) return 'C5'; if (pct >= 50) return 'C6';
  if (pct >= 45) return 'D7'; if (pct >= 40) return 'E8'; return 'F9';
}
function examMaxTrials(exam) { return (exam && exam.maxTrials && exam.maxTrials > 0) ? Math.floor(exam.maxTrials) : 1; }

// Periodically pull the latest school directory and push results to the COTHI
// cloud — but only when the admin has turned auto-sync on (and only helps when
// the school PC currently has internet; it fails quietly otherwise).
function runCloudAutoSync() {
  try {
    const s = db.getSettings();
    if (s.autoCloudSync !== true) return;
    cothiCloud.refreshSchoolsFromCloud().catch(() => {});
    const subs = db.getSubmissions();
    if (subs.length) cothiCloud.pushResultsToCloud(s.schoolCode, subs).catch(() => {});
    const customSchools = db.getCustomSchools();
    (customSchools || []).forEach(cs => cothiCloud.pushSchoolToCloud(cs).catch(() => {}));
  } catch (e) { /* never throws */ }
}

// Build the "active exam" broadcast payload for a given exam object.
function activePayloadFor(exam) {
  if (!exam) return null;
  const settings = db.getSettings();
  return {
    id: exam.id,
    title: exam.title,
    subject: exam.subject,
    classLevel: exam.classLevel,
    session: exam.session || settings.activeSession || '2025/2026',
    term: exam.term || settings.activeTerm || '1st Term',
    durationMinutes: exam.durationMinutes,
    totalQuestions: (exam.questions || []).length
  };
}

// Auto-activate / auto-end scheduled exams based on the server clock (local time).
// An exam with scheduledStart goes live at that moment and ends after its duration
// (or scheduledEnd, if set). Exams without a schedule are never touched here.
function runExamScheduler() {
  try {
    const exams = db.getExams();
    const settings = db.getSettings();
    const now = Date.now();

    let shouldBeLive = null;
    for (const e of exams) {
      if (!e.scheduledStart) continue;
      const start = new Date(e.scheduledStart).getTime();
      if (isNaN(start)) continue;
      const end = e.scheduledEnd ? new Date(e.scheduledEnd).getTime()
                                 : start + (e.durationMinutes || 60) * 60000;
      if (now >= start && now < end) { shouldBeLive = e; break; }
    }

    if (shouldBeLive) {
      if (settings.activeExamId !== shouldBeLive.id) {
        db.saveSettings({
          activeExamId: shouldBeLive.id,
          activeSession: shouldBeLive.session || settings.activeSession,
          activeTerm: shouldBeLive.term || settings.activeTerm
        });
        broadcastEvent('exam_changed', activePayloadFor(shouldBeLive));
        console.log(`[SCHEDULER] Auto-activated scheduled exam: ${shouldBeLive.title}`);
      }
    } else {
      // If the active exam is a scheduled one whose window has passed, end it.
      const active = exams.find(e => e.id === settings.activeExamId);
      if (active && active.scheduledStart) {
        const start = new Date(active.scheduledStart).getTime();
        const end = active.scheduledEnd ? new Date(active.scheduledEnd).getTime()
                                        : start + (active.durationMinutes || 60) * 60000;
        if (!isNaN(start) && now >= end) {
          db.saveSettings({ activeExamId: null });
          broadcastEvent('exam_changed', null);
          console.log(`[SCHEDULER] Auto-ended scheduled exam: ${active.title}`);
        }
      }
    }
  } catch (e) { /* scheduler never crashes the server */ }
}

function startServer() {
  const logFile = path.join(path.dirname(process.execPath), 'server_startup.log');
  function logSrv(msg) {
    try { fs.appendFileSync(logFile, `[SERVER ${new Date().toISOString()}] ${msg}\n`); } catch(e) {}
  }
  logSrv(`startServer() invoked. Attempting server.listen(${PORT}, '0.0.0.0')...`);

  server.on('error', (err) => {
    logSrv(`server error event: ${err.message} code=${err.code}`);
    if (err.code === 'EADDRINUSE') {
      console.log(`[INFO] Port ${PORT} is already in use by an existing server instance. Connecting to it.`);
    } else {
      console.error('Server error:', err);
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    logSrv(`server.listen success on 0.0.0.0:${PORT}`);
    // Start UDP LAN Auto-discovery
    try {
      startDiscoveryService(PORT);
      logSrv('startDiscoveryService called');
    } catch (discErr) {
      logSrv('startDiscoveryService error: ' + discErr.message);
    }
    // Exam auto-scheduler: check every 20s for exams due to go live / end
    try {
      runExamScheduler();
      setInterval(runExamScheduler, 20000);
      logSrv('exam scheduler started');
    } catch (schErr) {
      logSrv('scheduler error: ' + schErr.message);
    }
    // Cloud auto-sync (only when enabled): refresh schools + push results every 30 min
    try {
      setTimeout(runCloudAutoSync, 60000);
      setInterval(runCloudAutoSync, 30 * 60 * 1000);
      logSrv('cloud auto-sync timer started');
    } catch (csErr) {
      logSrv('cloud auto-sync error: ' + csErr.message);
    }
    const ips = getLocalIps();
    logSrv(`Local IPs: ${JSON.stringify(ips)}`);
    console.log('====================================================');
    console.log(` COTHI OFFLINE CBT SERVER IS ACTIVE`);
    console.log(` Listening on all network interfaces on port ${PORT}`);
    console.log('====================================================');
    console.log(` Admin Control Panel: http://localhost:${PORT}/admin/`);
    if (ips.length > 0) {
      console.log(` Student Exam Kiosk URL for LAN/Wi-Fi devices:`);
      ips.forEach(i => console.log(`  -> http://${i.ip}:${PORT}/student/ (${i.name})`));
    } else {
      console.log(` Connect your Admin PC to a Wi-Fi router to let students connect!`);
    }
    console.log('====================================================');
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { server, startServer, getLocalIps, PORT };
