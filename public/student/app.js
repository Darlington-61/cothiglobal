// COTHI Student Examination Controller
let serverHost = (typeof window !== 'undefined' && window.location && window.location.protocol.startsWith('http') && window.location.host)
  ? window.location.origin
  : 'http://localhost:8000';
let currentStudent = null;
let currentExam = null;
let questions = [];
let currentQuestionIndex = 0;
let studentAnswers = {};
let flaggedQuestions = new Set();
let timerInterval = null;
let heartbeatInterval = null;
let secondsRemaining = 0;
let isSubmitting = false;
let hasWarned5Min = false;
let hasWarned1Min = false;
let warningBannerTimeout = null;

// DOM View Elements
const viewLogin = document.getElementById('viewLogin');
const viewVerify = document.getElementById('viewVerify');
const viewExam = document.getElementById('viewExam');
const viewReceipt = document.getElementById('viewReceipt');

function showView(viewEl) {
  [viewLogin, viewVerify, viewExam, viewReceipt].forEach(v => v.classList.remove('active'));
  viewEl.classList.add('active');
}

// 1. Initialize Configuration & Branding
async function initApp() {
  if (window.cbtAPI && window.cbtAPI.getConfig) {
    try {
      const config = await window.cbtAPI.getConfig();
      if (config.serverUrl) serverHost = config.serverUrl;
      if (config.school) applySchoolBranding(config.school);

      // Listen for LAN Auto-Discovery
      window.cbtAPI.onServerDiscovered((payload) => {
        console.log('LAN Auto-Discovery event:', payload);
        if (payload.serverUrl) {
          serverHost = payload.serverUrl;
        }
        if (payload.school) {
          applySchoolBranding(payload.school);
        }
        const dot = document.getElementById('serverStatusDot');
        const label = document.getElementById('serverStatusLabel');
        dot.className = 'status-indicator online';
        label.textContent = `Auto-Detected: ${payload.school ? payload.school.name : new URL(serverHost).hostname}`;
      });
    } catch (e) {
      console.warn('Electron IPC config failed, using defaults');
    }
  }

  // Check connection to serverHost
  checkServerConnection();
}

async function checkServerConnection() {
  const dot = document.getElementById('serverStatusDot');
  const label = document.getElementById('serverStatusLabel');
  const helper = document.getElementById('serverConnHelper');
  const quickInput = document.getElementById('quickServerInput');

  try {
    const res = await fetch(`${serverHost}/api/status`);
    const data = await res.json();
    if (dot) dot.className = 'status-indicator online';
    if (label) label.textContent = `Connected: ${new URL(serverHost).hostname}`;
    if (helper) helper.style.display = 'none';

    if (data.branding) {
      applySchoolBranding(data.branding);
    }
    const reg = document.getElementById('selfRegisterSection');
    if (reg) reg.style.display = data.allowSelfRegister ? 'block' : 'none';
    connectStudentLiveEvents();
    return true;
  } catch (err) {
    if (dot) dot.className = 'status-indicator offline';
    if (label) label.textContent = 'Host Offline (Click to set IP)';
    if (helper) {
      helper.style.display = 'block';
      if (quickInput && !quickInput.value) {
        quickInput.value = serverHost.replace(/^https?:\/\//, '');
      }
    }
    return false;
  }
}

async function quickConnectServer() {
  const input = document.getElementById('quickServerInput');
  const msg = document.getElementById('quickConnMsg');
  if (!input) return;

  let val = input.value.trim();
  if (!val) return;
  if (!val.startsWith('http')) val = 'http://' + val;

  if (msg) {
    msg.style.color = '#2563eb';
    msg.textContent = 'Testing connection...';
  }

  try {
    const res = await fetch(`${val}/api/status`);
    const data = await res.json();
    if (data.status === 'online') {
      serverHost = val;
      if (window.cbtAPI && window.cbtAPI.saveConfig) {
        const config = await window.cbtAPI.getConfig();
        config.serverUrl = serverHost;
        await window.cbtAPI.saveConfig(config);
      }
      if (data.branding) applySchoolBranding(data.branding);
      if (msg) {
        msg.style.color = '#15803d';
        msg.textContent = `Connected to ${data.branding ? data.branding.schoolName : 'Server'}!`;
      }
      setTimeout(() => {
        const helper = document.getElementById('serverConnHelper');
        if (helper) helper.style.display = 'none';
      }, 1200);
      checkServerConnection();
    } else {
      throw new Error('Not a CBT server');
    }
  } catch (e) {
    if (msg) {
      msg.style.color = '#dc2626';
      msg.textContent = `Cannot reach server at ${val}. Verify IP and Wi-Fi.`;
    }
  }
}

async function quickAutoDetectServer() {
  const msg = document.getElementById('quickConnMsg');
  if (msg) {
    msg.style.color = '#2563eb';
    msg.textContent = 'Scanning Wi-Fi network for CBT Server...';
  }

  if (window.cbtAPI && window.cbtAPI.scanNetwork) {
    try {
      const found = await window.cbtAPI.scanNetwork();
      if (found && found.serverUrl) {
        serverHost = found.serverUrl;
        const input = document.getElementById('quickServerInput');
        if (input) input.value = serverHost.replace(/^https?:\/\//, '');
        if (found.school) applySchoolBranding(found.school);
        if (msg) {
          msg.style.color = '#15803d';
          msg.textContent = `Found ${found.school ? found.school.name : 'Server'} at ${found.serverUrl}!`;
        }
        setTimeout(() => {
          const helper = document.getElementById('serverConnHelper');
          if (helper) helper.style.display = 'none';
        }, 1500);
        checkServerConnection();
        return;
      }
    } catch (e) {}
  }

  if (window.cbtAPI && window.cbtAPI.discoverServer) {
    window.cbtAPI.discoverServer();
  }

  if (msg) {
    msg.style.color = '#b45309';
    msg.textContent = 'Scan completed. If not auto-detected, please type the IP shown on teacher screen.';
  }
}

function applySchoolBranding(branding) {
  if (!branding) return;
  const name = branding.schoolName || branding.name;
  if (name) {
    const el = document.getElementById('kioskSchoolName');
    if (el) el.textContent = name;
    const cardEl = document.getElementById('cardSchoolName');
    if (cardEl) cardEl.textContent = name;
  }
  const motto = branding.schoolMotto || branding.motto;
  if (motto) {
    const el = document.getElementById('kioskSchoolMotto');
    if (el) el.textContent = motto;
    const cardEl = document.getElementById('cardSchoolMotto');
    if (cardEl) cardEl.textContent = motto;
  }
  const logo = (branding.schoolLogo || branding.logo || '').trim();
  const logoImg = document.getElementById('kioskSchoolLogo');
  const fallback = document.getElementById('kioskLogoFallback');
  const cardLogoImg = document.getElementById('cardSchoolLogo');
  const cardFallback = document.getElementById('cardLogoFallback');

  if (logo) {
    if (logoImg) { logoImg.src = logo; logoImg.style.display = 'block'; }
    if (fallback) fallback.style.display = 'none';
    if (cardLogoImg) { cardLogoImg.src = logo; cardLogoImg.style.display = 'block'; }
    if (cardFallback) cardFallback.style.display = 'none';
  } else {
    if (logoImg) { logoImg.src = ''; logoImg.style.display = 'none'; }
    if (fallback) fallback.style.display = 'block';
    if (cardLogoImg) { cardLogoImg.src = ''; cardLogoImg.style.display = 'none'; }
    if (cardFallback) cardFallback.style.display = 'block';
  }
  if (branding.primaryColor) {
    document.documentElement.style.setProperty('--primary', branding.primaryColor);
  }
  if (branding.accentColor) {
    document.documentElement.style.setProperty('--accent', branding.accentColor);
  }
}

let studentEventSource = null;

function connectStudentLiveEvents() {
  if (studentEventSource) {
    try { studentEventSource.close(); } catch (e) {}
  }
  try {
    studentEventSource = new EventSource(`${serverHost}/api/events`);
    studentEventSource.addEventListener('exam_changed', () => {
      fetch(`${serverHost}/api/status`)
        .then(r => r.json())
        .then(data => {
          if (data.branding) applySchoolBranding(data.branding);
        }).catch(() => {});
    });
    studentEventSource.addEventListener('branding_updated', () => {
      fetch(`${serverHost}/api/status`)
        .then(r => r.json())
        .then(data => {
          if (data.branding) applySchoolBranding(data.branding);
        }).catch(() => {});
    });
  } catch (e) {}
}

// 2. Candidate Login
function toggleRegisterForm() {
  const f = document.getElementById('registerForm');
  if (f) f.style.display = (f.style.display === 'none' || !f.style.display) ? 'block' : 'none';
}

async function registerCandidate() {
  const name = document.getElementById('regNameInput').value.trim();
  const regNo = document.getElementById('regRegNoInput').value.trim();
  const classLevel = document.getElementById('regClassInput').value.trim();
  const alertBox = document.getElementById('registerAlert');
  alertBox.style.display = 'none';
  if (!name || !regNo) { alertBox.textContent = 'Enter your full name and registration number.'; alertBox.style.display = 'block'; return; }
  try {
    const res = await fetch(`${serverHost}/api/student/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, regNo, classLevel })
    });
    const data = await res.json();
    if (!res.ok || !data.success) { alertBox.textContent = data.message || 'Registration failed. See your supervisor.'; alertBox.style.display = 'block'; return; }
    const pin = data.pin || '1234';
    document.getElementById('regNoInput').value = regNo;
    document.getElementById('pinInput').value = pin;
    document.getElementById('registerForm').style.display = 'none';
    alert('Registered successfully!\n\nYour Exam PIN is: ' + pin + '\n\nNow press "Login to Exam" to begin.');
  } catch (e) {
    alertBox.textContent = 'Cannot reach the exam server.'; alertBox.style.display = 'block';
  }
}

async function handleKioskLogin(e) {
  e.preventDefault();
  const regNo = document.getElementById('regNoInput').value.trim();
  const pin = document.getElementById('pinInput').value.trim();
  const alertBox = document.getElementById('loginAlert');
  const btn = document.getElementById('btnVerify');

  alertBox.style.display = 'none';
  btn.disabled = true;
  btn.innerHTML = '<span>Logging In...</span>';

  try {
    const res = await fetch(`${serverHost}/api/student/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ regNo, pin })
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      alertBox.textContent = data.message || 'Authentication failed. Please verify your Registration Number and PIN.';
      alertBox.style.display = 'block';
      btn.disabled = false;
      btn.innerHTML = '<span>Login to Exam</span>';
      return;
    }

    currentStudent = data.student;
    currentExam = data.exam;
    window._resume = data.resume || null; // server-saved answers + time (crash resume on a new device)
    if (data.branding) applySchoolBranding(data.branding);

    // Populate Candidate Verification Screen
    document.getElementById('bioName').textContent = currentStudent.name;
    document.getElementById('bioRegNo').textContent = currentStudent.regNo;
    document.getElementById('bioClass').textContent = currentStudent.classLevel;
    (function(){ const ph=document.getElementById('bioPhoto'); if(ph){ if(currentStudent.photo){ ph.src=currentStudent.photo; ph.style.display='block'; } else { ph.style.display='none'; ph.removeAttribute('src'); } } })();
    const sessionTerm = (currentExam.session ? currentExam.session + ' • ' : '') + (currentExam.term || '');
    document.getElementById('bioSubject').textContent = currentExam.title + (sessionTerm ? ` (${sessionTerm})` : '');
    document.getElementById('bioDuration').textContent = `${currentExam.durationMinutes} Minutes`;
    document.getElementById('bioTotalQ').textContent = `${currentExam.totalQuestions} Questions`;

    showView(viewVerify);

  } catch (err) {
    alertBox.textContent = `Cannot reach CBT Server at ${serverHost}. Please verify that the Admin Server application is running.`;
    alertBox.style.display = 'block';
    btn.disabled = false;
    btn.innerHTML = '<span>Login to Exam</span>';
  }
}

function logoutCandidate() {
  currentStudent = null;
  currentExam = null;
  questions = [];
  studentAnswers = {};
  flaggedQuestions.clear();
  clearInterval(timerInterval);
  clearInterval(heartbeatInterval);
  dismissTimeWarning();
  hasWarned5Min = false;
  hasWarned1Min = false;

  document.getElementById('topCandidateTag').style.display = 'none';
  document.getElementById('topTimerBox').style.display = 'none';
  document.getElementById('btnVerify').disabled = false;
  document.getElementById('btnVerify').innerHTML = '<span>Login to Exam</span>';

  showView(viewLogin);
}

// Heartbeat & Live Progress Transceiver
async function sendStudentHeartbeat() {
  if (!currentStudent || !currentExam) return;

  const answeredCount = Object.keys(studentAnswers).filter(k => studentAnswers[k]).length;
  const currentQNum = currentQuestionIndex + 1;

  try {
    await fetch(`${serverHost}/api/student/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        regNo: currentStudent.regNo,
        examId: currentExam.id,
        answeredCount: answeredCount,
        currentQuestion: currentQNum,
        timeRemaining: secondsRemaining,
        answers: studentAnswers
      })
    });
  } catch (err) {
    // Non-blocking background keep-alive
  }
}

// 3. Start Exam
async function startExamSession() {
  try {
    const res = await fetch(`${serverHost}/api/student/exam?regNo=${encodeURIComponent(currentStudent.regNo)}`);
    const data = await res.json();
    questions = data.questions || [];
    window._passages = {};
    (data.passages || []).forEach(p => { if (p && p.id) window._passages[p.id] = p; });

    // Restore answers: prefer this device's local cache; otherwise use the
    // server's auto-saved copy (crash resume after moving to another device).
    const cacheKey = `cbt_answers_${currentExam.id}_${currentStudent.regNo}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try { studentAnswers = JSON.parse(cached); } catch (e) {}
    } else if (window._resume && window._resume.answers) {
      studentAnswers = window._resume.answers;
    }

    // Top Header info
    document.getElementById('topCandidateName').textContent = currentStudent.name;
    document.getElementById('topCandidateReg').textContent = currentStudent.regNo;
    document.getElementById('topCandidateTag').style.display = 'flex';
    document.getElementById('topTimerBox').style.display = 'flex';

    // Start Timer — resume remaining time if we have it
    const timerKey = `cbt_timer_${currentExam.id}_${currentStudent.regNo}`;
    const savedTime = localStorage.getItem(timerKey);
    const resumeTime = (window._resume && typeof window._resume.timeRemaining === 'number') ? window._resume.timeRemaining : null;
    secondsRemaining = savedTime ? parseInt(savedTime) : (resumeTime != null ? resumeTime : (currentExam.durationMinutes || 45) * 60);
    hasWarned5Min = (secondsRemaining <= 300);
    hasWarned1Min = (secondsRemaining <= 60);
    dismissTimeWarning();
    runTimer(timerKey);

    showView(viewExam);
    renderQuestion(0);
    renderPalette();

    // Broadcast immediate start & begin periodic heartbeats
    sendStudentHeartbeat();
    clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(sendStudentHeartbeat, 3000);

  } catch (err) {
    alert('Failed to load questions from server.');
  }
}

function runTimer(storageKey) {
  clearInterval(timerInterval);
  updateTimerText();

  timerInterval = setInterval(() => {
    secondsRemaining--;
    localStorage.setItem(storageKey, secondsRemaining);
    updateTimerText();

    // 5-Minute Warning (300 seconds)
    if (secondsRemaining <= 300 && secondsRemaining > 60 && !hasWarned5Min) {
      hasWarned5Min = true;
      playWarningChime(false);
      showTimeWarningBanner('⚠️ 5 Minutes Remaining! Please review your answers and prepare to submit.', 'warning-5min', 8000);
    }

    // 1-Minute Critical Warning (60 seconds)
    if (secondsRemaining <= 60 && secondsRemaining > 0 && !hasWarned1Min) {
      hasWarned1Min = true;
      playWarningChime(true);
      showTimeWarningBanner('🚨 1 Minute Remaining! Examination will submit automatically when time expires.', 'warning-1min', 10000);
    }

    if (secondsRemaining <= 0) {
      clearInterval(timerInterval);
      dismissTimeWarning();
      alert('Time is up! Your responses will now be submitted automatically.');
      executeFinalSubmit();
    }
  }, 1000);
}

function updateTimerText() {
  const h = Math.floor(secondsRemaining / 3600);
  const m = Math.floor((secondsRemaining % 3600) / 60);
  const s = secondsRemaining % 60;
  document.getElementById('topTimerVal').textContent =
    `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

  const timerBox = document.getElementById('topTimerBox');
  if (timerBox) {
    if (secondsRemaining <= 60) {
      timerBox.classList.remove('timer-urgent');
      timerBox.classList.add('timer-critical');
    } else if (secondsRemaining <= 300) {
      timerBox.classList.add('timer-urgent');
      timerBox.classList.remove('timer-critical');
    } else {
      timerBox.classList.remove('timer-urgent', 'timer-critical');
    }
  }
}

// Gentle audio chimes synthesized directly via standard Web Audio API (100% offline)
function playWarningChime(isCritical = false) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    const tones = isCritical ? [660, 880, 1175] : [587, 880];
    tones.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.16);
      gain.gain.setValueAtTime(0, now + idx * 0.16);
      gain.gain.linearRampToValueAtTime(0.22, now + idx * 0.16 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.16 + 0.32);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.16);
      osc.stop(now + idx * 0.16 + 0.34);
    });
  } catch (e) {
    // Audio unsupported or blocked, fails silently
  }
}

function showTimeWarningBanner(message, className, autoDismissMs = 8000) {
  const banner = document.getElementById('timeWarningBanner');
  if (!banner) return;
  const textEl = document.getElementById('timeWarningText');
  if (textEl) textEl.textContent = message;
  banner.className = `exam-warning-banner ${className}`;
  banner.style.display = 'flex';
  if (warningBannerTimeout) clearTimeout(warningBannerTimeout);
  if (autoDismissMs > 0) {
    warningBannerTimeout = setTimeout(dismissTimeWarning, autoDismissMs);
  }
}

function dismissTimeWarning() {
  const banner = document.getElementById('timeWarningBanner');
  if (banner) banner.style.display = 'none';
  if (warningBannerTimeout) {
    clearTimeout(warningBannerTimeout);
    warningBannerTimeout = null;
  }
}

// Full CBT Exam Hotkey Navigation (JAMB/WAEC standard)
function handleExamHotkeys(e) {
  // 1. Never intercept when typing into any input, textarea, or editable element
  const tag = (e.target && e.target.tagName ? e.target.tagName : '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) {
    return;
  }

  // 2. Modals taking precedence
  const exitModal = document.getElementById('modalExit');
  if (exitModal && exitModal.style.display !== 'none') return;

  const serverModal = document.getElementById('modalServerConfig');
  if (serverModal && serverModal.style.display !== 'none') return;

  const calcModal = document.getElementById('calcModal');
  if (calcModal && calcModal.style.display !== 'none') {
    if (e.key === 'Escape' || ((e.key === 'c' || e.key === 'C') && e.altKey)) {
      closeCalculator();
      e.preventDefault();
    }
    return;
  }

  const submitModal = document.getElementById('modalSubmit');
  if (submitModal && submitModal.style.display !== 'none') {
    if (e.key === 'Enter') {
      executeFinalSubmit();
      e.preventDefault();
    } else if (e.key === 'Escape') {
      closeSubmitModal();
      e.preventDefault();
    }
    return;
  }

  // 3. Only active during examination view
  if (!viewExam || !viewExam.classList.contains('active')) return;

  const key = e.key;

  // Escape dismisses warning banner if visible
  if (key === 'Escape') {
    dismissTimeWarning();
    return;
  }

  // Alt+C toggles calculator at any time
  if ((key === 'c' || key === 'C') && e.altKey) {
    openCalculator();
    e.preventDefault();
    return;
  }

  // Option selection: A, B, C, D
  if (/^[a-dA-D]$/.test(key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
    const letter = key.toUpperCase();
    const q = questions[currentQuestionIndex];
    if (q) {
      const hasOpt = (q.options && q.options[letter] !== undefined) || (q.optionImages && q.optionImages[letter] !== undefined);
      if (hasOpt) {
        pickOption(q.id, letter);
        e.preventDefault();
        return;
      }
    }
  }

  // Next question: N, n, ArrowRight
  if (!e.ctrlKey && !e.altKey && (key === 'n' || key === 'N' || key === 'ArrowRight')) {
    if (currentQuestionIndex < questions.length - 1) {
      stepQuestion(1);
      e.preventDefault();
    }
    return;
  }

  // Previous question: P, p, ArrowLeft
  if (!e.ctrlKey && !e.altKey && (key === 'p' || key === 'P' || key === 'ArrowLeft')) {
    if (currentQuestionIndex > 0) {
      stepQuestion(-1);
      e.preventDefault();
    }
    return;
  }

  // Flag question: F, f
  if (!e.ctrlKey && !e.altKey && (key === 'f' || key === 'F')) {
    toggleFlag();
    e.preventDefault();
    return;
  }

  // Submit modal: S, s
  if (!e.ctrlKey && !e.altKey && (key === 's' || key === 'S')) {
    openSubmitModal();
    e.preventDefault();
    return;
  }
}

// Bind keyboard listener once globally
document.addEventListener('keydown', handleExamHotkeys);

// 4. Questions & Navigation

// Render (or clear) the reading passage / cloze pinned above the question.
function renderPassage(qTextEl, passageId) {
  if (!qTextEl || !qTextEl.parentNode) return;
  let holder = document.getElementById('passageHolder');
  if (!holder) {
    holder = document.createElement('div');
    holder.id = 'passageHolder';
    qTextEl.parentNode.insertBefore(holder, qTextEl);
  }
  holder.innerHTML = '';
  const passages = window._passages || {};
  const p = passageId && passages[passageId];
  if (!p || !window.CBTMath) return;
  const box = document.createElement('div');
  box.className = 'cbt-passage';
  if (p.title) {
    const t = document.createElement('div');
    t.className = 'cbt-passage-title';
    CBTMath.applyTo(t, p.title);
    box.appendChild(t);
  }
  if (p.image) { const im = CBTMath.makeImg(p.image, 'cbt-img'); if (im) box.appendChild(im); }
  const body = document.createElement('div');
  CBTMath.renderPassageInto(body, p.text || '');
  box.appendChild(body);
  holder.appendChild(box);
}

// Render (or clear) the optional diagram/image shown above the question text.
function renderQuestionImage(qTextEl, src) {
  if (!qTextEl || !qTextEl.parentNode) return;
  let holder = document.getElementById('qDiagramHolder');
  if (!holder) {
    holder = document.createElement('div');
    holder.id = 'qDiagramHolder';
    qTextEl.parentNode.insertBefore(holder, qTextEl);
  }
  holder.innerHTML = '';
  if (src && window.CBTMath) {
    const im = CBTMath.makeImg(src, 'cbt-img');
    if (im) holder.appendChild(im);
  }
}

function renderQuestion(idx) {
  if (idx < 0 || idx >= questions.length) return;
  currentQuestionIndex = idx;
  const q = questions[idx];

  document.getElementById('qNumberPill').textContent = `Question ${idx + 1} of ${questions.length}`;
  document.getElementById('qMarksPill').textContent = `Marks: ${q.marks || 1}`;

  const qTextEl = document.getElementById('qTextContent');
  renderPassage(qTextEl, q.passageId);
  if (window.CBTMath) CBTMath.applyTo(qTextEl, q.question); else qTextEl.textContent = q.question;
  renderQuestionImage(qTextEl, q.image);

  const optGroup = document.getElementById('optionsGroup');
  optGroup.innerHTML = '';

  ['A', 'B', 'C', 'D'].forEach(letter => {
    const optText = q.options ? q.options[letter] : '';
    const optImg = q.optionImages ? q.optionImages[letter] : '';
    if (!optText && !optImg) return;

    const isSelected = studentAnswers[q.id] === letter;
    const box = document.createElement('div');
    box.className = `option-box ${isSelected ? 'selected' : ''}`;
    box.onclick = () => pickOption(q.id, letter);

    const badge = document.createElement('div');
    badge.className = 'opt-badge';
    badge.textContent = letter;
    const text = document.createElement('div');
    text.className = 'opt-text';
    // Render math/text safely (question content is untrusted).
    if (window.CBTMath) CBTMath.applyTo(text, optText || ''); else text.textContent = optText || '';
    if (optImg && window.CBTMath) {
      const im = CBTMath.makeImg(optImg, 'cbt-opt-img');
      if (im) text.appendChild(im);
    }
    box.appendChild(badge);
    box.appendChild(text);
    optGroup.appendChild(box);
  });

  document.getElementById('btnPrevQ').disabled = idx === 0;
  document.getElementById('btnNextQ').style.display = idx === questions.length - 1 ? 'none' : 'inline-flex';

  const flagBtn = document.getElementById('btnFlagQ');
  flagBtn.textContent = flaggedQuestions.has(q.id) ? '🚩 Unflag Question' : '🚩 Flag Question';

  updatePaletteHighlight();
}

function pickOption(qId, letter) {
  studentAnswers[qId] = letter;

  // Instant local storage protection
  const cacheKey = `cbt_answers_${currentExam.id}_${currentStudent.regNo}`;
  localStorage.setItem(cacheKey, JSON.stringify(studentAnswers));

  renderQuestion(currentQuestionIndex);
  renderPalette();

  // Instant live progress ping to teacher's server
  sendStudentHeartbeat();
}

function stepQuestion(delta) {
  renderQuestion(currentQuestionIndex + delta);
  sendStudentHeartbeat();
}

function toggleFlag() {
  const q = questions[currentQuestionIndex];
  if (flaggedQuestions.has(q.id)) {
    flaggedQuestions.delete(q.id);
  } else {
    flaggedQuestions.add(q.id);
  }
  renderQuestion(currentQuestionIndex);
  renderPalette();
}

function renderPalette() {
  const grid = document.getElementById('paletteGrid');
  grid.innerHTML = '';

  let answered = 0;
  questions.forEach((q, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'palette-btn';
    btn.id = `pal-${idx}`;
    btn.textContent = idx + 1;
    btn.onclick = () => renderQuestion(idx);

    if (studentAnswers[q.id]) {
      btn.classList.add('answered');
      answered++;
    }
    if (flaggedQuestions.has(q.id)) {
      btn.classList.add('flagged');
    }

    grid.appendChild(btn);
  });

  document.getElementById('statAnswered').textContent = answered;
  document.getElementById('statUnanswered').textContent = questions.length - answered;
  document.getElementById('statFlagged').textContent = flaggedQuestions.size;
  updatePaletteHighlight();
}

function updatePaletteHighlight() {
  questions.forEach((_, idx) => {
    const btn = document.getElementById(`pal-${idx}`);
    if (btn) {
      if (idx === currentQuestionIndex) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  });
}

// 5. Submit Modal & Execution

// ---- Exam tools: font size, high-contrast, calculator ----------------------
function adjustExamFont(dir) {
  let scale = parseFloat(document.documentElement.style.getPropertyValue('--exam-font-scale') || '1');
  scale = Math.max(0.8, Math.min(1.7, scale + dir * 0.1));
  document.documentElement.style.setProperty('--exam-font-scale', scale.toFixed(2));
}
function toggleHighContrast() { document.body.classList.toggle('high-contrast'); }

let _calcExpr = '';
function openCalculator() { buildCalcKeys(); document.getElementById('calcModal').style.display = 'flex'; }
function closeCalculator() { document.getElementById('calcModal').style.display = 'none'; }
function buildCalcKeys() {
  const grid = document.getElementById('calcKeys');
  if (!grid || grid.childElementCount) return;
  ['7','8','9','/','4','5','6','*','1','2','3','-','0','.','(',')','C','⌫','='].forEach(k => {
    const b = document.createElement('button');
    b.textContent = k; b.type = 'button'; b.className = 'btn btn-outline';
    b.style.padding = '12px 0'; b.style.fontWeight = '800'; b.style.fontSize = '1.05rem';
    if (k === '=') { b.className = 'btn btn-primary'; b.style.gridColumn = 'span 2'; }
    b.onclick = () => calcPress(k);
    grid.appendChild(b);
  });
}
function calcPress(k) {
  const d = document.getElementById('calcDisplay');
  if (k === 'C') { _calcExpr = ''; d.value = '0'; return; }
  if (k === '⌫') { _calcExpr = _calcExpr.slice(0, -1); d.value = _calcExpr || '0'; return; }
  if (k === '=') {
    try {
      const safe = _calcExpr.replace(/[^0-9.+\-*/() ]/g, '');
      const r = Function('"use strict";return (' + (safe || '0') + ')')();
      _calcExpr = String(r); d.value = r;
    } catch (e) { d.value = 'Error'; _calcExpr = ''; }
    return;
  }
  _calcExpr += k; d.value = _calcExpr;
}

function jumpToQuestion(idx) {
  closeSubmitModal();
  renderQuestion(idx);
}

function openSubmitModal() {
  let answered = 0;
  const unanswered = [];
  questions.forEach((q, i) => { if (studentAnswers[q.id]) answered++; else unanswered.push(i); });

  document.getElementById('summaryAnswered').textContent = answered;
  document.getElementById('summaryUnanswered').textContent = questions.length - answered;
  document.getElementById('summaryFlagged').textContent = flaggedQuestions.size;

  // Pre-submit review: clickable chips to jump back to unanswered / flagged questions.
  const chips = document.getElementById('reviewChips');
  if (chips) {
    chips.innerHTML = '';
    const flaggedIdx = questions.map((q, i) => flaggedQuestions.has(q.id) ? i : -1).filter(i => i >= 0);
    const mk = (label, list, color) => {
      if (!list.length) return;
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin-bottom:8px;';
      wrap.innerHTML = `<div style="font-size:.76rem;font-weight:700;color:#64748b;margin-bottom:4px;">${label}</div>`;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
      list.forEach(i => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = i + 1;
        b.style.cssText = `width:34px;height:34px;border-radius:8px;border:1.5px solid ${color};background:#fff;color:${color};font-weight:800;cursor:pointer;`;
        b.onclick = () => jumpToQuestion(i);
        row.appendChild(b);
      });
      wrap.appendChild(row); chips.appendChild(wrap);
    };
    mk('Unanswered — tap to go back', unanswered, '#dc2626');
    mk('Flagged for review', flaggedIdx, '#b45309');
  }

  document.getElementById('modalSubmit').style.display = 'flex';
}

function closeSubmitModal() {
  document.getElementById('modalSubmit').style.display = 'none';
}

// One POST attempt with a hard timeout so it can never hang forever.
async function submitOnce(payload, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || 12000);
  try {
    const res = await fetch(`${serverHost}/api/student/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      signal: ctrl.signal
    });
    clearTimeout(t);
    let data = {};
    try { data = await res.json(); } catch (e) {}
    return { responded: true, ok: res.ok, data };
  } catch (e) {
    clearTimeout(t);
    return { responded: false }; // network drop / timeout — safe to retry
  }
}

function showReceiptView(name, regNo, examTitle, receipt) {
  localStorage.removeItem(`cbt_answers_${currentExam.id}_${currentStudent.regNo}`);
  localStorage.removeItem(`cbt_timer_${currentExam.id}_${currentStudent.regNo}`);
  document.getElementById('recName').textContent = name || (currentStudent && currentStudent.name) || '';
  document.getElementById('recRegNo').textContent = regNo || (currentStudent && currentStudent.regNo) || '';
  document.getElementById('recExam').textContent = examTitle || (currentExam && currentExam.title) || '';
  document.getElementById('recTime').textContent = new Date((receipt && receipt.submittedAt) || Date.now()).toLocaleTimeString();
  document.getElementById('recId').textContent = (receipt && receipt.submissionId) || 'RECEIVED';

  // Scores are strictly withheld from student view (managed exclusively on admin dashboard)
  const resultCard = document.getElementById('resultCard');
  if (resultCard) resultCard.style.display = 'none';

  closeSubmitModal();
  dismissTimeWarning();
  document.getElementById('topCandidateTag').style.display = 'none';
  document.getElementById('topTimerBox').style.display = 'none';
  showView(viewReceipt);
}

async function executeFinalSubmit() {
  if (isSubmitting) return;
  isSubmitting = true;

  clearInterval(timerInterval);
  clearInterval(heartbeatInterval);

  const btn = document.getElementById('btnConfirmSubmit');
  btn.disabled = true;
  btn.textContent = 'Transmitting...';

  const payload = JSON.stringify({
    regNo: currentStudent.regNo,
    examId: currentExam.id,
    answers: studentAnswers
  });

  // Retry on network drops. Retries are SAFE: the server rejects a duplicate,
  // which we treat as a confirmed submission (so a lost response can't double-score).
  const MAX_TRIES = 5;
  let result = null;
  for (let i = 0; i < MAX_TRIES; i++) {
    btn.textContent = i === 0 ? 'Transmitting...' : `Reconnecting… (${i})`;
    result = await submitOnce(payload, 12000);
    if (result.responded) break;           // got a server answer (success or error)
    await new Promise(r => setTimeout(r, 1500)); // brief wait, then retry
  }

  if (result && result.responded) {
    const data = result.data || {};
    if (result.ok && data.success) {
      showReceiptView(data.receipt.studentName, data.receipt.regNo, data.receipt.examTitle, data.receipt);
      return;
    }
    if (data.alreadySubmitted) {
      // Our earlier attempt (or a retry) already landed — confirm success to the student.
      showReceiptView(null, null, null, data.submission || null);
      return;
    }
    // A real server-side rejection (bad data, no active exam, etc.)
    alert(data.message || 'Submission was not accepted. Please inform the invigilator.');
    btn.disabled = false;
    btn.textContent = 'Yes, Submit Now';
    isSubmitting = false;
    return;
  }

  // Never reached the server after all retries. Answers stay saved on this device.
  btn.disabled = false;
  btn.textContent = '🔁 Retry Submit';
  isSubmitting = false;
  alert('Could not reach the exam server. Your answers are SAVED on this device — they are not lost. Check the Wi-Fi / host connection and tap "Retry Submit", or call the invigilator.');
}

// 6. Supervisor Exit Modal & Server Host Config
function openExitModal() {
  document.getElementById('exitAlert').style.display = 'none';
  document.getElementById('exitPinInput').value = '';
  document.getElementById('modalExit').style.display = 'flex';
}

function closeExitModal() {
  document.getElementById('modalExit').style.display = 'none';
}

async function confirmSupervisorExit() {
  const pin = document.getElementById('exitPinInput').value.trim();
  const alertEl = document.getElementById('exitAlert');

  if (window.cbtAPI && window.cbtAPI.requestExit) {
    const res = await window.cbtAPI.requestExit(pin);
    if (!res.success) {
      alertEl.textContent = res.message || 'Incorrect PIN.';
      alertEl.style.display = 'block';
    }
  } else {
    // In browser mode
    if (pin === '9999') {
      window.close();
    } else {
      alertEl.textContent = 'Incorrect PIN.';
      alertEl.style.display = 'block';
    }
  }
}

function openServerConfigModal() {
  document.getElementById('serverHostInput').value = serverHost;
  document.getElementById('modalServerConfig').style.display = 'flex';
}

function closeServerConfigModal() {
  document.getElementById('modalServerConfig').style.display = 'none';
}

async function saveServerHostConfig() {
  let input = document.getElementById('serverHostInput').value.trim();
  if (!input.startsWith('http')) input = 'http://' + input;
  serverHost = input;

  if (window.cbtAPI && window.cbtAPI.saveConfig) {
    const config = await window.cbtAPI.getConfig();
    config.serverUrl = serverHost;
    await window.cbtAPI.saveConfig(config);
  }

  closeServerConfigModal();
  checkServerConnection();
}

// Start
initApp();
