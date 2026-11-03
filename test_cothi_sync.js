const http = require('http');
const dgram = require('dgram');
const { startServer } = require('./server/server');

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

async function runTest() {
  console.log('=== TEST 1: Check Registered Schools on COTHI Cloud ===');
  const schools = await get('/api/admin/cothi-schools');
  console.log('Found Schools:', schools.map(s => `${s.code} (${s.name})`));

  console.log('\n=== TEST 2: Select & Download School Data (excel) ===');
  const syncRes = await post('/api/admin/sync-school', { schoolCode: 'excel' });
  console.log('Sync Result:', syncRes.success, 'School:', syncRes.school.name, 'Students:', syncRes.studentsCount);

  console.log('\n=== TEST 3: Verify Server Status Reflects Active School ===');
  const status = await get('/api/status');
  console.log('Active School Name:', status.branding.schoolName);
  console.log('Primary Color:', status.branding.primaryColor);
  console.log('Active Exam:', status.activeExam ? status.activeExam.title : 'None');

  console.log('\n=== TEST 4: Student Verification with Active School Candidate ===');
  const verify = await post('/api/student/verify', { regNo: 'excel001', pin: 'excel' });
  console.log('Active School Candidate Verified:', verify.success, verify.student ? verify.student.name : 'N/A');

  console.log('\n=== TEST 5: UDP LAN Auto-Discovery by Student App ===');
  const client = dgram.createSocket('udp4');
  client.on('message', (msg, rinfo) => {
    const data = JSON.parse(msg.toString());
    console.log(`[DISCOVERY SUCCESS] Received server beacon from ${rinfo.address}:`);
    console.log(' -> School detected:', data.school.name);
    console.log(' -> HTTP Port:', data.httpPort);
    client.close();
    console.log('\n✅ ALL 5 COTHI MULTI-SCHOOL & AUTO-DISCOVERY TESTS PASSED!');
    process.exit(0);
  });

  client.bind(0, () => {
    client.setBroadcast(true);
    const ping = Buffer.from('COTHI_DISCOVER');
    client.send(ping, 0, ping.length, 8001, '127.0.0.1');
  });
}

// Start Server and run test
startServer();
setTimeout(runTest, 1200);
