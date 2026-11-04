function extractCookie(headers: Headers): string {
  const setCookie = headers.get('set-cookie');
  if (!setCookie) return '';
  const match = setCookie.match(/token=([^;]+)/);
  return match ? `token=${match[1]}` : '';
}

async function run() {
  const base = 'http://localhost:5000';

  // 1. Authenticate Demo Guardian
  const gAuthRes = await fetch(`${base}/api/auth/demo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'GUARDIAN' }),
  });
  const guardianCookie = extractCookie(gAuthRes.headers);
  const guardianUser = (await gAuthRes.json()).data.user;
  console.log('Demo Guardian authenticated:', guardianUser.email);

  // 2. Call /api/guardians/my-students
  const myStudentsRes = await fetch(`${base}/api/guardians/my-students`, {
    headers: { Cookie: guardianCookie },
  });
  const myStudentsData = await myStudentsRes.json();
  console.log('GET /api/guardians/my-students Status:', myStudentsRes.status);
  console.log('Linked students count:', myStudentsData.data?.length || 0);
  const linkedChildId = myStudentsData.data?.[0]?.id;
  console.log('Linked child ID:', linkedChildId, 'Name:', myStudentsData.data?.[0]?.name);

  // 3. Call /api/lectures?studentId=<linked child>
  const lecturesRes = await fetch(`${base}/api/lectures?studentId=${linkedChildId}`, {
    headers: { Cookie: guardianCookie },
  });
  const lecturesData = await lecturesRes.json();
  console.log(`GET /api/lectures?studentId=${linkedChildId} Status:`, lecturesRes.status);
  const lectureItems = lecturesData.data?.items || lecturesData.data || [];
  console.log('Lectures count:', Array.isArray(lectureItems) ? lectureItems.length : 0);

  // 4. Call /api/batches?studentId=<linked child>
  const batchesRes = await fetch(`${base}/api/batches?studentId=${linkedChildId}`, {
    headers: { Cookie: guardianCookie },
  });
  const batchesData = await batchesRes.json();
  console.log(`GET /api/batches?studentId=${linkedChildId} Status:`, batchesRes.status);
  const batchList = batchesData.data?.batches || batchesData.data || [];
  console.log('Batches count:', Array.isArray(batchList) ? batchList.length : 0);

  // 5. Authenticate Demo Student
  const sAuthRes = await fetch(`${base}/api/auth/demo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'STUDENT' }),
  });
  const studentCookie = extractCookie(sAuthRes.headers);
  const studentUser = (await sAuthRes.json()).data.user;
  console.log('\nDemo Student authenticated:', studentUser.email);

  // Fetch student's own batches to get own batch ID
  const studentBatchesRes = await fetch(`${base}/api/batches`, {
    headers: { Cookie: studentCookie },
  });
  const studentBatchesData = await studentBatchesRes.json();
  const ownBatch = studentBatchesData.data?.[0] || studentBatchesData.batches?.[0];
  const ownBatchId = ownBatch?.id;
  console.log('Own batch ID:', ownBatchId, 'Name:', ownBatch?.name);

  // 6. Call /api/batches/<own batch>
  const batchDetailRes = await fetch(`${base}/api/batches/${ownBatchId}`, {
    headers: { Cookie: studentCookie },
  });
  const batchDetailData = await batchDetailRes.json();
  console.log(`GET /api/batches/${ownBatchId} Status:`, batchDetailRes.status);

  const payloadStr = JSON.stringify(batchDetailData);
  const hasRoster = /enrollments|roster|studentCode/i.test(payloadStr);
  const hasPeerNames = /"name":"(?!.*Physics|Math|Batch|Demo Teacher).+"/i.test(payloadStr);
  const hasPhones = /phone|\+880/i.test(payloadStr);
  const hasEmails = /email|@eduflow\.com/i.test(payloadStr);
  const hasFeeFields = /feeAmount|feeDiscount|collectedAmount|payment/i.test(payloadStr);

  console.log('\nPrivacy & Security Scan of student batch response:');
  console.log('- Contains roster/enrollments:', hasRoster);
  console.log('- Contains peer names:', hasPeerNames);
  console.log('- Contains phone numbers:', hasPhones);
  console.log('- Contains email addresses:', hasEmails);
  console.log('- Contains fee/payment fields:', hasFeeFields);
  console.log('Returned batch fields:', Object.keys(batchDetailData.data || batchDetailData));

  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
