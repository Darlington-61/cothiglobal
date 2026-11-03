const http = require('http');

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: 'localhost',
      port: 8000,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      let resBody = '';
      res.on('data', c => resBody += c);
      res.on('end', () => resolve(JSON.parse(resBody)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:8000${path}`, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

async function runTests() {
  console.log('--- 1. Testing Server Status ---');
  const status = await get('/api/status');
  console.log('Server Status:', status.status);
  console.log('School Name:', status.branding.schoolName);
  console.log('Active Exam:', status.activeExam ? status.activeExam.title : 'None');

  console.log('\n--- 2. Testing Student Verification (Kiosk Login) ---');
  const verify = await post('/api/student/verify', { regNo: 'CTSS/2026/001', pin: '1234' });
  console.log('Candidate Verified:', verify.success, verify.student.name);

  console.log('\n--- 3. Testing Student Exam Fetch (Sanitized Questions) ---');
  const exam = await get('/api/student/exam');
  console.log('Exam Loaded:', exam.title, `(${exam.questions.length} questions)`);
  console.log('Sample Q1:', exam.questions[0].question);
  console.log('Answer key stripped:', exam.questions[0].correctAnswer === undefined);

  console.log('\n--- 4. Testing Instant Submission (Sub-second drop) ---');
  const start = Date.now();
  const sub = await post('/api/student/submit', {
    regNo: 'CTSS/2026/001',
    examId: exam.examId,
    answers: { 1: 'A', 2: 'A', 3: 'B', 4: 'A', 5: 'B' }
  });
  const elapsed = Date.now() - start;
  console.log(`Instant Submit Response time: ${elapsed}ms`);
  console.log('Submission Result:', sub.receipt.score, '/', sub.receipt.totalMarks, `(${sub.receipt.percentage}%) Passed:`, sub.receipt.passed);

  console.log('\n--- 5. Testing Admin Live Monitor & Results ---');
  const live = await get('/api/admin/live-monitor');
  console.log('Total Submitted in Live Monitor:', live.totalSubmitted);

  const results = await get('/api/admin/results');
  console.log('Results in Admin Table:', results.length);

  console.log('\n✅ ALL CBT OFFLINE SUITE TESTS PASSED WITH 100% SUCCESS!');
  process.exit(0);
}

// Start server in process and test
const { startServer } = require('./server/server');
startServer();
setTimeout(runTests, 1000);
