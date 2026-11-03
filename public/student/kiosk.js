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
let secondsRemaining = 0;
let isSubmitting = false;

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

  try {
    const res = await fetch(`${serverHost}/api/status`);
    const data = await res.json();
    dot.className = 'status-indicator online';
    label.textContent = `Connected: ${new URL(serverHost).hostname}`;

    if (data.branding) {
      applySchoolBranding(data.branding);
    }
  } catch (err) {
    dot.className = 'status-indicator offline';
    label.textContent = 'Host Offline (Click to set IP)';
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

// 2. Candidate Login
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
    if (data.branding) applySchoolBranding(data.branding);

    // Populate Candidate Verification Screen
    document.getElementById('bioName').textContent = currentStudent.name;
    document.getElementById('bioRegNo').textContent = currentStudent.regNo;
    document.getElementById('bioClass').textContent = currentStudent.classLevel;
    document.getElementById('bioSubject').textContent = currentExam.title;
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

  document.getElementById('topCandidateTag').style.display = 'none';
  document.getElementById('topTimerBox').style.display = 'none';
  document.getElementById('btnVerify').disabled = false;
  document.getElementById('btnVerify').innerHTML = '<span>Login to Exam</span>';

  showView(viewLogin);
}

// 3. Start Exam
async function startExamSession() {
  try {
    const res = await fetch(`${serverHost}/api/student/exam?regNo=${encodeURIComponent(currentStudent.regNo)}`);
    const data = await res.json();
    questions = data.questions || [];
    window._passages = {};
    (data.passages || []).forEach(p => { if (p && p.id) window._passages[p.id] = p; });

    // Load local auto-save cache
    const cacheKey = `cbt_answers_${currentExam.id}_${currentStudent.regNo}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try { studentAnswers = JSON.parse(cached); } catch (e) {}
    }

    // Top Header info
    document.getElementById('topCandidateName').textContent = currentStudent.name;
    document.getElementById('topCandidateReg').textContent = currentStudent.regNo;
    document.getElementById('topCandidateTag').style.display = 'flex';
    document.getElementById('topTimerBox').style.display = 'flex';

    // Start Timer
    const timerKey = `cbt_timer_${currentExam.id}_${currentStudent.regNo}`;
    const savedTime = localStorage.getItem(timerKey);
    secondsRemaining = savedTime ? parseInt(savedTime) : (currentExam.durationMinutes || 45) * 60;
    runTimer(timerKey);

    showView(viewExam);
    renderQuestion(0);
    renderPalette();

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

    if (secondsRemaining <= 0) {
      clearInterval(timerInterval);
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
}

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
}

function stepQuestion(delta) {
  renderQuestion(currentQuestionIndex + delta);
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
function openSubmitModal() {
  let answered = 0;
  questions.forEach(q => { if (studentAnswers[q.id]) answered++; });

  document.getElementById('summaryAnswered').textContent = answered;
  document.getElementById('summaryUnanswered').textContent = questions.length - answered;
  document.getElementById('summaryFlagged').textContent = flaggedQuestions.size;

  document.getElementById('modalSubmit').style.display = 'flex';
}

function closeSubmitModal() {
  document.getElementById('modalSubmit').style.display = 'none';
}

async function submitOnce(payload, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || 12000);
  try {
    const res = await fetch(`${serverHost}/api/student/submit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, signal: ctrl.signal
    });
    clearTimeout(t);
    let data = {}; try { data = await res.json(); } catch (e) {}
    return { responded: true, ok: res.ok, data };
  } catch (e) { clearTimeout(t); return { responded: false }; }
}

function showReceiptView(name, regNo, examTitle, receipt) {
  localStorage.removeItem(`cbt_answers_${currentExam.id}_${currentStudent.regNo}`);
  localStorage.removeItem(`cbt_timer_${currentExam.id}_${currentStudent.regNo}`);
  document.getElementById('recName').textContent = name || (currentStudent && currentStudent.name) || '';
  document.getElementById('recRegNo').textContent = regNo || (currentStudent && currentStudent.regNo) || '';
  document.getElementById('recExam').textContent = examTitle || (currentExam && currentExam.title) || '';
  document.getElementById('recTime').textContent = new Date((receipt && receipt.submittedAt) || Date.now()).toLocaleTimeString();
  document.getElementById('recId').textContent = (receipt && receipt.submissionId) || 'RECEIVED';
  if (receipt && receipt.score !== undefined) {
    document.getElementById('recScore').textContent = receipt.score;
    document.getElementById('recTotal').textContent = receipt.totalMarks;
    document.getElementById('recPerc').textContent = `${receipt.percentage}%`;
    const g = document.getElementById('recGrade');
    g.textContent = (receipt.passed ? 'PASSED' : 'NEEDS IMPROVEMENT') + (receipt.gradeBand ? ' · ' + receipt.gradeBand : '');
    document.getElementById('resultCard').style.display = 'block';
  }
  closeSubmitModal();
  document.getElementById('topCandidateTag').style.display = 'none';
  document.getElementById('topTimerBox').style.display = 'none';
  showView(viewReceipt);
}

async function executeFinalSubmit() {
  if (isSubmitting) return;
  isSubmitting = true;
  clearInterval(timerInterval);

  const btn = document.getElementById('btnConfirmSubmit');
  btn.disabled = true;
  btn.textContent = 'Transmitting...';

  const payload = JSON.stringify({ regNo: currentStudent.regNo, examId: currentExam.id, answers: studentAnswers });
  const MAX_TRIES = 5;
  let result = null;
  for (let i = 0; i < MAX_TRIES; i++) {
    btn.textContent = i === 0 ? 'Transmitting...' : `Reconnecting… (${i})`;
    result = await submitOnce(payload, 12000);
    if (result.responded) break;
    await new Promise(r => setTimeout(r, 1500));
  }

  if (result && result.responded) {
    const data = result.data || {};
    if (result.ok && data.success) { showReceiptView(data.receipt.studentName, data.receipt.regNo, data.receipt.examTitle, data.receipt); return; }
    if (data.alreadySubmitted) { showReceiptView(null, null, null, data.submission || null); return; }
    alert(data.message || 'Submission was not accepted. Please inform the invigilator.');
    btn.disabled = false; btn.textContent = 'Yes, Submit Now'; isSubmitting = false;
    return;
  }

  btn.disabled = false; btn.textContent = '🔁 Retry Submit'; isSubmitting = false;
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
