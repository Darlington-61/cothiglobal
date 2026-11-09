// COTHI Offline CBT - Supervisor & Admin Controller
let currentBranding = null;
let currentActiveExam = null;
let liveCandidates = [];
let builderQuestions = [];
let eventSource = null;

// --- Supervisor authentication -------------------------------------------
let adminToken = '';
try { adminToken = localStorage.getItem('cothi_admin_token') || ''; } catch (e) {}

function setAdminToken(t) {
  adminToken = t || '';
  try {
    if (t) localStorage.setItem('cothi_admin_token', t);
    else localStorage.removeItem('cothi_admin_token');
  } catch (e) {}
}

// Attach the supervisor token to every /api/admin/* request automatically, and
// bounce back to the login screen on a 401 so the console can never run unauthenticated.
(function installAuthFetch() {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    init = init || {};
    const urlStr = (typeof input === 'string') ? input : (input && input.url) || '';
    if (urlStr.indexOf('/api/admin/') !== -1 && adminToken) {
      const headers = new Headers(init.headers || (typeof input !== 'string' && input.headers) || {});
      if (!headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + adminToken);
      init = { ...init, headers };
    }
    const res = await nativeFetch(input, init);
    if (res.status === 401 && urlStr.indexOf('/api/admin/') !== -1) {
      setAdminToken('');
      const modal = document.getElementById('adminLoginModal');
      if (modal) modal.style.display = 'flex';
    }
    return res;
  };
})();

// Tab switcher
function switchTab(tabId) {
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

  const targetTab = document.getElementById(tabId);
  if (targetTab) targetTab.classList.add('active');

  const titles = {
    'tabSchoolSelect': { title: 'Select School & COTHI Sync', subtitle: 'Step 1: Download school branding, candidate lists, and questions' },
    'tabStudents': { title: 'Candidate Roster & Login PINs', subtitle: 'Official candidate list, registration numbers, and exam access PINs' },
    'tabPromotion': { title: 'Class Promotion Manager', subtitle: 'Advance candidates to the next class at the end of a term or session' },
    'tabExams': { title: 'Exams Library & Management', subtitle: 'Schedule, manage and activate offline papers' },
    'tabLive': { title: 'Live Exam Monitor', subtitle: 'Real-time candidate submissions and terminal status' },
    'tabCreate': { title: 'Question Builder (Web-Style)', subtitle: 'Create, edit, or import custom exams for your school' },
    'tabCothi': { title: 'COTHI School Exams Repository', subtitle: 'Exams prepared centrally on cbtbycothi.com.ng for your center' },
    'tabBranding': { title: 'School Customization & Identity', subtitle: 'Personalize the exam terminal for your school branding' },
    'tabResults': { title: 'Exam Broadsheet & Cloud Sync', subtitle: 'Instant local scores and one-click cloud upload' }
  };

  if (titles[tabId]) {
    document.getElementById('currentTabTitle').textContent = titles[tabId].title;
    document.getElementById('currentTabSubtitle').textContent = titles[tabId].subtitle;
  }

  // Update nav highlight
  const navBtns = document.querySelectorAll('.sidebar-nav .nav-item');
  const indexMap = {
    'tabSchoolSelect': 0,
    'tabStudents': 1,
    'tabPromotion': 2,
    'tabExams': 3,
    'tabLive': 4,
    'tabCreate': 5,
    'tabCothi': 6,
    'tabBranding': 7,
    'tabResults': 8
  };
  if (indexMap[tabId] !== undefined && navBtns[indexMap[tabId]]) {
    navBtns[indexMap[tabId]].classList.add('active');
  }

  if (tabId === 'tabSchoolSelect') fetchCothiSchools();
  if (tabId === 'tabStudents') fetchStudents();
  if (tabId === 'tabPromotion') fetchStudents(); // refreshes roster + rebuilds the promotion list
  if (tabId === 'tabExams') fetchExamsList();
  if (tabId === 'tabLive') fetchLiveMonitor();
  if (tabId === 'tabCothi') fetchCothiExams();
  if (tabId === 'tabResults') fetchResults();
}

// COTHI CLOUD SCHOOL SYNC
async function fetchCothiSchools(forceRefresh = false) {
  const container = document.getElementById('cothiSchoolsContainer');
  container.innerHTML = `<div style="text-align:center; padding: 24px;">
    <p class="text-muted" style="font-weight:600; font-size:1rem;">
      ${forceRefresh ? '🌐 Connecting to https://cbtbycothi.com.ng to fetch latest registered schools...' : 'Loading COTHI School Directory...'}
    </p>
  </div>`;

  try {
    let res;
    if (forceRefresh) {
      res = await fetch('/api/admin/refresh-cothi-schools', { method: 'POST' });
    } else {
      res = await fetch('/api/admin/cothi-schools');
    }
    const result = await res.json();
    const schools = Array.isArray(result) ? result : (result.schools || []);

    container.innerHTML = '';

    if (!schools || schools.length === 0) {
      container.innerHTML = '<p class="text-muted text-center py-20">No schools found in COTHI directory. Click "Refresh Cloud List" while connected to internet data.</p>';
      return;
    }

    // Populate Datalist for fast code completion
    const datalist = document.getElementById('schoolCodeList');
    if (datalist) {
      datalist.innerHTML = schools.map(s => `<option value="${s.code}">${s.name} [Code: ${s.code.toUpperCase()}]</option>`).join('');
    }

    if (forceRefresh && result.live) {
      const banner = document.createElement('div');
      banner.style.cssText = 'grid-column: 1 / -1; background:#ecfdf5; border:1.5px solid #10b981; color:#065f46; padding:12px 18px; border-radius:10px; font-weight:700; margin-bottom:14px; display:flex; align-items:center; gap:10px; box-shadow:0 2px 6px rgba(16,185,129,0.1);';
      banner.innerHTML = `<span style="font-size:22px;">🌐</span> <div><div>✅ Live Connection Established with COTHI Cloud (cbtbycothi.com.ng)!</div><div style="font-size:0.82rem; font-weight:500; color:#047857; margin-top:2px;">Downloaded latest central registry: ${result.count} registered schools, student rosters, and question banks.</div></div>`;
      container.appendChild(banner);
    } else if (forceRefresh && !result.live) {
      const banner = document.createElement('div');
      banner.style.cssText = 'grid-column: 1 / -1; background:#f0fdf4; border:1.5px solid #22c55e; color:#14532d; padding:12px 18px; border-radius:10px; font-weight:700; margin-bottom:14px; display:flex; align-items:center; gap:10px;';
      banner.innerHTML = `<span style="font-size:22px;">⚡</span> <div><div>✅ Offline Ready: ${schools.length} Schools Active & Ready for Exams</div><div style="font-size:0.82rem; font-weight:500; color:#15803d; margin-top:2px;">All school branding, candidate lists, and questions are stored on this PC and work 100% without internet data. (Connect to phone hotspot if you need to fetch brand-new schools).</div></div>`;
      container.appendChild(banner);
    }

    schools.forEach(s => {
      const isCurrent = currentBranding && currentBranding.schoolCode === s.code;
      const card = document.createElement('div');
      card.className = 'cothi-card';
      card.style.borderLeft = `6px solid ${s.primaryColor || '#2563eb'}`;

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px; gap:12px;">
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="width:48px; height:48px; border-radius:10px; border:1px solid #e2e8f0; background:#ffffff; display:flex; align-items:center; justify-content:center; overflow:hidden; flex-shrink:0; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
              ${s.logo && s.logo.trim() ? `<img src="${s.logo}" style="width:100%; height:100%; object-fit:contain;" alt="${s.name}">` : '<span style="font-size:24px;">🏛️</span>'}
            </div>
            <div>
              <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
                <span class="badge-tag" style="background:${s.primaryColor || '#2563eb'}; color:white;">${s.code.toUpperCase()}</span>
                ${s.isCustom ? '<span class="badge-tag" style="background:#059669; color:white;">OFFLINE REGISTERED</span>' : ''}
              </div>
              <h4 style="margin-top:4px; color:${s.primaryColor || '#2563eb'}; font-size:1.15rem; line-height:1.2;">${s.name}</h4>
            </div>
          </div>
          ${isCurrent ? '<span class="status-pill status-submitted" style="white-space:nowrap;">CURRENTLY ACTIVE</span>' : ''}
        </div>
        <p class="cothi-instructions" style="margin-bottom:12px;">"${s.motto || 'Excellence in CBT'}"</p>
        <div class="cothi-meta" style="margin-bottom:16px;">
          <span>👥 ${s.studentsCount || 0} Registered Students</span>
          <span>📝 ${s.examsCount || 0} Ready Exams</span>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-primary" style="flex:1;" onclick="syncSchool('${s.code}')">
            ⬇️ Download &amp; Activate All Data for This School
          </button>
          ${!isCurrent ? `<button type="button" class="btn btn-outline-danger btn-sm" onclick="deleteSchoolItem('${s.code}', '${s.name.replace(/'/g, "\\'")}')" title="Remove School">🗑️</button>` : ''}
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = '<p class="text-danger text-center">Failed to load COTHI schools. Please verify the server is running.</p>';
  }
}

async function syncSchoolByInputCode() {
  const code = document.getElementById('manualSchoolCodeInput').value.trim();
  if (!code) {
    alert('Please enter a School Code (e.g. k, ctsss, era, excel, anchor, cothi)');
    return;
  }
  syncSchool(code);
}

async function syncSchool(schoolCode) {
  if (!confirm(`Download and activate all data for school "${schoolCode}" from COTHI Cloud?\n\nThis will download the school logo, branding, student roster, and all exam questions.`)) return;

  try {
    const res = await fetch('/api/admin/sync-school', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolCode })
    });
    const data = await res.json();

    if (data.success) {
      alert(`🎉 SUCCESS! School Data Activated:\n\nSchool: ${data.school.name}\nSchool Code: [${data.school.code}]\nStudents Loaded: ${data.studentsCount}\nExams Prepared: ${data.examsCount}\n\nThe server is now configured for ${data.school.name}. All Student Electron Apps on this network will automatically detect this school!`);
      initAdmin();
      switchTab('tabLive');
    } else {
      alert(data.message || 'Error syncing school data.');
    }
  } catch (err) {
    alert('Failed to connect to COTHI Cloud or local server.');
  }
}

async function deleteSchoolItem(code, name) {
  if (!confirm(`Are you sure you want to remove "${name}" [${code.toUpperCase()}] from the local directory?\n\nThis will remove it from the schools list.`)) return;
  try {
    const res = await fetch('/api/admin/schools/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const data = await res.json();
    if (data.success) {
      alert(`School "${name}" removed successfully.`);
      fetchCothiSchools();
    } else {
      alert(data.message || 'Failed to remove school.');
    }
  } catch (err) {
    alert('Server communication error.');
  }
}

// REGISTER NEW SCHOOL OFFLINE
function handleRegSchoolLogoUpload(input) {
  if (input.files && input.files[0]) {
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      document.getElementById('regSchoolLogo').value = e.target.result;
      updateRegLogoPreview();
    };
    reader.readAsDataURL(file);
  }
}

function updateRegLogoPreview() {
  const logo = (document.getElementById('regSchoolLogo').value || '').trim();
  const container = document.getElementById('regSchoolLogoThumbContainer');
  const thumb = document.getElementById('regSchoolLogoThumb');
  if (container && thumb) {
    if (logo) {
      thumb.src = logo;
      container.style.display = 'flex';
    } else {
      container.style.display = 'none';
    }
  }
}

function clearRegSchoolLogo() {
  const logoInput = document.getElementById('regSchoolLogo');
  if (logoInput) logoInput.value = '';
  const fileInput = document.getElementById('regSchoolLogoFileInput');
  if (fileInput) fileInput.value = '';
  updateRegLogoPreview();
}

function openRegisterSchoolModal() {
  const alertBox = document.getElementById('registerSchoolAlert');
  if (alertBox) alertBox.style.display = 'none';
  document.getElementById('regSchoolName').value = '';
  document.getElementById('regSchoolCode').value = '';
  document.getElementById('regSchoolMotto').value = '';
  clearRegSchoolLogo();
  document.getElementById('regSchoolPrimaryColor').value = '#2563eb';
  document.getElementById('regSchoolColorPicker').value = '#2563eb';
  document.getElementById('regSchoolAccentColor').value = '#f8fafc';
  document.getElementById('regSchoolAccentPicker').value = '#f8fafc';
  document.getElementById('regSchoolActivateNow').checked = true;
  document.getElementById('modalRegisterSchool').style.display = 'flex';
}

function closeRegisterSchoolModal() {
  document.getElementById('modalRegisterSchool').style.display = 'none';
}

async function handleRegisterSchool(e) {
  e.preventDefault();
  const alertBox = document.getElementById('registerSchoolAlert');
  if (alertBox) alertBox.style.display = 'none';

  const name = document.getElementById('regSchoolName').value.trim();
  const code = document.getElementById('regSchoolCode').value.trim().toLowerCase();
  const motto = document.getElementById('regSchoolMotto').value.trim();
  const logo = document.getElementById('regSchoolLogo').value.trim();
  const primaryColor = document.getElementById('regSchoolPrimaryColor').value.trim();
  const accentColor = document.getElementById('regSchoolAccentColor').value.trim();
  const activateNow = document.getElementById('regSchoolActivateNow').checked;

  if (!name || !code) {
    if (alertBox) {
      alertBox.textContent = 'Please fill in both School Name and School Code.';
      alertBox.style.display = 'block';
    }
    return;
  }

  try {
    const res = await fetch('/api/admin/schools/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        code,
        motto,
        logo,
        primaryColor,
        accentColor,
        activateNow
      })
    });
    const data = await res.json();
    if (data.success) {
      closeRegisterSchoolModal();
      alert(`🎉 School "${name}" registered successfully!\n\nIt is now permanently saved in the local school directory and will never be lost or overwritten.`);
      await fetchCothiSchools();
      if (activateNow) {
        initAdmin();
        switchTab('tabLive');
      }
    } else {
      if (alertBox) {
        alertBox.textContent = data.message || 'Failed to register school.';
        alertBox.style.display = 'block';
      }
    }
  } catch (err) {
    if (alertBox) {
      alertBox.textContent = 'Network or server error while registering school.';
      alertBox.style.display = 'block';
    }
  }
}

// ==========================================
// CANDIDATE ROSTER & ACCESS PIN MANAGEMENT
// ==========================================
let allStudentsList = [];
let studentSearchQuery = '';
let studentClassFilterVal = 'ALL';
let studentStatusFilterVal = 'ALL';

async function fetchStudents(silent = false) {
  const tbody = document.getElementById('studentsTableBody');
  if (!tbody) return;
  if (!silent) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center py-20 text-muted">Fetching candidate credentials...</td></tr>';
  }

  try {
    const res = await fetch('/api/admin/students');
    const data = await res.json();
    allStudentsList = data.students || [];

    // Update badges & stats
    const total = allStudentsList.length;
    const badge = document.getElementById('navStudentsBadge');
    if (badge) badge.textContent = total;
    const totalEl = document.getElementById('studentsTotalCount');
    if (totalEl) totalEl.textContent = total;

    const activeCount = allStudentsList.filter(s => s.status === 'active').length;
    const subCount = allStudentsList.filter(s => s.status === 'submitted').length;
    const activeEl = document.getElementById('studentsActiveCount');
    if (activeEl) activeEl.textContent = activeCount;
    const subEl = document.getElementById('studentsSubmittedCount');
    if (subEl) subEl.textContent = subCount;

    // PIN default
    const commonPin = allStudentsList.length > 0 ? allStudentsList[0].pin : '1234';
    const pinEl = document.getElementById('studentsPinDefault');
    if (pinEl) pinEl.textContent = commonPin;

    // Update Class filter options
    const classSet = new Set(allStudentsList.map(s => s.classLevel).filter(Boolean));
    const classSelect = document.getElementById('studentClassFilter');
    if (classSelect) {
      const currentVal = classSelect.value;
      classSelect.innerHTML = '<option value="ALL">All Classes & Grades</option>';
      classSet.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        if (c === currentVal) opt.selected = true;
        classSelect.appendChild(opt);
      });
    }

    renderStudentsTable();
    updateClassPromotionList();
  } catch (err) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="text-center py-20 text-danger">Failed to load students. Ensure server is active.</td></tr>';
  }
}

function handleStudentSearch(val) {
  studentSearchQuery = val;
  renderStudentsTable();
}

function handleStudentClassFilter(val) {
  studentClassFilterVal = val;
  renderStudentsTable();
}

function handleStudentStatusFilter(val) {
  studentStatusFilterVal = val;
  renderStudentsTable();
}

function renderStudentsTable() {
  const tbody = document.getElementById('studentsTableBody');
  if (!tbody) return;

  const filtered = allStudentsList.filter(s => {
    const q = studentSearchQuery.toLowerCase().trim();
    const matchQuery = !q || s.name.toLowerCase().includes(q) || s.regNo.toLowerCase().includes(q);
    const matchClass = studentClassFilterVal === 'ALL' || s.classLevel === studentClassFilterVal;
    const matchStatus = studentStatusFilterVal === 'ALL' || s.status === studentStatusFilterVal;
    return matchQuery && matchClass && matchStatus;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center py-20 text-muted">No candidates found matching filter criteria.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map((st, idx) => {
    let statusBadge = '<span class="status-pill status-notstarted">⚪ Not Started</span>';
    if (st.status === 'active') {
      const prog = st.progress ? ` (${st.progress})` : '';
      statusBadge = `<span class="status-pill status-writing"><span class="pulse-dot"></span>Writing${prog}</span>`;
    } else if (st.status === 'offline') {
      statusBadge = '<span class="status-pill status-offline">⚠️ Disconnected</span>';
    } else if (st.status === 'submitted') {
      const scoreText = st.scoreInfo ? ` (${st.scoreInfo.score}/${st.scoreInfo.totalMarks})` : '';
      statusBadge = `<span class="status-pill status-submitted">🏆 Submitted${scoreText}</span>`;
    }

    return `
      <tr>
        <td style="font-weight:600; color:#64748b;">${idx + 1}</td>
        <td>
          <div style="font-weight:700; color:#0f172a; font-size:0.95rem;">${st.name}</div>
        </td>
        <td>
          <span style="font-family:ui-monospace, monospace; background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; padding:4px 10px; border-radius:6px; font-weight:700; font-size:0.9rem;">
            ${st.regNo}
          </span>
        </td>
        <td>
          <span style="font-family:ui-monospace, monospace; background:#fef3c7; color:#92400e; border:1.5px solid #f59e0b; padding:4px 12px; border-radius:6px; font-weight:800; font-size:1.05rem; letter-spacing:0.05em;">
            ${st.pin}
          </span>
        </td>
        <td><span style="font-weight:600;">${st.classLevel}</span></td>
        <td><span style="color:#64748b;">${st.gender}</span></td>
        <td>${statusBadge}</td>
        <td style="text-align:right; white-space:nowrap;">
          <button class="btn btn-outline btn-sm" onclick="copyCredentials('${st.regNo}', '${st.pin}')" title="Copy Reg No & PIN">📋 Copy</button>
          <button class="btn btn-outline-danger btn-sm" onclick="deleteStudentCandidate('${st.regNo}')" title="Remove Candidate">🗑️</button>
        </td>
      </tr>
    `;
  }).join('');
}

function copyCredentials(regNo, pin) {
  const text = `Reg No: ${regNo} | PIN: ${pin}`;
  navigator.clipboard.writeText(text).then(() => {
    alert(`Copied to clipboard:\n${text}`);
  }).catch(() => {
    prompt('Candidate Credentials:', text);
  });
}

async function deleteStudentCandidate(regNo) {
  if (!confirm(`Are you sure you want to remove candidate "${regNo}" from the local exam database?`)) return;
  try {
    const res = await fetch('/api/admin/students', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ regNo })
    });
    const data = await res.json();
    if (data.success) {
      fetchStudents(true);
    } else {
      alert(data.message || 'Failed to delete student.');
    }
  } catch (e) {
    alert('Error connecting to server.');
  }
}

// Add Candidate Modal
async function fetchNextStudentRegNo() {
  const regInput = document.getElementById('addStudentReg');
  if (!regInput) return;
  try {
    regInput.placeholder = 'Generating...';
    const res = await adminFetch('/api/admin/students/next-reg');
    const data = await res.json();
    if (data && data.nextRegNo) {
      regInput.value = data.nextRegNo;
    }
  } catch (e) {
    const code = (window._currentSchoolCode || 'std').toLowerCase();
    const count = (studentsList ? studentsList.length : 0) + 1;
    regInput.value = `${code}${String(count).padStart(3, '0')}`;
  }
}

function openAddStudentModal() {
  document.getElementById('addStudentAlert').style.display = 'none';
  document.getElementById('addStudentName').value = '';
  document.getElementById('addStudentReg').value = '';
  document.getElementById('addStudentPin').value = document.getElementById('studentsPinDefault').textContent || '1234';
  document.getElementById('modalAddStudent').style.display = 'flex';
  fetchNextStudentRegNo();
  setTimeout(() => {
    const nameEl = document.getElementById('addStudentName');
    if (nameEl) nameEl.focus();
  }, 100);
}

function closeAddStudentModal() {
  document.getElementById('modalAddStudent').style.display = 'none';
}

async function handleAddStudent(e) {
  e.preventDefault();
  const name = document.getElementById('addStudentName').value.trim();
  const regNo = document.getElementById('addStudentReg').value.trim();
  const pin = document.getElementById('addStudentPin').value.trim() || '1234';
  const classLevel = document.getElementById('addStudentClass').value.trim() || 'SS 2';
  const gender = document.getElementById('addStudentGender').value;
  const alertEl = document.getElementById('addStudentAlert');

  try {
    const res = await adminFetch('/api/admin/students', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, regNo, pin, classLevel, gender })
    });
    const data = await res.json();
    if (data.success) {
      closeAddStudentModal();
      fetchStudents(true);
    } else {
      alertEl.textContent = data.message || 'Error saving candidate.';
      alertEl.style.display = 'block';
    }
  } catch (err) {
    alertEl.textContent = 'Failed to connect to local server.';
    alertEl.style.display = 'block';
  }
}

// Bulk Student Upload
let parsedBulkStudents = [];

function downloadStudentTemplate() {
  const csvContent = "name,regNo,classLevel,pin,gender\n" +
    "Ani Chidimma Joy,EXCEL/2026/001,SS 2,1234,Female\n" +
    "Nnabuike Michael,EXCEL/2026/002,SS 2,1234,Male\n" +
    "Okeke Angel Somtochukwu,ERA/2026/028,SS 2,1234,Female\n" +
    "David Chidubem Onyemelukwe,ERA/2026/029,SS 2,1234,Male\n";
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = "COTHI_Student_Upload_Template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function parseBulkStudentFile(input) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const text = e.target.result;
    parsedBulkStudents = [];

    try {
      if (file.name.endsWith('.json')) {
        const json = JSON.parse(text);
        if (Array.isArray(json)) {
          parsedBulkStudents = json.map(s => ({
            name: s.name || s.studentName || '',
            regNo: s.regNo || s.regNumber || s.id || '',
            classLevel: s.classLevel || s.class || 'SS 2',
            pin: s.pin || '1234',
            gender: s.gender || 'Not Specified'
          })).filter(s => s.name && s.regNo);
        }
      } else {
        const lines = text.split(/\r\n|\n/).filter(l => l.trim().length > 0);
        let startIdx = 0;
        if (lines.length > 0 && (lines[0].toLowerCase().includes('name') || lines[0].toLowerCase().includes('reg'))) {
          startIdx = 1;
        }

        for (let i = startIdx; i < lines.length; i++) {
          const parts = parseCsvLine(lines[i]); // robust: handles quoted names/commas & empty cells
          if (parts.length >= 2 && parts[0] && parts[1]) {
            parsedBulkStudents.push({
              name: parts[0],
              regNo: parts[1],
              classLevel: parts[2] || 'SS 2',
              pin: parts[3] || '1234',
              gender: parts[4] || 'Not Specified'
            });
          }
        }
      }

      const previewDiv = document.getElementById('bulkStudentPreview');
      const previewBody = document.getElementById('bulkStudentPreviewBody');
      const countEl = document.getElementById('bulkStudentCount');

      if (parsedBulkStudents.length > 0) {
        previewDiv.style.display = 'block';
        countEl.textContent = `${parsedBulkStudents.length} candidates parsed ready for import`;
        previewBody.innerHTML = parsedBulkStudents.slice(0, 10).map((s, idx) => `
          <tr>
            <td>${idx + 1}</td>
            <td><strong>${s.name}</strong></td>
            <td><code>${s.regNo}</code></td>
            <td>${s.classLevel}</td>
            <td><span class="badge-tag">${s.pin}</span></td>
            <td>${s.gender}</td>
          </tr>
        `).join('') + (parsedBulkStudents.length > 10 ? `<tr><td colspan="6" class="text-center text-muted">... and ${parsedBulkStudents.length - 10} more candidates</td></tr>` : '');
      } else {
        alert('No valid candidate rows could be parsed. Please check the file format.');
        previewDiv.style.display = 'none';
      }
    } catch (err) {
      alert('Error parsing file: ' + err.message);
    }
  };
  reader.readAsText(file);
}

async function uploadBulkStudents() {
  if (parsedBulkStudents.length === 0) {
    alert('Please select a valid CSV or JSON file first.');
    return;
  }

  const btn = document.getElementById('bulkUploadBtn');
  btn.disabled = true;
  btn.textContent = 'Uploading...';

  try {
    const res = await fetch('/api/admin/students/bulk-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ students: parsedBulkStudents })
    });
    const data = await res.json();

    if (data.success) {
      const resDiv = document.getElementById('bulkStudentResult');
      resDiv.style.display = 'block';
      resDiv.innerHTML = `✅ Successfully imported <strong>${data.total}</strong> candidates (${data.added} added, ${data.updated} updated)!`;
      document.getElementById('bulkStudentPreview').style.display = 'none';
      document.getElementById('bulkStudentFile').value = '';
      parsedBulkStudents = [];
      fetchStudents(true);
    } else {
      alert(data.message || 'Bulk upload failed.');
    }
  } catch (err) {
    alert('Failed to connect to server for bulk student upload.');
  } finally {
    btn.disabled = false;
    btn.textContent = '⬆ Upload Students';
  }
}

// Student Promotion & Class Advancement
function updateClassPromotionList() {
  const container = document.getElementById('promotionClassList');
  if (!container) return;

  const classCounts = {};
  allStudentsList.forEach(s => {
    const cls = s.classLevel || 'Unassigned';
    classCounts[cls] = (classCounts[cls] || 0) + 1;
  });

  const classes = Object.keys(classCounts).sort();
  if (classes.length === 0) {
    container.innerHTML = '<p class="text-muted text-sm">No registered candidates found to promote.</p>';
    return;
  }

  container.innerHTML = `
    <div style="font-size:0.85rem; font-weight:700; color:#334155; margin-bottom:8px;">Select Class(es) to Promote:</div>
    <div style="display:flex; flex-wrap:wrap; gap:10px;">
      ${classes.map(c => `
        <label style="display:inline-flex; align-items:center; gap:6px; background:#f1f5f9; border:1px solid #cbd5e1; padding:6px 12px; border-radius:8px; font-size:0.88rem; cursor:pointer;">
          <input type="checkbox" class="promote-class-check" value="${c}">
          <strong>${c}</strong> <span class="badge-tag">${classCounts[c]} candidates</span>
        </label>
      `).join('')}
    </div>
  `;
}

async function promoteSelectedClasses() {
  const checkedBoxes = Array.from(document.querySelectorAll('.promote-class-check:checked'));
  if (checkedBoxes.length === 0) {
    alert('Please check at least one class to promote.');
    return;
  }
  const targetClass = document.getElementById('promotionTargetClass').value;
  if (!targetClass) {
    alert('Please select a Target Class to promote to.');
    return;
  }

  const selectedClasses = checkedBoxes.map(b => b.value);
  const matchingStudents = allStudentsList.filter(s => selectedClasses.includes(s.classLevel));
  const studentRegNos = matchingStudents.map(s => s.regNo);

  if (!confirm(`Are you sure you want to promote ${studentRegNos.length} candidates from [${selectedClasses.join(', ')}] to "${targetClass}"?`)) return;

  try {
    const res = await fetch('/api/admin/students/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentRegNos, targetClass })
    });
    const data = await res.json();
    if (data.success) {
      const resEl = document.getElementById('promotionResult');
      resEl.style.display = 'block';
      resEl.innerHTML = `🎉 Successfully promoted <strong>${data.promoted}</strong> candidates to <strong>${targetClass}</strong>!`;
      fetchStudents(true);
    } else {
      alert(data.message || 'Promotion failed.');
    }
  } catch (err) {
    alert('Error connecting to server.');
  }
}

async function advanceAllStudents() {
  if (!confirm('Advance ALL students in the school to their next academic class level?\n\nProgression:\nJSS 1 ➔ JSS 2\nJSS 2 ➔ JSS 3\nJSS 3 ➔ SS 1\nSS 1 ➔ SS 2\nSS 2 ➔ SS 3\nSS 3 ➔ Graduated 🎓')) return;

  try {
    const res = await fetch('/api/admin/students/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ advanceAll: true })
    });
    const data = await res.json();
    if (data.success) {
      const resEl = document.getElementById('promotionResult');
      resEl.style.display = 'block';
      resEl.innerHTML = `🎓 End-of-Session Promotion Complete! Advanced <strong>${data.promoted}</strong> students across all classes.`;
      fetchStudents(true);
    } else {
      alert(data.message || 'Auto-advancement failed.');
    }
  } catch (err) {
    alert('Error connecting to server.');
  }
}

// Print Candidate Slips Modal
function openPrintSlipsModal() {
  const container = document.getElementById('slipsContainer');
  const schoolName = currentBranding ? currentBranding.schoolName : 'COTHIGLOBAL Examination Center';
  const schoolLogo = currentBranding && currentBranding.schoolLogo ? currentBranding.schoolLogo : '';
  const examTitle = currentActiveExam ? currentActiveExam.title : 'Official Examination';

  if (allStudentsList.length === 0) {
    alert('No candidates registered yet. Please sync a school first.');
    return;
  }

  container.innerHTML = `
    <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:16px;">
      ${allStudentsList.map(st => `
        <div style="background:#ffffff; border:1.5px dashed #2563eb; border-radius:12px; padding:16px; box-shadow:0 1px 3px rgba(0,0,0,0.05); page-break-inside:avoid; display:flex; flex-direction:column; justify-content:space-between;">
          <div>
            <div style="display:flex; align-items:center; gap:8px; border-bottom:1px solid #e2e8f0; padding-bottom:8px; margin-bottom:10px;">
              ${schoolLogo ? `<img src="${schoolLogo}" style="width:28px; height:28px; object-fit:contain;">` : '<span style="font-size:20px;">🏛️</span>'}
              <div style="font-weight:800; font-size:0.85rem; color:#1e3a8a; line-height:1.2; text-transform:uppercase;">
                ${schoolName}
              </div>
            </div>
            <div style="font-size:0.72rem; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:2px;">
              OFFICIAL CANDIDATE EXAM SLIP
            </div>
            <div style="font-size:1.05rem; font-weight:800; color:#0f172a; margin-bottom:8px;">
              ${st.name}
            </div>
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:8px 10px; margin-bottom:10px;">
              <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:0.82rem;">
                <span style="color:#64748b;">Registration No:</span>
                <strong style="font-family:ui-monospace, monospace; color:#2563eb;">${st.regNo}</strong>
              </div>
              <div style="display:flex; justify-content:space-between; font-size:0.82rem;">
                <span style="color:#64748b;">Access PIN:</span>
                <strong style="font-family:ui-monospace, monospace; color:#d97706; background:#fef3c7; padding:1px 6px; border-radius:4px; font-size:0.95rem;">${st.pin}</strong>
              </div>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:0.75rem; color:#64748b; margin-bottom:6px;">
              <span>Class: <strong>${st.classLevel}</strong></span>
              <span>Paper: <strong>${examTitle}</strong></span>
            </div>
          </div>
          <div style="font-size:0.68rem; color:#94a3b8; border-top:1px dashed #cbd5e1; padding-top:6px; text-align:center;">
            Keep this slip confidential. Present to the invigilator.
          </div>
        </div>
      `).join('')}
    </div>
  `;

  document.getElementById('modalPrintSlips').style.display = 'flex';
}

function closePrintSlipsModal() {
  document.getElementById('modalPrintSlips').style.display = 'none';
}

function triggerPrintSlips() {
  const printContent = document.getElementById('slipsContainer').innerHTML;
  const printWindow = window.open('', '_blank', 'width=900,height=700');
  printWindow.document.write(`
    <html>
      <head>
        <title>Candidate Examination Login Slips</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 20px; }
          @media print {
            body { margin: 0; }
            @page { margin: 1cm; size: A4 portrait; }
          }
        </style>
      </head>
      <body>
        ${printContent}
        <script>
          window.onload = function() { window.print(); };
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

// Check Server Status & Initialization
async function initAdmin() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    if (data.branding) {
      currentBranding = data.branding;
      applyAdminBranding(data.branding);
    }

    if (data.activeExam) {
      currentActiveExam = data.activeExam;
      const sessTerm = (data.activeExam.session ? data.activeExam.session + ' • ' : '') + (data.activeExam.term || '');
      document.getElementById('topActiveExamTitle').textContent = `${data.activeExam.title} [${sessTerm || '2026/2027 • 1st Term'}]`;
    } else {
      document.getElementById('topActiveExamTitle').textContent = 'No Exam Active';
    }

    updateSelfRegBtn(data.allowSelfRegister === true);
    updateAutoSyncBtn(data.autoCloudSync === true);

    if (data.studentUrl) {
      document.getElementById('studentLanUrl').textContent = data.studentUrl;
    }

    // Connect SSE for Sub-second Realtime Updates
    connectRealtimeEvents();

    // Start Realtime Live Polling
    startLivePolling();

    // Load initial data
    fetchStudents(true);
    fetchLiveMonitor();
    loadBrandingForm();

  } catch (err) {
    console.error('Failed to init admin:', err);
    document.getElementById('connectionStatusText').textContent = 'Server Offline';
  }
}

function applyAdminBranding(branding) {
  if (branding.schoolName) {
    document.getElementById('sideSchoolName').textContent = branding.schoolName;
  }
  if (branding.schoolCode) {
    document.getElementById('sideSchoolCode').textContent = branding.schoolCode;
  }
  const logoImg = document.getElementById('sideLogo');
  const fallback = document.getElementById('sideLogoFallback');
  if (branding.schoolLogo && branding.schoolLogo.trim()) {
    if (logoImg) {
      logoImg.src = branding.schoolLogo;
      logoImg.style.display = 'block';
    }
    if (fallback) fallback.style.display = 'none';
  } else {
    if (logoImg) {
      logoImg.src = '';
      logoImg.style.display = 'none';
    }
    if (fallback) fallback.style.display = 'block';
  }
  if (branding.primaryColor) {
    document.documentElement.style.setProperty('--admin-primary', branding.primaryColor);
  }
}

// REALTIME SERVER-SENT EVENTS
function connectRealtimeEvents() {
  if (eventSource) eventSource.close();

  // EventSource can't send headers, so the token rides as a query param (the server
  // auth gate accepts ?token= for exactly this stream).
  eventSource = new EventSource('/api/events?token=' + encodeURIComponent(adminToken));

  eventSource.onopen = () => {
    document.getElementById('connectionStatusText').textContent = 'Realtime Stream Active';
  };

  eventSource.addEventListener('student_joined', (e) => {
    fetchLiveMonitor();
    fetchStudents(true);
  });

  eventSource.addEventListener('student_progress', (e) => {
    const data = JSON.parse(e.data);
    updateCandidateRowProgress(data.regNo, data.answeredCount, data.timeRemaining);
  });

  eventSource.addEventListener('student_submitted', (e) => {
    const sub = JSON.parse(e.data);
    showInstantDropAlert(sub);
    fetchLiveMonitor();
    fetchStudents(true);
  });

  eventSource.addEventListener('branding_updated', (e) => {
    const updated = JSON.parse(e.data);
    applyAdminBranding(updated);
  });

  eventSource.onerror = () => {
    document.getElementById('connectionStatusText').textContent = 'Reconnecting...';
  };
}

function showInstantDropAlert(sub) {
  const banner = document.getElementById('instantDropNotification');
  document.getElementById('dropCandidateName').textContent = sub.studentName;
  document.getElementById('dropCandidateScore').textContent = `Score: ${sub.percentage}% (${sub.score}/${sub.totalMarks})`;

  banner.style.display = 'flex';
  playBeep();

  setTimeout(() => {
    banner.style.display = 'none';
  }, 8000);
}

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch (e) {}
}

// LIVE MONITOR TAB
let livePollingTimer = null;

function startLivePolling() {
  if (livePollingTimer) clearInterval(livePollingTimer);
  livePollingTimer = setInterval(() => {
    const tabLive = document.getElementById('tabLive');
    if (tabLive && tabLive.classList.contains('active')) {
      fetchLiveMonitor();
    }
  }, 2500);
}

async function fetchLiveMonitor() {
  try {
    const res = await fetch('/api/admin/live-monitor');
    const data = await res.json();

    const writingCount = (data.candidates || []).filter(c => c.status === 'WRITING').length;
    document.getElementById('statRegistered').textContent = data.totalRegistered || 0;
    document.getElementById('statWriting').textContent = writingCount;
    document.getElementById('statSubmitted').textContent = data.totalSubmitted || 0;
    document.getElementById('liveConnectedBadge').textContent = writingCount;

    // Calculate average score of submitted
    if (data.recentSubmissions && data.recentSubmissions.length > 0) {
      const sum = data.recentSubmissions.reduce((acc, cur) => acc + (cur.percentage || 0), 0);
      const avg = Math.round(sum / data.recentSubmissions.length);
      document.getElementById('statAverage').textContent = `${avg}%`;
    }

    renderLiveTable(data.candidates || [], data.recentSubmissions || []);
  } catch (err) {
    console.error('Failed to fetch live monitor:', err);
  }
}

function renderLiveTable(candidates, submissions) {
  const tbody = document.getElementById('liveCandidatesBody');
  tbody.innerHTML = '';

  const subMap = {};
  submissions.forEach(s => { subMap[(s.regNo || '').toLowerCase()] = s; });

  // Merge live sessions and submissions so no candidate is missed
  const mergedMap = new Map();
  candidates.forEach(c => {
    const key = (c.regNo || '').toLowerCase();
    mergedMap.set(key, { ...c });
  });

  submissions.forEach(s => {
    const key = (s.regNo || '').toLowerCase();
    if (!mergedMap.has(key)) {
      mergedMap.set(key, {
        regNo: s.regNo,
        name: s.studentName || s.name || s.regNo,
        classLevel: s.classLevel || '',
        status: 'SUBMITTED',
        score: s.score,
        totalMarks: s.totalMarks,
        percentage: s.percentage,
        timeRemaining: 0,
        totalQuestions: s.totalQuestions || 20,
        answeredCount: s.totalMarks || 20
      });
    }
  });

  const allRows = Array.from(mergedMap.values());

  if (allRows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-20">Waiting for candidates to log in from student terminals...</td></tr>`;
    return;
  }

  allRows.forEach(c => {
    const sub = subMap[(c.regNo || '').toLowerCase()];
    const tr = document.createElement('tr');
    tr.id = `row-${(c.regNo || '').replace(/[^a-zA-Z0-9]/g, '-')}`;

    const isSubmitted = c.status === 'SUBMITTED' || !!sub;
    const isWriting = c.status === 'WRITING' && !isSubmitted;
    const isOffline = c.status === 'DISCONNECTED' && !isSubmitted;

    const totalQ = c.totalQuestions || (sub ? (sub.totalMarks || 20) : 20);
    const answered = isSubmitted
      ? (sub ? (sub.answeredCount || totalQ) : totalQ)
      : (c.answeredCount || 0);

    const progressPercent = Math.min(100, Math.round((answered / (totalQ || 1)) * 100));

    let statusPill = `<span class="status-pill status-writing"><span class="pulse-dot"></span>WRITING</span>`;
    let scoreDisplay = `<span class="text-muted">In Progress</span>`;

    if (isOffline) {
      statusPill = `<span class="status-pill status-offline">⚠️ OFFLINE</span>`;
      scoreDisplay = `<span class="text-muted">Last at Q${c.currentQuestion || 1}</span>`;
    } else if (isSubmitted) {
      const percent = sub ? sub.percentage : (c.percentage !== undefined ? c.percentage : 0);
      const score = sub ? sub.score : (c.score !== undefined ? c.score : 0);
      const total = sub ? sub.totalMarks : totalQ;
      statusPill = `<span class="status-pill status-submitted">✅ SUBMITTED</span>`;
      scoreDisplay = `<strong style="color:var(--admin-primary);">${score}/${total} (${percent}%)</strong>`;
    }

    const mins = Math.floor((c.timeRemaining || 0) / 60);
    const secs = (c.timeRemaining || 0) % 60;
    const timeFormatted = isSubmitted ? 'Completed' : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    // Candidate with saved-but-not-submitted answers (e.g. device crashed) → let the invigilator submit for them.
    const hasSaved = (c.answeredCount || 0) > 0;
    const forceBtn = (!isSubmitted && hasSaved)
      ? ` <button class="btn btn-outline btn-sm" onclick="forceSubmitCandidate('${c.regNo}', '${(c.name || '').replace(/'/g, "\\'")}')" title="Submit this candidate's auto-saved answers (use if their device crashed)">⏎ Force Submit</button>`
      : '';
    if (!isSubmitted && hasSaved && isOffline) statusPill += ' <span class="badge-tag" title="Answers saved on server, not yet submitted">💾 saved</span>';

    tr.innerHTML = `
      <td><code>${c.regNo}</code></td>
      <td><strong>${c.name}</strong></td>
      <td>${c.classLevel || 'SS 2'}</td>
      <td>
        <div style="display:flex; align-items:center; gap:8px;">
          <div class="progress-track">
            <div class="progress-fill" style="width:${progressPercent}%;"></div>
          </div>
          <small style="font-weight:700;">${answered}/${totalQ}</small>
        </div>
      </td>
      <td>${statusPill}</td>
      <td><span style="font-family:monospace; font-weight:700; ${isWriting ? 'color:#15803d;' : ''}">${timeFormatted}</span></td>
      <td>${scoreDisplay}${forceBtn}</td>
    `;
    tbody.appendChild(tr);
  });
}

function updateCandidateRowProgress(regNo, answeredCount, timeRemaining) {
  fetchLiveMonitor();
}

// Download a full backup of this terminal's data (settings, students, exams, results).
async function downloadBackup() {
  try {
    const data = await (await fetch('/api/admin/backup')).json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const code = (data.settings && data.settings.schoolCode) || 'cbt';
    a.download = `COTHI_Backup_${code}_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) { alert('Could not create backup.'); }
}

// Restore the terminal from a backup file (overwrites current data).
function restoreBackup(input) {
  const file = input.files[0];
  if (!file) return;
  if (!confirm('Restore from this backup?\n\nThis REPLACES the current candidates, exams, results and settings on this terminal. Make a backup first if unsure.')) { input.value = ''; return; }
  const reader = new FileReader();
  reader.onload = async function (e) {
    input.value = '';
    let bundle;
    try { bundle = JSON.parse(e.target.result); } catch (err) { alert('That is not a valid backup file.'); return; }
    try {
      const res = await fetch('/api/admin/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bundle) });
      const data = await res.json();
      if (data.success) { alert(`Restored: ${data.students} candidates, ${data.exams} exams, ${data.submissions} results.`); initAdmin(); switchTab('tabStudents'); }
      else alert(data.message || 'Restore failed.');
    } catch (err) { alert('Failed to reach the server to restore.'); }
  };
  reader.readAsText(file);
}

// Toggle automatic cloud sync (refresh questions + push results every 30 min when online).
function updateAutoSyncBtn(on) {
  const b = document.getElementById('autoSyncBtn');
  if (!b) return;
  b.textContent = '🔄 Auto-Sync: ' + (on ? 'ON' : 'OFF');
  b.classList.toggle('btn-success', !!on);
  b.classList.toggle('btn-outline', !on);
}
async function toggleAutoCloudSync() {
  try {
    const st = await (await fetch('/api/status')).json();
    const next = !st.autoCloudSync;
    const res = await fetch('/api/admin/branding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoCloudSync: next }) });
    if ((await res.json()).success) { updateAutoSyncBtn(next); alert('Automatic cloud sync ' + (next ? 'ENABLED — the server will refresh questions and push results every 30 minutes whenever it has internet.' : 'disabled.')); }
  } catch (e) { alert('Could not change the setting.'); }
}

// Toggle candidate self-registration (admin-controlled; off by default).
function updateSelfRegBtn(on) {
  const b = document.getElementById('selfRegBtn');
  if (!b) return;
  b.textContent = '🆔 Self-Register: ' + (on ? 'ON' : 'OFF');
  b.classList.toggle('btn-success', !!on);
  b.classList.toggle('btn-outline', !on);
}
async function toggleSelfRegister() {
  try {
    const st = await (await fetch('/api/status')).json();
    const next = !st.allowSelfRegister;
    if (next && !confirm('Enable candidate SELF-REGISTRATION?\n\nCandidates who are NOT in the roster will be able to add themselves at the exam terminal and sit the exam. Turn this off once registration closes.')) return;
    const res = await fetch('/api/admin/branding', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowSelfRegister: next })
    });
    if ((await res.json()).success) { updateSelfRegBtn(next); alert('Self-registration ' + (next ? 'ENABLED' : 'disabled') + '.'); }
  } catch (e) { alert('Could not change the setting.'); }
}

// Bulk-upload candidate photos (OPTIONAL). Each image's filename (minus extension)
// is matched to a candidate's reg number. Photos are resized before upload.
async function uploadBulkPhotos(input) {
  const files = Array.from(input.files || []);
  if (!files.length) return;
  const resize = (file) => new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const max = 360, scale = Math.min(1, max / Math.max(img.width, img.height));
        const cw = Math.max(1, Math.round(img.width * scale)), ch = Math.max(1, Math.round(img.height * scale));
        const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
        const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch); ctx.drawImage(img, 0, 0, cw, ch);
        try { resolve(cv.toDataURL('image/jpeg', 0.82)); } catch (err) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });

  const photos = [];
  for (const f of files) {
    if (!/^image\//.test(f.type)) continue;
    const regNo = f.name.replace(/\.[^.]+$/, '').trim(); // filename without extension
    const dataUrl = await resize(f);
    if (dataUrl) photos.push({ regNo, photo: dataUrl });
  }
  input.value = '';
  if (!photos.length) { alert('No valid image files found.'); return; }
  try {
    const res = await fetch('/api/admin/students/photos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photos })
    });
    const data = await res.json();
    if (data.success) {
      let msg = `Matched ${data.matched} of ${data.total} photo(s) to candidates.`;
      if (data.unmatched && data.unmatched.length) msg += `\n\nNot matched (check the file names = reg numbers):\n` + data.unmatched.slice(0, 15).join(', ');
      alert(msg);
      fetchStudents(true);
    } else alert(data.message || 'Photo upload failed.');
  } catch (e) { alert('Failed to reach the server for photo upload.'); }
}

// Printable exam-hall attendance sheet (registered vs present vs submitted + signature column).
function printAttendanceSheet() {
  const list = (allStudentsList || []).slice().sort((a, b) => (a.classLevel || '').localeCompare(b.classLevel || '') || (a.name || '').localeCompare(b.name || ''));
  if (!list.length) { alert('No candidates to list. Load a school first.'); return; }
  const b = currentBranding || {};
  const school = b.schoolName || 'COTHI CBT';
  const motto = b.schoolMotto || '';
  const exam = (currentActiveExam && currentActiveExam.title) ? currentActiveExam.title : 'Examination';
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const statusWord = s => s.status === 'submitted' ? 'Submitted' : (s.status === 'active' ? 'Present' : (s.status === 'offline' ? 'Disconnected' : 'Absent'));
  const rows = list.map((s, i) => `
    <tr>
      <td>${i + 1}</td>
      <td style="font-family:monospace;">${esc(s.regNo)}</td>
      <td>${esc(s.name)}</td>
      <td>${esc(s.classLevel || '')}</td>
      <td style="text-align:center;">${statusWord(s)}</td>
      <td></td>
    </tr>`).join('');
  const present = list.filter(s => s.status === 'active' || s.status === 'submitted' || s.status === 'offline').length;
  const submitted = list.filter(s => s.status === 'submitted').length;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Attendance — ${esc(exam)}</title>
    <style>
      body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;padding:24px;}
      h1{font-size:18px;margin:0;} .sub{color:#555;font-size:12px;margin:2px 0 2px;}
      .meta{display:flex;justify-content:space-between;font-size:12px;margin:12px 0;}
      table{width:100%;border-collapse:collapse;font-size:12px;} th,td{border:1px solid #333;padding:6px 8px;}
      th{background:#1e3a8a;color:#fff;text-align:left;} td{height:26px;}
      .foot{margin-top:18px;font-size:12px;display:flex;justify-content:space-between;}
      @media print{button{display:none;}}
    </style></head><body>
    <div style="text-align:center;border-bottom:2px solid #1e3a8a;padding-bottom:8px;">
      <h1>${esc(school)}</h1><div class="sub">${esc(motto)}</div>
      <div class="sub"><strong>EXAMINATION ATTENDANCE SHEET</strong></div>
    </div>
    <div class="meta"><span><strong>Exam:</strong> ${esc(exam)}</span><span><strong>Date:</strong> ${today}</span><span><strong>Registered:</strong> ${list.length} &nbsp; <strong>Present:</strong> ${present} &nbsp; <strong>Submitted:</strong> ${submitted}</span></div>
    <table><thead><tr><th style="width:36px;">#</th><th>Reg No</th><th>Candidate Name</th><th>Class</th><th style="width:90px;text-align:center;">Status</th><th style="width:150px;">Signature</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="foot"><span>Invigilator: ______________________</span><span>Signature: ______________________</span><span>Date: ______________</span></div>
    <button onclick="window.print()" style="margin-top:16px;padding:8px 16px;">🖨️ Print</button>
    </body></html>`;
  const w = window.open('', '_blank');
  if (!w) { alert('Allow pop-ups to print the attendance sheet.'); return; }
  w.document.write(html); w.document.close();
}

// Invigilator submits a candidate's auto-saved answers (device crash recovery).
async function forceSubmitCandidate(regNo, name) {
  if (!confirm(`Force-submit ${name || regNo}?\n\nThis submits the answers auto-saved on the server for this candidate. Use it only if their device crashed or froze.`)) return;
  try {
    const res = await fetch('/api/admin/force-submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ regNo })
    });
    const data = await res.json();
    if (data.success) { alert(`Submitted for ${data.submission.studentName}: ${data.submission.score}/${data.submission.totalMarks} (${data.submission.percentage}%, ${data.submission.gradeBand}).`); fetchLiveMonitor(); }
    else alert(data.message || 'Could not force-submit.');
  } catch (e) { alert('Failed to reach the server.'); }
}

function filterLiveTable() {
  const query = document.getElementById('liveSearchInput').value.toLowerCase();
  const rows = document.querySelectorAll('#liveCandidatesBody tr');
  rows.forEach(r => {
    r.style.display = r.textContent.toLowerCase().includes(query) ? '' : 'none';
  });
}

function copyStudentUrl() {
  const url = document.getElementById('studentLanUrl').textContent;
  navigator.clipboard.writeText(url).then(() => {
    alert('Student exam URL copied to clipboard: ' + url);
  });
}

// Wipe this terminal clean for a new school (keeps admin login + cloud settings).
async function resetTerminalForNewSchool() {
  if (!confirm('Reset this terminal for a NEW school?\n\nThis clears ALL current candidates, exams, submissions and branding on THIS PC. Your admin login and COTHI cloud settings are kept.\n\nContinue?')) return;
  if (!confirm('Are you sure? This cannot be undone.')) return;
  try {
    const res = await fetch('/api/admin/reset-terminal', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const data = await res.json();
    if (data.success) {
      alert('Terminal reset. This PC is now a clean slate — select the new school and sync its data.');
      initAdmin();
      switchTab('tabSchoolSelect');
    } else {
      alert(data.message || 'Reset failed.');
    }
  } catch (e) {
    alert('Could not reach the server to reset.');
  }
}

// Show a QR code of the student exam URL so phones/tablets can scan to join (offline).
function showStudentQR() {
  const url = (document.getElementById('studentLanUrl').textContent || '').trim();
  const holder = document.getElementById('studentQrHolder');
  const urlEl = document.getElementById('studentQrUrl');
  if (urlEl) urlEl.textContent = url;
  holder.innerHTML = '';
  if (typeof qrcode === 'undefined') {
    holder.textContent = 'QR generator not loaded.';
  } else if (/localhost|127\.0\.0\.1/.test(url)) {
    holder.innerHTML = '<p style="color:#b45309; font-size:.85rem; max-width:320px;">This PC is showing a local address. Connect the server PC to the school Wi-Fi so it shows a network address (e.g. 192.168.x.x) that phones can reach, then reopen this QR.</p>';
  } else {
    try {
      const qr = qrcode(0, 'M');      // auto size, medium error correction
      qr.addData(url);
      qr.make();
      holder.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
      const svg = holder.querySelector('svg');
      if (svg) { svg.style.width = '240px'; svg.style.height = '240px'; }
    } catch (e) {
      holder.textContent = 'Could not generate QR for this URL.';
    }
  }
  document.getElementById('studentQrModal').style.display = 'flex';
}

function closeStudentQR() {
  document.getElementById('studentQrModal').style.display = 'none';
}

// TAB 2: QUESTION BUILDER
// --- Math toolbar + diagram/image support for the Question Builder ----------
window.lastMathField = 'qText';
window._builderImages = { question: null, A: null, B: null, C: null, D: null };

// --- Reading passage / cloze authoring --------------------------------------
window._builderPassages = [];   // [{ id, title, text, image }]
window._activePassageId = null; // questions added now attach to this passage
window._passageImage = null;

function handlePassageImage(input) {
  const file = input.files[0];
  if (!file) return;
  if (!/^image\//.test(file.type)) { alert('Please choose an image file.'); input.value = ''; return; }
  resizeImageFile(file, 1000, function (dataUrl) {
    if (!dataUrl || !window.CBTMath || !CBTMath.isImage(dataUrl)) { alert('Could not process this image.'); input.value = ''; return; }
    window._passageImage = dataUrl;
    const t = document.getElementById('passageImageThumb');
    if (t) { t.src = dataUrl; t.style.display = 'block'; }
  });
}

function startPassage() {
  const title = document.getElementById('passageTitle').value.trim();
  const text = document.getElementById('passageText').value.trim();
  if (!text && !window._passageImage) { alert('Enter the passage text (or add a passage image) before starting.'); return; }

  let p = window._builderPassages.find(x => x.id === window._activePassageId);
  if (p) {
    p.title = title; p.text = text; p.image = window._passageImage || null;
  } else {
    p = { id: 'p-' + Date.now() + '-' + window._builderPassages.length, title: title, text: text, image: window._passageImage || null };
    window._builderPassages.push(p);
    window._activePassageId = p.id;
  }
  const label = document.getElementById('activePassageLabel');
  if (label) label.textContent = '● Questions you add now attach to: "' + (title || 'Untitled passage') + '"';
}

function finishPassage() {
  window._activePassageId = null;
  window._passageImage = null;
  ['passageTitle', 'passageText'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const f = document.getElementById('passageImageFile'); if (f) f.value = '';
  const t = document.getElementById('passageImageThumb'); if (t) { t.style.display = 'none'; t.removeAttribute('src'); }
  const label = document.getElementById('activePassageLabel');
  if (label) label.textContent = 'Passage finished. New questions are standalone again.';
}

// Keep only passages actually referenced by at least one question.
function usedBuilderPassages() {
  const used = new Set(builderQuestions.map(q => q.passageId).filter(Boolean));
  return window._builderPassages.filter(p => used.has(p.id));
}

function resetBuilderPassages() {
  window._builderPassages = [];
  window._activePassageId = null;
  window._passageImage = null;
  finishPassage();
}

// Insert a LaTeX snippet into the last-focused question/option field at the caret.
function insertMath(snippet) {
  const id = window.lastMathField || 'qText';
  const el = document.getElementById(id);
  if (!el) return;
  el.focus();
  const start = (el.selectionStart != null) ? el.selectionStart : el.value.length;
  const end = (el.selectionEnd != null) ? el.selectionEnd : el.value.length;
  el.value = el.value.slice(0, start) + snippet + el.value.slice(end);
  // Drop the caret into the first "{ }" placeholder, or between "$  $".
  let caret = start + snippet.length;
  const brace = snippet.indexOf('{ }');
  const dollar = snippet.indexOf('$  $');
  if (brace >= 0) caret = start + brace + 1;
  else if (dollar >= 0) caret = start + dollar + 1;
  try { el.selectionStart = el.selectionEnd = caret; } catch (e) {}
  el.focus();
  updateQuestionPreview();
}

// Load an image file, downscale if large, return a data URL via callback.
function resizeImageFile(file, maxDim, cb) {
  const reader = new FileReader();
  reader.onload = function (e) {
    const dataUrl = e.target.result;
    const img = new Image();
    img.onload = function () {
      const w = img.width, h = img.height;
      const keepOriginal = (file.size < 250 * 1024) && /image\/(png|gif|webp)/.test(file.type);
      if (w <= maxDim && h <= maxDim && keepOriginal) { cb(dataUrl); return; }
      const scale = Math.min(1, maxDim / Math.max(w, h));
      const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = ch;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(img, 0, 0, cw, ch);
      let out;
      try { out = canvas.toDataURL('image/jpeg', 0.85); } catch (err) { out = dataUrl; }
      cb(out);
    };
    img.onerror = function () { cb(null); };
    img.src = dataUrl;
  };
  reader.onerror = function () { cb(null); };
  reader.readAsDataURL(file);
}

function handleBuilderImage(input, slot) {
  const file = input.files[0];
  if (!file) return;
  if (!/^image\//.test(file.type)) { alert('Please choose an image file (PNG, JPG, GIF, WEBP).'); input.value = ''; return; }
  resizeImageFile(file, 900, function (dataUrl) {
    if (!dataUrl || !window.CBTMath || !CBTMath.isImage(dataUrl)) {
      alert('Could not process this image. Try a PNG or JPG.');
      input.value = '';
      return;
    }
    window._builderImages[slot] = dataUrl;
    if (slot === 'question') {
      const thumb = document.getElementById('qImageThumb');
      thumb.src = dataUrl; thumb.style.display = 'block';
      document.getElementById('qImageName').textContent = file.name;
      document.getElementById('qImageClear').style.display = 'inline-flex';
    } else {
      const clr = document.getElementById('opt' + slot + 'ImageClear');
      if (clr) clr.style.display = 'inline-flex';
    }
    updateQuestionPreview();
  });
}

function clearBuilderImage(slot) {
  window._builderImages[slot] = null;
  if (slot === 'question') {
    const f = document.getElementById('qImageFile'); if (f) f.value = '';
    const t = document.getElementById('qImageThumb'); if (t) { t.style.display = 'none'; t.removeAttribute('src'); }
    const n = document.getElementById('qImageName'); if (n) n.textContent = '';
    const c = document.getElementById('qImageClear'); if (c) c.style.display = 'none';
  } else {
    const idx = { A: 0, B: 1, C: 2, D: 3 }[slot];
    const inputs = document.querySelectorAll('#tabCreate .opt-img-input');
    if (inputs[idx]) inputs[idx].value = '';
    const clr = document.getElementById('opt' + slot + 'ImageClear');
    if (clr) clr.style.display = 'none';
  }
  updateQuestionPreview();
}

// Live preview of the question exactly as the student kiosk will render it.
function updateQuestionPreview() {
  const el = document.getElementById('qLivePreview');
  if (!el || !window.CBTMath) return;
  el.innerHTML = '';
  const imgs = window._builderImages || {};
  if (imgs.question) {
    const im = CBTMath.makeImg(imgs.question, 'cbt-img');
    if (im) { im.style.maxHeight = '140px'; el.appendChild(im); }
  }
  const qDiv = document.createElement('div');
  qDiv.style.fontWeight = '600'; qDiv.style.marginBottom = '6px';
  const qt = (document.getElementById('qText').value || '').trim();
  CBTMath.applyTo(qDiv, qt || '(question preview appears here)');
  el.appendChild(qDiv);
  ['A', 'B', 'C', 'D'].forEach(L => {
    const t = (document.getElementById('opt' + L).value || '').trim();
    const oi = imgs[L];
    if (!t && !oi) return;
    const row = document.createElement('div');
    row.style.margin = '3px 0';
    const tag = document.createElement('strong');
    tag.textContent = L + '. ';
    row.appendChild(tag);
    const span = document.createElement('span');
    CBTMath.applyTo(span, t || '');
    row.appendChild(span);
    el.appendChild(row);
    if (oi) { const im = CBTMath.makeImg(oi, 'cbt-opt-img'); if (im) el.appendChild(im); }
  });
}

function addQuestionToList() {
  const text = document.getElementById('qText').value.trim();
  const optA = document.getElementById('optA').value.trim();
  const optB = document.getElementById('optB').value.trim();
  const optC = document.getElementById('optC').value.trim();
  const optD = document.getElementById('optD').value.trim();
  const correct = document.querySelector('input[name="correctOpt"]:checked').value;
  const marks = parseFloat(document.getElementById('qMarks').value) || 1;
  const explanation = document.getElementById('qExplanation').value.trim();

  const imgs = window._builderImages || {};
  const optionImages = {};
  ['A', 'B', 'C', 'D'].forEach(L => { if (imgs[L]) optionImages[L] = imgs[L]; });

  // A question needs text or an image; options A & B need text or an image each.
  if (!text && !imgs.question) {
    alert('Please enter the question text, or add a question image.');
    return;
  }
  const aOk = optA || imgs.A, bOk = optB || imgs.B;
  if (!aOk || !bOk) {
    alert('Please provide at least Options A and B (text or image).');
    return;
  }
  const correctContent = { A: optA || imgs.A, B: optB || imgs.B, C: optC || imgs.C, D: optD || imgs.D }[correct];
  if (!correctContent) {
    alert('The option marked "Correct" is empty. Add its text/image or change which option is correct.');
    return;
  }

  const q = {
    id: 'q-' + Date.now() + '-' + builderQuestions.length,
    question: text,
    options: { A: optA, B: optB, C: optC, D: optD },
    correctAnswer: correct,
    marks: marks,
    explanation: explanation
  };
  if (imgs.question) q.image = imgs.question;
  if (Object.keys(optionImages).length) q.optionImages = optionImages;
  if (window._activePassageId) q.passageId = window._activePassageId;

  builderQuestions.push(q);
  renderBuilderQuestions();
  clearQuestionInputs();
}

function clearQuestionInputs() {
  document.getElementById('qText').value = '';
  document.getElementById('optA').value = '';
  document.getElementById('optB').value = '';
  document.getElementById('optC').value = '';
  document.getElementById('optD').value = '';
  document.getElementById('qExplanation').value = '';
  document.querySelector('input[name="correctOpt"][value="A"]').checked = true;
  ['question', 'A', 'B', 'C', 'D'].forEach(clearBuilderImage);
  window.lastMathField = 'qText';
  updateQuestionPreview();
  document.getElementById('qText').focus();
}

function renderBuilderQuestions() {
  const container = document.getElementById('questionsPreviewList');
  document.getElementById('totalQuestionsInBuilder').textContent = builderQuestions.length;
  document.getElementById('questionCountBadge').textContent = `${builderQuestions.length} Questions Added`;

  if (builderQuestions.length === 0) {
    container.innerHTML = `<p class="text-muted text-center py-20">No questions added yet. Use the builder above to add questions.</p>`;
    return;
  }

  container.innerHTML = '';
  const M = window.CBTMath;
  builderQuestions.forEach((q, idx) => {
    const item = document.createElement('div');
    item.style.cssText = 'padding:14px; border:1px solid #e2e8f0; border-radius:8px; margin-bottom:10px; background:#fff;';

    const head = document.createElement('div');
    head.style.cssText = 'display:flex; justify-content:space-between; margin-bottom:6px;';
    const title = document.createElement('strong');
    let titleText = `Question ${idx + 1} (${q.marks} marks)`;
    if (q.passageId) {
      const p = (window._builderPassages || []).find(x => x.id === q.passageId);
      titleText += '  📖 ' + (p && p.title ? ('[' + p.title.slice(0, 40) + ']') : '[passage]');
    }
    title.textContent = titleText;
    const del = document.createElement('button');
    del.className = 'btn btn-outline-danger btn-sm';
    del.textContent = 'Delete';
    del.onclick = () => removeBuilderQuestion(idx);
    head.appendChild(title); head.appendChild(del);
    item.appendChild(head);

    if (q.image && M) { const im = M.makeImg(q.image, 'cbt-img'); if (im) { im.style.maxHeight = '130px'; item.appendChild(im); } }

    const qp = document.createElement('p');
    qp.style.cssText = 'margin-bottom:8px; font-weight:600;';
    if (M) M.applyTo(qp, q.question); else qp.textContent = q.question;
    item.appendChild(qp);

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:6px; font-size:0.85rem;';
    ['A', 'B', 'C', 'D'].forEach(L => {
      const cell = document.createElement('div');
      const lab = document.createElement('span');
      lab.textContent = L + ': ';
      cell.appendChild(lab);
      const val = document.createElement('span');
      if (M) M.applyTo(val, (q.options && q.options[L]) || ''); else val.textContent = (q.options && q.options[L]) || '';
      cell.appendChild(val);
      if (q.correctAnswer === L) cell.appendChild(document.createTextNode(' ✅'));
      if (q.optionImages && q.optionImages[L] && M) {
        const im = M.makeImg(q.optionImages[L], 'cbt-opt-img');
        if (im) { im.style.maxHeight = '80px'; cell.appendChild(im); }
      }
      grid.appendChild(cell);
    });
    item.appendChild(grid);
    container.appendChild(item);
  });
}

function removeBuilderQuestion(idx) {
  builderQuestions.splice(idx, 1);
  renderBuilderQuestions();
}

async function saveAndDeployExam() {
  const title = document.getElementById('newExamTitle').value.trim();
  const subject = document.getElementById('newExamSubject').value.trim();
  const classLevel = document.getElementById('newExamClass').value.trim();
  const duration = parseInt(document.getElementById('newExamDuration').value) || 45;
  const pass = parseInt(document.getElementById('newExamPass').value) || 50;
  const session = document.getElementById('newExamSession') ? document.getElementById('newExamSession').value : '2026/2027';
  const term = document.getElementById('newExamTerm') ? document.getElementById('newExamTerm').value : '1st Term';
  const instructions = document.getElementById('newExamInstructions').value.trim();
  const examDate = document.getElementById('newExamDate') ? document.getElementById('newExamDate').value : '';
  const examTime = document.getElementById('newExamTime') ? document.getElementById('newExamTime').value : '';
  const scheduledStart = examDate ? (examDate + 'T' + (examTime || '08:00')) : '';

  if (!title || !subject || !classLevel) {
    alert('Please complete the Exam Title, Subject, and Class Level.');
    return;
  }

  if (builderQuestions.length === 0) {
    alert('Please add at least 1 question to the exam.');
    return;
  }

  const maxTrials = parseInt(document.getElementById('newExamTrials') ? document.getElementById('newExamTrials').value : '1') || 1;
  const shuffleQuestions = document.getElementById('newExamShuffleQ') ? document.getElementById('newExamShuffleQ').checked : true;
  const shuffleOptions = document.getElementById('newExamShuffleO') ? document.getElementById('newExamShuffleO').checked : true;

  const examPayload = {
    title,
    subject,
    classLevel,
    session,
    term,
    durationMinutes: duration,
    passPercentage: pass,
    instructions,
    scheduledStart,
    maxTrials,
    shuffleQuestions,
    shuffleOptions,
    questions: builderQuestions,
    passages: usedBuilderPassages()
  };

  try {
    const res = await fetch('/api/admin/exams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(examPayload)
    });
    const data = await res.json();

    if (data.success) {
      resetBuilderPassages();
      if (scheduledStart) {
        // Scheduled: the server auto-activates it at the set time (don't go live now)
        const when = new Date(scheduledStart).toLocaleString();
        alert(`Exam "${data.exam.title}" saved and SCHEDULED for ${when}. It will go live automatically at that time.`);
        initAdmin();
        switchTab('tabExams');
      } else {
        // No date: activate immediately as before
        await fetch('/api/admin/exams/set-active', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ examId: data.exam.id, session, term })
        });
        alert(`Exam "${data.exam.title}" (${session} • ${term}) created and activated as the current Offline CBT exam!`);
        initAdmin();
        switchTab('tabLive');
      }
    }
  } catch (err) {
    alert('Failed to save exam to local server.');
  }
}

// Bulk Question Import
let parsedBulkQuestions = [];

// Robust CSV line splitter: handles quoted fields, commas inside quotes,
// escaped "" quotes, AND empty fields (,,) which the old regex silently dropped.
function parseCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
      } else { cur += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { fields.push(cur); cur = ''; }
      else cur += c;
    }
  }
  fields.push(cur);
  return fields.map(f => f.trim());
}

// Normalise a correct-answer cell to a letter A-D. Accepts a letter, or the full
// option text (matched case-insensitively against the options). Returns null if invalid.
function normalizeCorrectAnswer(ans, options) {
  const raw = (ans == null ? '' : String(ans)).trim();
  if (/^[A-Da-d]$/.test(raw)) return raw.toUpperCase();
  const up = raw.toUpperCase();
  for (const L of ['A', 'B', 'C', 'D']) {
    if ((options[L] == null ? '' : String(options[L])).trim().toUpperCase() === up && up !== '') return L;
  }
  return null;
}

// Validate one parsed question. An option/question counts as present if it has
// text OR an image. Returns an array of problems (empty = valid).
function validateBulkQuestion(q) {
  const errs = [];
  const imgs = q.optionImages || {};
  if ((!q.question || !q.question.trim()) && !q.image) errs.push('missing question text/image');
  const filled = ['A', 'B', 'C', 'D'].filter(L => ((q.options[L] || '').toString().trim() !== '') || imgs[L]);
  if (filled.length < 2) errs.push('needs at least 2 options');
  if (!q.correctAnswer) errs.push('correct answer must be A-D (or match an option exactly)');
  else if (((q.options[q.correctAnswer] || '').toString().trim() === '') && !imgs[q.correctAnswer]) errs.push('correct answer points to an empty option');
  return errs;
}

function downloadQuestionTemplate() {
  const csvContent = "question,optionA,optionB,optionC,optionD,correctAnswer,marks,explanation,image\n" +
    "\"What is the standard unit of electric current?\",\"Ampere\",\"Volt\",\"Ohm\",\"Watt\",\"A\",2,\"Current is measured in Amperes (A).\",\n" +
    "\"Which organelle is the powerhouse of the cell?\",\"Ribosome\",\"Nucleus\",\"Mitochondria\",\"Golgi apparatus\",\"C\",2,\"Mitochondria generates ATP.\",\n" +
    "\"Solve $\\frac{3x-9}{2}=0$ for x\",\"x=1\",\"x=2\",\"x=3\",\"x=4\",\"C\",2,\"3x=9 so x=3. Wrap maths in dollar signs.\",\n" +
    "\"Evaluate $\\sqrt{144}$\",\"10\",\"11\",\"12\",\"13\",\"C\",1,\"Square root of 144 is 12.\",\n";
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = "COTHI_Question_Import_Template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function parseQuestionBulkFile(input) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const text = e.target.result;
    parsedBulkQuestions = [];
    window._bulkPassages = [];
    const skipped = []; // { row, reason }
    const imgOk = (u) => window.CBTMath && CBTMath.isImage(u);

    try {
      if (file.name.endsWith('.json')) {
        const json = JSON.parse(text);
        let list;
        if (Array.isArray(json)) {
          list = json;
        } else if (json && Array.isArray(json.questions)) {
          list = json.questions;
          const ps = Array.isArray(json.passages) ? json.passages : [];
          window._bulkPassages = ps.filter(p => p && p.id).map(p => ({
            id: String(p.id),
            title: (p.title || '').toString(),
            text: (p.text || '').toString(),
            image: imgOk(p.image) ? String(p.image).trim() : null
          }));
        } else {
          throw new Error('JSON must be an array of questions, or an object { passages, questions }.');
        }
        list.forEach((q, idx) => {
          const options = q.options || { A: q.optionA, B: q.optionB, C: q.optionC, D: q.optionD };
          ['A', 'B', 'C', 'D'].forEach(L => { options[L] = (options[L] == null ? '' : String(options[L])).trim(); });
          const candidate = {
            id: 'q-' + Date.now() + '-' + idx,
            question: (q.question || '').toString().trim(),
            options: options,
            correctAnswer: normalizeCorrectAnswer(q.correctAnswer || q.answer, options),
            marks: parseFloat(q.marks) || 1,
            explanation: (q.explanation || '').toString()
          };
          // Optional images (data URLs). Invalid/unsupported URLs are ignored.
          if (imgOk(q.image)) candidate.image = String(q.image).trim();
          if (q.optionImages && typeof q.optionImages === 'object') {
            const oi = {};
            ['A', 'B', 'C', 'D'].forEach(L => { if (imgOk(q.optionImages[L])) oi[L] = String(q.optionImages[L]).trim(); });
            if (Object.keys(oi).length) candidate.optionImages = oi;
          }
          if (q.passageId) candidate.passageId = String(q.passageId);
          const errs = validateBulkQuestion(candidate);
          if (errs.length) skipped.push({ row: idx + 1, reason: errs.join('; ') });
          else parsedBulkQuestions.push(candidate);
        });
      } else {
        const lines = text.split(/\r\n|\n/).filter(l => l.trim().length > 0);
        let startIdx = 0;
        if (lines.length > 0 && lines[0].toLowerCase().includes('question')) startIdx = 1;

        for (let i = startIdx; i < lines.length; i++) {
          const fields = parseCsvLine(lines[i]);
          const options = { A: fields[1] || '', B: fields[2] || '', C: fields[3] || '', D: fields[4] || '' };
          const candidate = {
            id: 'q-' + Date.now() + '-' + i,
            question: (fields[0] || '').trim(),
            options: options,
            correctAnswer: normalizeCorrectAnswer(fields[5], options),
            marks: parseFloat(fields[6]) || 1,
            explanation: fields[7] || ''
          };
          // Optional 9th column: a question image as a data URL (rarely used in CSV).
          if (imgOk(fields[8])) candidate.image = fields[8].trim();
          const errs = validateBulkQuestion(candidate);
          if (errs.length) skipped.push({ row: i + 1, reason: errs.join('; ') });
          else parsedBulkQuestions.push(candidate);
        }
      }

      const previewDiv = document.getElementById('questionBulkPreview');
      const countEl = document.getElementById('questionBulkCount');

      if (parsedBulkQuestions.length > 0) {
        previewDiv.style.display = 'block';
        let msg = `${parsedBulkQuestions.length} valid question(s) ready for import`;
        if (skipped.length) msg += ` — ${skipped.length} row(s) skipped (see notice)`;
        countEl.textContent = msg;
      } else {
        previewDiv.style.display = 'none';
        countEl.textContent = '0 questions parsed';
      }

      if (skipped.length) {
        const sample = skipped.slice(0, 8).map(s => `  • Row ${s.row}: ${s.reason}`).join('\n');
        const more = skipped.length > 8 ? `\n  ...and ${skipped.length - 8} more` : '';
        alert(
          `${skipped.length} row(s) were skipped because they are invalid:\n\n${sample}${more}\n\n` +
          `Fix: give every question at least 2 options and make the correct answer a letter A-D ` +
          `(or the exact text of one of the options).`
        );
      } else if (parsedBulkQuestions.length === 0) {
        alert('Could not parse any valid questions. Please ensure each row has a question, options, and a correct answer (A-D).');
      }
    } catch (err) {
      alert('Error reading questions file: ' + err.message);
    }
  };
  reader.readAsText(file);
}

function importQuestionsIntoBuilder() {
  if (parsedBulkQuestions.length === 0) return;
  builderQuestions = builderQuestions.concat(parsedBulkQuestions);
  // Merge any passages that came with the file (by id) into the builder's set.
  (window._bulkPassages || []).forEach(p => {
    if (!window._builderPassages.some(x => x.id === p.id)) window._builderPassages.push(p);
  });
  renderBuilderQuestions();
  document.getElementById('questionBulkPreview').style.display = 'none';
  document.getElementById('questionBulkFile').value = '';
  alert(`Imported ${parsedBulkQuestions.length} questions into the active Question Builder!`);
  parsedBulkQuestions = [];
  window._bulkPassages = [];
}

async function importQuestionsAsNewExam() {
  if (parsedBulkQuestions.length === 0) return;
  const title = document.getElementById('newExamTitle').value.trim() || 'Imported Examination ' + new Date().toLocaleDateString();
  const subject = document.getElementById('newExamSubject').value.trim() || 'General';
  const classLevel = document.getElementById('newExamClass').value.trim() || 'SS 2';
  const duration = parseInt(document.getElementById('newExamDuration').value) || 45;
  const pass = parseInt(document.getElementById('newExamPass').value) || 50;
  const session = document.getElementById('newExamSession').value;
  const term = document.getElementById('newExamTerm').value;
  const instructions = document.getElementById('newExamInstructions').value;

  const examPayload = {
    title,
    subject,
    classLevel,
    session,
    term,
    durationMinutes: duration,
    passPercentage: pass,
    instructions,
    questions: parsedBulkQuestions,
    passages: (window._bulkPassages || []).filter(p => parsedBulkQuestions.some(q => q.passageId === p.id))
  };

  try {
    const res = await fetch('/api/admin/exams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(examPayload)
    });
    const data = await res.json();
    if (data.success) {
      const n = parsedBulkQuestions.length;
      window._bulkPassages = [];
      alert(`Successfully saved "${title}" with ${n} questions in Exams Library!`);
      document.getElementById('questionBulkPreview').style.display = 'none';
      document.getElementById('questionBulkFile').value = '';
      parsedBulkQuestions = [];
      fetchExamsList();
      switchTab('tabExams');
    }
  } catch (err) {
    alert('Failed to save exam to local server.');
  }
}

// TAB: EXAMS LIBRARY
let activeExamTargetId = null;

async function fetchExamsList() {
  const tbody = document.getElementById('examsListBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">Loading exams library...</td></tr>';

  try {
    const res = await fetch('/api/admin/exams');
    const exams = await res.json();
    const statusRes = await fetch('/api/status');
    const statusData = await statusRes.json();
    const activeId = statusData.activeExam ? statusData.activeExam.id : null;

    if (!exams || exams.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No exams found. Use Question Builder or Import to create exams.</td></tr>';
      return;
    }

    window._examsCache = exams;
    tbody.innerHTML = exams.map(ex => {
      const isActive = ex.id === activeId;
      const session = ex.session || '2026/2027';
      const term = ex.term || '1st Term';
      const qCount = ex.questions ? ex.questions.length : 0;

      return `
        <tr style="${isActive ? 'background:#f0fdf4;' : ''}">
          <td>
            <strong>${ex.title}</strong>
            ${isActive ? '<span class="status-pill status-writing" style="margin-left:8px;"><span class="pulse-dot"></span>ACTIVE</span>' : ''}
            ${examScheduleInfo(ex)}
          </td>
          <td>${ex.subject}</td>
          <td><span class="badge-tag">${ex.classLevel}</span></td>
          <td><strong>${session}</strong></td>
          <td><span class="badge-tag">${term}</span></td>
          <td>${qCount} Questions</td>
          <td>${ex.durationMinutes} Mins</td>
          <td style="text-align:right; white-space:nowrap;">
            ${isActive
              ? '<button class="btn btn-sm btn-outline" disabled style="opacity:0.7;">✓ Active</button>'
              : `<button class="btn btn-sm btn-success" onclick="openSetActiveModal('${ex.id}', '${ex.title.replace(/'/g, "\\'")}', '${session}', '${term}')">▶ Set Active</button>`
            }
            <button class="btn btn-sm btn-outline" onclick="scheduleExam('${ex.id}')" title="Schedule date &amp; time">📅</button>
            <button class="btn btn-sm btn-outline-danger" onclick="deleteExamItem('${ex.id}', '${ex.title.replace(/'/g, "\\'")}')" title="Delete Exam">🗑️</button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-danger">Failed to load exams library.</td></tr>';
  }
}

// Build the scheduled date/status line for an exam row.
function examScheduleInfo(ex) {
  if (!ex.scheduledStart) return '';
  const start = new Date(ex.scheduledStart);
  if (isNaN(start.getTime())) return '';
  const end = ex.scheduledEnd ? new Date(ex.scheduledEnd) : new Date(start.getTime() + (ex.durationMinutes || 60) * 60000);
  const now = Date.now();
  let status, cls;
  if (now < start.getTime()) { status = 'Scheduled'; cls = 'badge-tag'; }
  else if (now < end.getTime()) { status = 'LIVE NOW'; cls = 'status-pill status-writing'; }
  else { status = 'Ended'; cls = 'badge-tag'; }
  const when = start.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  return `<div style="font-size:.78rem;color:#64748b;margin-top:3px;">📅 ${when} &middot; <span class="${cls}">${status}</span></div>`;
}

// Set / change an exam's scheduled date & time (auto-activation). Keeps all questions.
async function scheduleExam(examId) {
  const ex = (window._examsCache || []).find(e => e.id === examId);
  if (!ex) { alert('Exam not found — refresh the list and try again.'); return; }
  const existing = ex.scheduledStart ? new Date(ex.scheduledStart) : null;
  const defDate = existing && !isNaN(existing) ? existing.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const date = prompt(`Exam DATE for "${ex.title}" (YYYY-MM-DD).\nLeave blank to clear the schedule.`, defDate);
  if (date === null) return;
  let scheduledStart = '';
  if (date.trim()) {
    const defTime = existing && !isNaN(existing) ? existing.toTimeString().slice(0, 5) : '08:00';
    const time = prompt('Start TIME (24-hour HH:MM):', defTime);
    if (time === null) return;
    scheduledStart = date.trim() + 'T' + ((time || '08:00').trim());
    if (isNaN(new Date(scheduledStart).getTime())) { alert('That date/time is not valid.'); return; }
  }
  const updated = { ...ex, scheduledStart }; // full object so questions are preserved
  try {
    const res = await fetch('/api/admin/exams', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated)
    });
    const data = await res.json();
    if (data.success) {
      alert(scheduledStart
        ? `"${ex.title}" scheduled for ${new Date(scheduledStart).toLocaleString()}. It will auto-activate at that time.`
        : `Schedule cleared for "${ex.title}".`);
      fetchExamsList();
    } else { alert(data.message || 'Could not update the schedule.'); }
  } catch (e) { alert('Failed to reach the server.'); }
}

function openSetActiveModal(examId, title, session, term) {
  activeExamTargetId = examId;
  document.getElementById('setActiveExamTitle').textContent = title;
  if (session) document.getElementById('setActiveSession').value = session;
  if (term) document.getElementById('setActiveTerm').value = term;
  document.getElementById('modalSetActive').style.display = 'flex';
}

function closeSetActiveModal() {
  document.getElementById('modalSetActive').style.display = 'none';
  activeExamTargetId = null;
}

async function confirmSetActiveExam() {
  if (!activeExamTargetId) return;
  const session = document.getElementById('setActiveSession').value;
  const term = document.getElementById('setActiveTerm').value;

  try {
    const res = await fetch('/api/admin/exams/set-active', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ examId: activeExamTargetId, session, term })
    });
    const data = await res.json();
    if (data.success) {
      alert(`Exam activated for ${session} (${term})! All student kiosks have been automatically synchronized.`);
      closeSetActiveModal();
      initAdmin();
      fetchExamsList();
    } else {
      alert(data.message || 'Failed to activate exam.');
    }
  } catch (err) {
    alert('Server communication error.');
  }
}

async function deleteExamItem(id, title) {
  if (!confirm(`Delete exam "${title}" from the local repository?`)) return;
  try {
    const res = await fetch(`/api/admin/exams/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      fetchExamsList();
    }
  } catch (err) {
    alert('Failed to delete exam.');
  }
}

// TAB 3: COTHI SCHOOL EXAMS
async function fetchCothiExams() {
  const container = document.getElementById('cothiExamsContainer');
  container.innerHTML = '<p class="text-muted">Loading COTHI School Repository...</p>';

  try {
    const res = await fetch('/api/admin/cothi-exams');
    const data = await res.json();

    container.innerHTML = '';
    if (!data.exams || data.exams.length === 0) {
      container.innerHTML = '<p class="text-muted">No exams currently synced from COTHI for this school code.</p>';
      return;
    }

    data.exams.forEach(ex => {
      const card = document.createElement('div');
      card.className = 'cothi-card';
      card.innerHTML = `
        <div class="cothi-meta">
          <span>${ex.classLevel}</span>
          <span>${ex.subject}</span>
          <span>${ex.durationMinutes} Mins</span>
          <span>${ex.questions.length} Questions</span>
        </div>
        <h4>${ex.title}</h4>
        <p class="cothi-instructions">${ex.instructions}</p>
        <button class="btn btn-success btn-block" onclick="deployCothiExamOffline('${ex.id}')">
          ⚡ Deploy to Offline Hall (Set as Active)
        </button>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = '<p class="text-danger">Failed to connect to COTHI repository.</p>';
  }
}

async function deployCothiExamOffline(cothiExamId) {
  if (!confirm('Deploy this COTHI exam to the offline exam hall? Students logging in will immediately receive this paper.')) return;

  try {
    const res = await fetch('/api/admin/cothi-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cothiExamId, setActive: true })
    });
    const data = await res.json();

    if (data.success) {
      alert(`Success! "${data.exam.title}" is now active in the offline exam hall.`);
      initAdmin();
      switchTab('tabLive');
    }
  } catch (err) {
    alert('Failed to deploy COTHI exam.');
  }
}

// TAB 4: SCHOOL BRANDING
function loadBrandingForm() {
  if (!currentBranding) return;
  document.getElementById('brandSchoolName').value = currentBranding.schoolName || '';
  document.getElementById('brandSchoolMotto').value = currentBranding.schoolMotto || '';
  document.getElementById('brandSchoolCode').value = currentBranding.schoolCode || '';
  document.getElementById('brandSchoolLogo').value = currentBranding.schoolLogo || '';
  document.getElementById('brandPrimaryColor').value = currentBranding.primaryColor || '#1e3a8a';
  document.getElementById('brandAccentColor').value = currentBranding.accentColor || '#d97706';
  updateLiveBrandingPreview();
}

function clearBrandLogo() {
  document.getElementById('brandSchoolLogo').value = '';
  const thumbContainer = document.getElementById('brandLogoThumbContainer');
  if (thumbContainer) thumbContainer.style.display = 'none';
  const logoImg = document.getElementById('sideLogo');
  if (logoImg) { logoImg.src = ''; logoImg.style.display = 'none'; }
  const fallback = document.getElementById('sideLogoFallback');
  if (fallback) fallback.style.display = 'block';
  updateLiveBrandingPreview();
}

function handleBrandLogoUpload(input) {
  if (input.files && input.files[0]) {
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      document.getElementById('brandSchoolLogo').value = e.target.result;
      updateLiveBrandingPreview();
    };
    reader.readAsDataURL(file);
  }
}

function updateLiveBrandingPreview() {
  const name = document.getElementById('brandSchoolName').value || 'School Name';
  const motto = document.getElementById('brandSchoolMotto').value || 'School Motto';
  const color = document.getElementById('brandPrimaryColor').value || '#1e3a8a';
  const logo = (document.getElementById('brandSchoolLogo').value || '').trim();

  document.getElementById('mockSchoolName').textContent = name;
  document.getElementById('mockMotto').textContent = motto;
  document.getElementById('mockHeader').style.borderBottomColor = color;
  document.getElementById('mockOptSelected').style.borderColor = color;

  const thumbContainer = document.getElementById('brandLogoThumbContainer');
  const thumb = document.getElementById('brandLogoThumb');
  if (thumbContainer && thumb) {
    if (logo) {
      thumb.src = logo;
      thumbContainer.style.display = 'flex';
    } else {
      thumbContainer.style.display = 'none';
    }
  }
}

async function saveSchoolBranding(e) {
  e.preventDefault();
  const schoolName = document.getElementById('brandSchoolName').value.trim();
  const schoolMotto = document.getElementById('brandSchoolMotto').value.trim();
  const schoolCode = document.getElementById('brandSchoolCode').value.trim();
  const schoolLogo = document.getElementById('brandSchoolLogo').value.trim();
  const primaryColor = document.getElementById('brandPrimaryColor').value;
  const accentColor = document.getElementById('brandAccentColor').value;

  try {
    const res = await fetch('/api/admin/branding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolName, schoolMotto, schoolCode, schoolLogo, primaryColor, accentColor })
    });
    const data = await res.json();
    if (data.success) {
      alert('School branding saved! School identity is preserved in your local directory and all student terminals have been updated.');
      currentBranding = data.branding;
      applyAdminBranding(data.branding);
      fetchCothiSchools();
    }
  } catch (err) {
    alert('Failed to save branding.');
  }
}

// TAB 5: RESULTS & EXPORT
let allResultsList = [];

function getGradeLetter(percent) {
  if (percent >= 75) return { grade: 'A1', label: 'EXCELLENT', color: '#15803d', bg: '#dcfce7' };
  if (percent >= 70) return { grade: 'B2', label: 'VERY GOOD', color: '#15803d', bg: '#dcfce7' };
  if (percent >= 65) return { grade: 'B3', label: 'GOOD', color: '#1d4ed8', bg: '#dbeafe' };
  if (percent >= 60) return { grade: 'C4', label: 'CREDIT', color: '#1d4ed8', bg: '#dbeafe' };
  if (percent >= 55) return { grade: 'C5', label: 'CREDIT', color: '#1d4ed8', bg: '#dbeafe' };
  if (percent >= 50) return { grade: 'C6', label: 'CREDIT', color: '#1d4ed8', bg: '#dbeafe' };
  if (percent >= 45) return { grade: 'D7', label: 'PASS', color: '#b45309', bg: '#fef3c7' };
  if (percent >= 40) return { grade: 'E8', label: 'PASS', color: '#b45309', bg: '#fef3c7' };
  return { grade: 'F9', label: 'FAIL', color: '#dc2626', bg: '#fee2e2' };
}

async function fetchResults() {
  const tbody = document.getElementById('resultsTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="12" class="text-center text-muted">Loading results...</td></tr>';

  try {
    const res = await fetch('/api/admin/results');
    allResultsList = await res.json();

    // Populate filter dropdowns
    const subjectSet = new Set(allResultsList.map(r => r.subject || r.examTitle).filter(Boolean));
    const subjSelect = document.getElementById('filterResultSubject');
    if (subjSelect) {
      const cur = subjSelect.value;
      subjSelect.innerHTML = '<option value="ALL">All Subjects</option>';
      subjectSet.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        if (s === cur) opt.selected = true;
        subjSelect.appendChild(opt);
      });
    }

    const classSet = new Set(allResultsList.map(r => r.classLevel).filter(Boolean));
    const clsSelect = document.getElementById('filterResultClass');
    if (clsSelect) {
      const cur = clsSelect.value;
      clsSelect.innerHTML = '<option value="ALL">All Classes</option>';
      classSet.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        if (c === cur) opt.selected = true;
        clsSelect.appendChild(opt);
      });
    }

    renderResultsTable();
  } catch (err) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="12" class="text-danger text-center">Failed to load results.</td></tr>';
  }
}

function renderResultsTable() {
  const tbody = document.getElementById('resultsTableBody');
  if (!tbody) return;

  const fSession = document.getElementById('filterResultSession') ? document.getElementById('filterResultSession').value : 'ALL';
  const fTerm = document.getElementById('filterResultTerm') ? document.getElementById('filterResultTerm').value : 'ALL';
  const fSubject = document.getElementById('filterResultSubject') ? document.getElementById('filterResultSubject').value : 'ALL';
  const fClass = document.getElementById('filterResultClass') ? document.getElementById('filterResultClass').value : 'ALL';

  const filtered = allResultsList.filter(r => {
    const sessionMatch = fSession === 'ALL' || (r.session && r.session === fSession);
    const termMatch = fTerm === 'ALL' || (r.term && r.term === fTerm);
    const subjectMatch = fSubject === 'ALL' || (r.subject === fSubject || r.examTitle === fSubject);
    const classMatch = fClass === 'ALL' || (r.classLevel === fClass);
    return sessionMatch && termMatch && subjectMatch && classMatch;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="12" class="text-center text-muted py-20">No examination results match the selected filter criteria.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map((r, idx) => {
    const g = getGradeLetter(r.percentage);
    const dateFormatted = r.submittedAt ? new Date(r.submittedAt).toLocaleDateString() + ' ' + new Date(r.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-';

    return `
      <tr>
        <td style="font-weight:600; color:#64748b;">${idx + 1}</td>
        <td><code>${r.regNo}</code></td>
        <td><strong>${r.studentName}</strong></td>
        <td><span class="badge-tag">${r.classLevel || 'SS 2'}</span></td>
        <td>${r.subject || r.examTitle}</td>
        <td><small>${r.session || '2026/2027'} • ${r.term || '1st Term'}</small></td>
        <td><strong>${r.score}</strong> / ${r.totalMarks}</td>
        <td><strong style="color:${g.color};">${r.percentage}%</strong></td>
        <td>
          <span style="background:${g.bg}; color:${g.color}; border:1px solid ${g.color}; padding:3px 8px; border-radius:6px; font-weight:800; font-size:0.8rem;">
            ${g.grade}
          </span>
        </td>
        <td><span class="status-pill status-submitted">✅ ${r.passed ? 'PASSED' : 'FAILED'}</span></td>
        <td><small>${dateFormatted}</small></td>
        <td style="text-align:right; white-space:nowrap;">
          ${r.manuallyAdjusted ? '<span class="badge-tag" title="Score was manually adjusted" style="margin-right:4px;">✎ adj</span>' : ''}
          <button class="btn btn-outline btn-sm" onclick="overrideResultScore('${r.submissionId}', ${r.score}, ${r.totalMarks})" title="Manually adjust score">✏️</button>
          <button class="btn btn-outline btn-sm" onclick="printIndividualResultSlip('${r.submissionId}')">📄 Slip</button>
        </td>
      </tr>
    `;
  }).join('');
}

function printIndividualResultSlip(subId) {
  const r = allResultsList.find(item => item.submissionId === subId);
  if (!r) return;

  const g = getGradeLetter(r.percentage);
  const branding = currentBranding || { schoolName: 'COTHIGLOBAL Examination Center', schoolMotto: 'Excellence in CBT Assessment' };
  const dateStr = r.submittedAt ? new Date(r.submittedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : new Date().toLocaleDateString();

  const slipHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Result Slip - ${r.studentName} (${r.regNo})</title>
      <style>
        @page { size: portrait; margin: 15mm; }
        body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0f172a; margin: 0; padding: 20px; background: #fff; }
        .slip-box { max-width: 650px; margin: 0 auto; border: 2.5px solid #1e3a8a; border-radius: 12px; padding: 24px; position: relative; }
        .school-header { text-align: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 20px; }
        .school-name { font-size: 1.4rem; font-weight: 800; color: #1e3a8a; text-transform: uppercase; margin: 0; letter-spacing: 0.03em; }
        .school-motto { font-size: 0.85rem; color: #64748b; font-style: italic; margin-top: 4px; }
        .slip-title { background: #1e3a8a; color: white; display: inline-block; padding: 6px 18px; border-radius: 9999px; font-weight: 800; font-size: 0.82rem; letter-spacing: 0.08em; text-transform: uppercase; margin: 12px 0 6px 0; }
        .term-badge { font-size: 0.9rem; font-weight: 700; color: #2563eb; }
        .bio-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; }
        .bio-item { font-size: 0.88rem; }
        .bio-item span { color: #64748b; display: block; font-size: 0.75rem; text-transform: uppercase; font-weight: 700; margin-bottom: 2px; }
        .bio-item strong { font-size: 0.95rem; color: #0f172a; }
        .score-card { display: flex; align-items: center; justify-content: space-between; background: #eff6ff; border: 1.5px solid #bfdbfe; border-radius: 10px; padding: 16px 24px; margin-bottom: 20px; }
        .score-main { font-size: 2.2rem; font-weight: 800; color: #1e3a8a; }
        .score-main small { font-size: 1rem; color: #64748b; font-weight: 600; }
        .grade-badge { font-size: 1.6rem; font-weight: 900; color: ${g.color}; background: ${g.bg}; border: 2px solid ${g.color}; padding: 6px 16px; border-radius: 8px; text-align: center; }
        .grade-badge small { display: block; font-size: 0.72rem; letter-spacing: 0.05em; font-weight: 800; }
        .breakdown-row { display: flex; gap: 12px; margin-bottom: 24px; }
        .breakdown-chip { flex: 1; text-align: center; padding: 10px; border-radius: 8px; background: #f8fafc; border: 1px solid #e2e8f0; font-size: 0.82rem; }
        .breakdown-chip strong { display: block; font-size: 1.2rem; margin-top: 2px; color: #0f172a; }
        .signature-row { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 36px; padding-top: 16px; border-top: 1px dashed #cbd5e1; }
        .sig-block { text-align: center; width: 180px; }
        .sig-line { border-bottom: 1px solid #0f172a; height: 35px; margin-bottom: 6px; }
        .sig-label { font-size: 0.75rem; font-weight: 700; color: #64748b; text-transform: uppercase; }
        .watermark { text-align: center; font-size: 0.72rem; color: #94a3b8; font-family: monospace; margin-top: 24px; }
        @media print {
          .no-print { display: none !important; }
          body { padding: 0; }
        }
      </style>
    </head>
    <body>
      <div style="text-align:center; margin-bottom: 12px;" class="no-print">
        <button onclick="window.print()" style="padding: 10px 24px; background:#2563eb; color:#fff; border:none; border-radius:6px; font-weight:bold; cursor:pointer; font-size:1rem;">🖨️ Print / Save as PDF</button>
      </div>
      <div class="slip-box">
        <div class="school-header">
          ${branding.schoolLogo ? `<img src="${branding.schoolLogo}" style="max-height:50px; margin-bottom:6px;">` : ''}
          <h1 class="school-name">${branding.schoolName}</h1>
          <div class="school-motto">${branding.schoolMotto || 'Official Computer Based Test Center'}</div>
          <div><span class="slip-title">Official Examination Result Slip</span></div>
          <div class="term-badge">${r.session || '2026/2027'} Academic Session • ${r.term || '1st Term'}</div>
        </div>

        <div class="bio-grid">
          <div class="bio-item"><span>Candidate Name</span><strong>${r.studentName}</strong></div>
          <div class="bio-item"><span>Registration Number</span><strong>${r.regNo}</strong></div>
          <div class="bio-item"><span>Subject / Paper</span><strong>${r.subject || r.examTitle}</strong></div>
          <div class="bio-item"><span>Class Level</span><strong>${r.classLevel || 'SS 2'}</strong></div>
          <div class="bio-item"><span>Date Sat</span><strong>${dateStr}</strong></div>
          <div class="bio-item"><span>Status</span><strong style="color:${r.passed ? '#15803d' : '#dc2626'};">${r.passed ? 'PASSED' : 'FAILED'}</strong></div>
        </div>

        <div class="score-card">
          <div>
            <span style="font-size:0.8rem; font-weight:700; color:#1e40af; text-transform:uppercase;">Assessment Score:</span>
            <div class="score-main">${r.score} <small>/ ${r.totalMarks}</small></div>
            <div style="font-weight:700; color:#2563eb; font-size:1.1rem;">Percentage: ${r.percentage}%</div>
          </div>
          <div class="grade-badge">
            ${g.grade}
            <small>${g.label}</small>
          </div>
        </div>

        <div class="breakdown-row">
          <div class="breakdown-chip" style="color:#15803d;">
            <span>Correct Answers</span>
            <strong>${r.correctCount || 0}</strong>
          </div>
          <div class="breakdown-chip" style="color:#dc2626;">
            <span>Wrong Answers</span>
            <strong>${r.wrongCount || 0}</strong>
          </div>
          <div class="breakdown-chip" style="color:#64748b;">
            <span>Unanswered</span>
            <strong>${r.unansweredCount || 0}</strong>
          </div>
        </div>

        <div class="signature-row">
          <div class="sig-block">
            <div class="sig-line"></div>
            <div class="sig-label">Form Teacher's Sign</div>
          </div>
          <div class="sig-block">
            <div style="border: 1.5px dashed #94a3b8; width: 90px; height: 50px; margin: 0 auto 6px auto; display:flex; align-items:center; justify-content:center; color:#94a3b8; font-size:0.7rem; font-weight:bold;">OFFICIAL STAMP</div>
          </div>
          <div class="sig-block">
            <div class="sig-line"></div>
            <div class="sig-label">Principal / Exam Officer</div>
          </div>
        </div>

        <div class="watermark">
          AUTHENTICATED &bull; COTHIGLOBAL SECURE CBT ENGINE &bull; ${r.submissionId}
        </div>
      </div>
    </body>
    </html>
  `;

  const printWin = window.open('', '_blank');
  printWin.document.write(slipHtml);
  printWin.document.close();
}

// Export the currently-filtered results as a real Excel file (.xls, opens in Excel).
function exportResultsXls() {
  const fSubject = document.getElementById('filterResultSubject') ? document.getElementById('filterResultSubject').value : 'ALL';
  const fClass = document.getElementById('filterResultClass') ? document.getElementById('filterResultClass').value : 'ALL';
  const fSession = document.getElementById('filterResultSession') ? document.getElementById('filterResultSession').value : 'ALL';
  const fTerm = document.getElementById('filterResultTerm') ? document.getElementById('filterResultTerm').value : 'ALL';
  const rows = allResultsList.filter(r =>
    (fSession === 'ALL' || r.session === fSession) && (fTerm === 'ALL' || r.term === fTerm) &&
    (fSubject === 'ALL' || r.subject === fSubject || r.examTitle === fSubject) && (fClass === 'ALL' || r.classLevel === fClass));
  if (!rows.length) { alert('No results match the current filter.'); return; }
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const school = (currentBranding && currentBranding.schoolName) || 'COTHI CBT';
  let html = '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body>';
  html += `<table border="1"><tr><th colspan="9" style="font-size:14pt;">${esc(school)} — Examination Results</th></tr>`;
  html += '<tr style="background:#1e3a8a;color:#fff;font-weight:bold;"><th>#</th><th>Reg No</th><th>Candidate</th><th>Class</th><th>Subject</th><th>Session/Term</th><th>Score</th><th>%</th><th>Grade</th></tr>';
  rows.forEach((r, i) => {
    const g = getGradeLetter(r.percentage).grade;
    html += `<tr><td>${i + 1}</td><td>${esc(r.regNo)}</td><td>${esc(r.studentName)}</td><td>${esc(r.classLevel || '')}</td><td>${esc(r.subject || r.examTitle)}</td><td>${esc((r.session || '') + ' ' + (r.term || ''))}</td><td>${r.score}/${r.totalMarks}</td><td>${r.percentage}%</td><td>${g}</td></tr>`;
  });
  html += '</table></body></html>';
  const blob = new Blob(['﻿' + html], { type: 'application/vnd.ms-excel' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `COTHI_Results_${new Date().toISOString().slice(0, 10)}.xls`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// Manually adjust a candidate's score (regrade).
async function overrideResultScore(submissionId, currentScore, totalMarks) {
  const input = prompt(`Adjust score (out of ${totalMarks}).\nCurrent: ${currentScore}`, currentScore);
  if (input === null) return;
  const score = parseFloat(input);
  if (isNaN(score) || score < 0 || score > totalMarks) { alert(`Enter a number between 0 and ${totalMarks}.`); return; }
  try {
    const res = await fetch('/api/admin/results/override', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissionId, score })
    });
    const data = await res.json();
    if (data.success) { alert(`Score updated to ${data.submission.score}/${data.submission.totalMarks} (${data.submission.percentage}%, ${data.submission.gradeBand}).`); fetchResults(); }
    else alert(data.message || 'Could not update the score.');
  } catch (e) { alert('Failed to reach the server.'); }
}

// Show analytics for the active (or filtered-subject) exam.
async function showExamAnalytics() {
  const modal = document.getElementById('analyticsModal');
  const body = document.getElementById('analyticsBody');
  body.innerHTML = '<p class="text-muted">Loading analytics…</p>';
  modal.style.display = 'flex';
  try {
    const res = await fetch('/api/admin/analytics');
    const a = await res.json();
    if (!a.count) { body.innerHTML = '<p class="text-muted">No submissions yet for the active exam.</p>'; return; }
    const grades = ['A1', 'B2', 'B3', 'C4', 'C5', 'C6', 'D7', 'E8', 'F9'];
    const maxG = Math.max(1, ...grades.map(g => a.dist[g] || 0));
    const bars = grades.map(g => {
      const n = a.dist[g] || 0;
      return `<div style="display:flex;align-items:center;gap:8px;margin:2px 0;"><span style="width:28px;font-weight:700;">${g}</span><div style="flex:1;background:#eef2f7;border-radius:4px;overflow:hidden;"><div style="width:${Math.round(n / maxG * 100)}%;min-width:${n ? 18 : 0}px;background:var(--admin-primary,#2563eb);color:#fff;font-size:.72rem;padding:2px 6px;border-radius:4px;">${n}</div></div></div>`;
    }).join('');
    const hard = (a.hardest || []).map(q => `<li>Q${q.index} — <strong>${q.correctPct}%</strong> correct <span class="text-muted">(${q.question}…)</span></li>`).join('');
    body.innerHTML = `
      <h3 style="margin-bottom:4px;">${a.examTitle}</h3>
      <p class="text-muted text-sm" style="margin-bottom:14px;">${a.subject || ''} · ${a.classLevel || ''} · ${a.count} candidate(s)</p>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;">
        <div class="stat-card"><div class="stat-content"><span class="stat-label">Average</span><strong class="stat-val">${a.avg}%</strong></div></div>
        <div class="stat-card"><div class="stat-content"><span class="stat-label">Pass Rate</span><strong class="stat-val">${a.passRate}%</strong></div></div>
        <div class="stat-card"><div class="stat-content"><span class="stat-label">Top Score</span><strong class="stat-val">${a.top ? a.top.pct + '%' : '-'}</strong></div></div>
      </div>
      <p style="font-weight:700;margin-bottom:6px;">Grade distribution</p>
      ${bars}
      <p style="font-weight:700;margin:16px 0 6px;">Hardest questions (lowest % correct)</p>
      <ul style="font-size:.86rem;line-height:1.7;padding-left:18px;">${hard || '<li>No answer data.</li>'}</ul>
      <p class="text-muted text-sm" style="margin-top:12px;">🏆 Top: ${a.top ? a.top.name + ' (' + a.top.pct + '%)' : '-'} · 📉 Lowest: ${a.low ? a.low.name + ' (' + a.low.pct + '%)' : '-'}</p>`;
  } catch (e) {
    body.innerHTML = '<p class="text-danger">Could not load analytics.</p>';
  }
}

function printClassBroadsheet() {
  const fSession = document.getElementById('filterResultSession') ? document.getElementById('filterResultSession').value : 'ALL';
  const fTerm = document.getElementById('filterResultTerm') ? document.getElementById('filterResultTerm').value : 'ALL';
  const fSubject = document.getElementById('filterResultSubject') ? document.getElementById('filterResultSubject').value : 'ALL';
  const fClass = document.getElementById('filterResultClass') ? document.getElementById('filterResultClass').value : 'ALL';

  const filtered = allResultsList.filter(r => {
    const sessionMatch = fSession === 'ALL' || (r.session && r.session === fSession);
    const termMatch = fTerm === 'ALL' || (r.term && r.term === fTerm);
    const subjectMatch = fSubject === 'ALL' || (r.subject === fSubject || r.examTitle === fSubject);
    const classMatch = fClass === 'ALL' || (r.classLevel === fClass);
    return sessionMatch && termMatch && subjectMatch && classMatch;
  });

  if (filtered.length === 0) {
    alert('No results available matching current filter to generate broadsheet.');
    return;
  }

  // Sort descending by percentage for class rank
  const ranked = [...filtered].sort((a, b) => b.percentage - a.percentage);

  const branding = currentBranding || { schoolName: 'COTHIGLOBAL Examination Center', schoolMotto: 'Excellence in CBT Assessment' };
  const sessionText = fSession !== 'ALL' ? fSession : (ranked[0].session || '2026/2027');
  const termText = fTerm !== 'ALL' ? fTerm : (ranked[0].term || '1st Term');
  const subjectText = fSubject !== 'ALL' ? fSubject : (ranked[0].subject || 'All Subjects');
  const classText = fClass !== 'ALL' ? fClass : (ranked[0].classLevel || 'All Classes');

  const totalSat = ranked.length;
  const passedCount = ranked.filter(r => r.passed).length;
  const passRate = Math.round((passedCount / totalSat) * 100);
  const avgScore = Math.round(ranked.reduce((acc, c) => acc + c.percentage, 0) / totalSat);
  const highest = ranked[0].percentage;
  const lowest = ranked[ranked.length - 1].percentage;

  const broadsheetHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Master Broadsheet - ${subjectText} (${classText})</title>
      <style>
        @page { size: landscape; margin: 10mm; }
        body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0f172a; margin: 0; padding: 15px; }
        .header { text-align: center; border-bottom: 2px solid #1e3a8a; padding-bottom: 12px; margin-bottom: 12px; }
        .school-name { font-size: 1.4rem; font-weight: 800; color: #1e3a8a; text-transform: uppercase; margin: 0; }
        .school-motto { font-size: 0.8rem; color: #64748b; font-style: italic; }
        .sheet-title { font-size: 1.1rem; font-weight: 800; color: #0f172a; text-transform: uppercase; margin-top: 6px; letter-spacing: 0.05em; }
        .meta-strip { display: flex; justify-content: space-between; background: #f1f5f9; border: 1px solid #cbd5e1; padding: 8px 16px; border-radius: 6px; font-size: 0.82rem; font-weight: 700; margin-bottom: 12px; }
        .stats-bar { display: flex; gap: 10px; margin-bottom: 12px; }
        .stat-box { flex: 1; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 10px; text-align: center; }
        .stat-box span { font-size: 0.72rem; color: #64748b; text-transform: uppercase; font-weight: 700; display: block; }
        .stat-box strong { font-size: 1.05rem; color: #1e3a8a; }
        table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
        th { background: #1e3a8a; color: white; padding: 7px 8px; text-align: left; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.03em; }
        td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; }
        tr:nth-child(even) { background: #f8fafc; }
        .pos-badge { font-weight: 800; color: #1e3a8a; }
        .signatures { display: flex; justify-content: space-between; margin-top: 30px; padding-top: 10px; border-top: 1px solid #cbd5e1; }
        .sig-block { text-align: center; width: 220px; font-size: 0.78rem; }
        .sig-line { border-bottom: 1px solid #0f172a; height: 30px; margin-bottom: 4px; }
        @media print {
          .no-print { display: none !important; }
        }
      </style>
    </head>
    <body>
      <div style="text-align:center; margin-bottom: 12px;" class="no-print">
        <button onclick="window.print()" style="padding: 9px 24px; background:#2563eb; color:#fff; border:none; border-radius:6px; font-weight:bold; cursor:pointer;">🖨️ Print / Save Broadsheet as PDF</button>
      </div>

      <div class="header">
        <h1 class="school-name">${branding.schoolName}</h1>
        <div class="school-motto">${branding.schoolMotto || 'Official Computer Based Test Terminal'}</div>
        <div class="sheet-title">Official Master Examination Broadsheet</div>
      </div>

      <div class="meta-strip">
        <div><strong>Session:</strong> ${sessionText}</div>
        <div><strong>Term:</strong> ${termText}</div>
        <div><strong>Subject:</strong> ${subjectText}</div>
        <div><strong>Class:</strong> ${classText}</div>
        <div><strong>Date:</strong> ${new Date().toLocaleDateString('en-GB')}</div>
      </div>

      <div class="stats-bar">
        <div class="stat-box"><span>Total Candidates Sat</span><strong>${totalSat}</strong></div>
        <div class="stat-box"><span>Passed</span><strong style="color:#15803d;">${passedCount} (${passRate}%)</strong></div>
        <div class="stat-box"><span>Failed</span><strong style="color:#dc2626;">${totalSat - passedCount} (${100 - passRate}%)</strong></div>
        <div class="stat-box"><span>Class Average</span><strong>${avgScore}%</strong></div>
        <div class="stat-box"><span>Highest Score</span><strong>${highest}%</strong></div>
        <div class="stat-box"><span>Lowest Score</span><strong>${lowest}%</strong></div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Pos</th>
            <th>Reg No</th>
            <th>Candidate Full Name</th>
            <th>Class</th>
            <th>Subject</th>
            <th>Score</th>
            <th>Total</th>
            <th>%</th>
            <th>Grade</th>
            <th>Status</th>
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>
          ${ranked.map((r, i) => {
            const g = getGradeLetter(r.percentage);
            return `
              <tr>
                <td class="pos-badge">#${i + 1}</td>
                <td><code>${r.regNo}</code></td>
                <td><strong>${r.studentName}</strong></td>
                <td>${r.classLevel || 'SS 2'}</td>
                <td>${r.subject || r.examTitle}</td>
                <td><strong>${r.score}</strong></td>
                <td>${r.totalMarks}</td>
                <td style="font-weight:700; color:${g.color};">${r.percentage}%</td>
                <td><strong>${g.grade}</strong></td>
                <td style="font-weight:700; color:${r.passed ? '#15803d' : '#dc2626'};">${r.passed ? 'PASS' : 'FAIL'}</td>
                <td><small>${g.label}</small></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>

      <div class="signatures">
        <div class="sig-block">
          <div class="sig-line"></div>
          <strong>Form Teacher Signature</strong>
        </div>
        <div class="sig-block">
          <div class="sig-line"></div>
          <strong>Subject Teacher Signature</strong>
        </div>
        <div class="sig-block">
          <div class="sig-line"></div>
          <strong>Principal / Official Seal</strong>
        </div>
      </div>
    </body>
    </html>
  `;

  const printWin = window.open('', '_blank');
  printWin.document.write(broadsheetHtml);
  printWin.document.close();
}

function exportResultsCSV() {
  fetch('/api/admin/results')
    .then(r => r.json())
    .then(results => {
      if (!results || results.length === 0) {
        alert('No submissions available to export.');
        return;
      }
      let csv = 'RegNo,CandidateName,Class,Subject,Session,Term,Score,TotalMarks,Percentage,Grade,Status,SubmittedAt,ReceiptID\n';
      results.forEach(r => {
        const g = getGradeLetter(r.percentage);
        csv += `"${r.regNo}","${r.studentName}","${r.classLevel || ''}","${r.subject || r.examTitle}","${r.session || '2026/2027'}","${r.term || '1st Term'}","${r.score}","${r.totalMarks}","${r.percentage}%","${g.grade}","${r.passed ? 'PASS' : 'FAIL'}","${r.submittedAt}","${r.submissionId}"\n`;
      });

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.setAttribute('href', url);
      a.setAttribute('download', `CBT_Results_${new Date().toISOString().slice(0, 10)}.csv`);
      a.click();
    });
}

async function syncResultsToCloud() {
  if (!confirm('Sync all offline results to the online portal at cbtbycothi.com.ng? (Ensure your computer is connected to the internet/hotspot).')) return;

  try {
    const res = await fetch('/api/admin/sync-to-cloud', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      alert(`Cloud Sync Successful!\n\n${data.recordsSynced} records pushed to cbtbycothi.com.ng\nSync ID: ${data.syncId}`);
    }
  } catch (err) {
    alert('Cloud sync failed. Check your internet connection.');
  }
}

// Admin Authentication
async function handleAdminLogin(e) {
  e.preventDefault();
  const username = document.getElementById('adminUser').value.trim();
  const password = document.getElementById('adminPass').value;
  const errEl = document.getElementById('loginErr');
  if (errEl) errEl.style.display = 'none';

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (res.ok && data.success && data.token) {
      setAdminToken(data.token);
      document.getElementById('adminLoginModal').style.display = 'none';
      const pass = document.getElementById('adminPass');
      if (pass) pass.value = '';
      initAdmin();
    } else {
      if (errEl) {
        errEl.textContent = data.message || 'Invalid supervisor username or password.';
        errEl.style.display = 'block';
      }
    }
  } catch (err) {
    if (errEl) {
      errEl.textContent = 'Unable to reach the server. Ensure the CBT server is running.';
      errEl.style.display = 'block';
    }
  }
}

function logoutAdmin() {
  setAdminToken('');
  if (eventSource) { try { eventSource.close(); } catch (e) {} }
  document.getElementById('adminLoginModal').style.display = 'flex';
}

function openOtaModal() {
  document.getElementById('modalOtaUpdate').style.display = 'flex';
  const statusBox = document.getElementById('otaStatusBox');
  const statusText = document.getElementById('otaStatusText');
  statusBox.style.background = '#f1f5f9';
  statusBox.style.color = '#475569';
  statusText.textContent = 'Click "Check for Updates" to see if new code or questions are available.';
}

function closeOtaModal() {
  document.getElementById('modalOtaUpdate').style.display = 'none';
}

async function checkOtaUpdates() {
  const btn = document.getElementById('btnOtaCheck');
  const statusBox = document.getElementById('otaStatusBox');
  const statusText = document.getElementById('otaStatusText');
  
  btn.disabled = true;
  btn.textContent = 'Checking...';
  statusBox.style.background = '#e0f2fe';
  statusBox.style.color = '#0369a1';
  statusText.textContent = 'Testing connection to GitHub and COTHI Cloud...';

  try {
    const res = await adminFetch('/api/admin/ota/check');
    const data = await res.json();
    if (!data.online) {
      statusBox.style.background = '#fee2e2';
      statusBox.style.color = '#991b1b';
      statusText.textContent = '❌ ' + (data.message || 'No internet connection detected. Please connect to phone hotspot.');
    } else if (data.updateAvailable) {
      statusBox.style.background = '#fef3c7';
      statusBox.style.color = '#92400e';
      statusText.innerHTML = `<strong>⚡ New Update Available!</strong><br>${data.message || ''}<br><span style="font-size:0.8rem;">Click "Apply Remote Update" to install.</span>`;
    } else {
      statusBox.style.background = '#dcfce7';
      statusBox.style.color = '#166534';
      statusText.innerHTML = `<strong>✅ System Up to Date</strong><br>${data.message || 'No pending code updates.'}<br><span style="font-size:0.8rem;">You can still click "Apply Remote Update" to re-sync question banks.</span>`;
    }
  } catch (err) {
    statusBox.style.background = '#fee2e2';
    statusBox.style.color = '#991b1b';
    statusText.textContent = 'Error checking updates: ' + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍 Check for Updates';
  }
}

async function applyOtaUpdates() {
  const btn = document.getElementById('btnOtaApply');
  const statusBox = document.getElementById('otaStatusBox');
  const statusText = document.getElementById('otaStatusText');
  const logBox = document.getElementById('otaLogContainer');
  const logContent = document.getElementById('otaLogContent');

  if (!confirm('Apply remote update? This will pull latest bug fixes and sync questions from the cloud.')) return;

  btn.disabled = true;
  btn.textContent = 'Updating...';
  logBox.style.display = 'block';
  logContent.innerHTML = 'Connecting to remote cloud and repositories...<br>';
  statusBox.style.background = '#fef3c7';
  statusBox.style.color = '#92400e';
  statusText.textContent = 'Applying updates... Please do not disconnect Wi-Fi.';

  try {
    const res = await adminFetch('/api/admin/ota/apply', { method: 'POST' });
    const data = await res.json();
    if (data.log && Array.isArray(data.log)) {
      logContent.innerHTML = data.log.map(l => `<div>${l}</div>`).join('');
    }
    if (data.success) {
      statusBox.style.background = '#dcfce7';
      statusBox.style.color = '#166534';
      statusText.innerHTML = `<strong>🎉 ${data.message || 'Update Successful!'}</strong><br><span style="font-size:0.8rem;">The latest code and questions are now live.</span>`;
      setTimeout(() => {
        fetchCothiSchools(false);
        loadBranding();
        loadExams();
      }, 1000);
    } else {
      statusBox.style.background = '#fee2e2';
      statusBox.style.color = '#991b1b';
      statusText.textContent = '❌ Update failed: ' + (data.error || data.message || 'Unknown error');
    }
  } catch (err) {
    statusBox.style.background = '#fee2e2';
    statusBox.style.color = '#991b1b';
    statusText.textContent = 'Update error: ' + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ Apply Remote Update';
  }
}

// Start: require a valid supervisor session before loading the console.
function bootAdmin() {
  if (adminToken) {
    document.getElementById('adminLoginModal').style.display = 'none';
    initAdmin();
  } else {
    document.getElementById('adminLoginModal').style.display = 'flex';
  }
}
bootAdmin();
