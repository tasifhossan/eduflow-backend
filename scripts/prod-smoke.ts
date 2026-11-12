/**
 * Production Smoke Test Suite & Reusable Post-Deployment Verifier
 *
 * Usage:
 *   npm run prod:smoke -- --base <url> [--readonly] [--include-rate-limit]
 *
 * Environment variables:
 *   OWNER_PASSWORD             (Required: owner password for authentication)
 *   OWNER_EMAIL                (Optional: defaults to owner@example.com)
 *
 * Safety Guards:
 *   - In FIXTURE mode, strictly refuses unless the Center name contains "STAGING" or "SCRATCH".
 *   - If DATABASE_URL is set in environment, refuses unless it contains "scratch" or "rehearsal".
 *   - The owner password is NEVER hardcoded and is only read from the environment at runtime.
 */

interface AssertionResult {
  id: number;
  name: string;
  pass: boolean;
  durationMs: number;
  detail: string;
}

// 1. Parse CLI arguments
const args = process.argv.slice(2);
let baseUrl = 'http://localhost:5000';
const baseIdx = args.indexOf('--base');
if (baseIdx !== -1 && args[baseIdx + 1]) {
  baseUrl = args[baseIdx + 1];
} else {
  const directUrl = args.find((a) => a.startsWith('http://') || a.startsWith('https://'));
  if (directUrl) baseUrl = directUrl;
}
baseUrl = baseUrl.replace(/\/$/, '');

const isReadOnly = args.includes('--readonly');
const includeRateLimit = args.includes('--include-rate-limit');

const ownerEmail = process.env.OWNER_EMAIL || process.env.REHEARSAL_OWNER_EMAIL || 'owner@example.com';
const ownerPassword = process.env.OWNER_PASSWORD || process.env.REHEARSAL_OWNER_PASSWORD || '';

if (!ownerPassword) {
  console.error('\n[FATAL ERROR]: OWNER_PASSWORD environment variable is required at runtime.\n');
  process.exit(1);
}

// Safety Guard on DATABASE_URL if present
const envDbUrl = process.env.DATABASE_URL || process.env.DIRECT_URL || '';
if (envDbUrl) {
  const match = envDbUrl.match(/\/([^/?]+)(\?|$)/);
  const dbName = (match ? match[1] : '').toLowerCase();
  if (dbName && !dbName.includes('scratch') && !dbName.includes('rehearsal')) {
    console.error(`\n[SAFETY GUARD REFUSAL]: Database "${dbName}" does not contain "scratch" or "rehearsal".`);
    console.error('Fixture mutation is strictly forbidden against non-scratch databases.\n');
    process.exit(1);
  }
}

async function request(
  endpoint: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: any;
    cookie?: string;
  } = {}
) {
  const url = `${baseUrl}${endpoint}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (options.cookie) {
    headers['Cookie'] = options.cookie;
  }

  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const rawText = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(rawText);
  } catch {}

  const setCookieHeader = res.headers.get('set-cookie');
  let tokenCookie: string | null = null;
  if (setCookieHeader) {
    const match = setCookieHeader.match(/token=([^;]+)/);
    if (match) {
      tokenCookie = `token=${match[1]}`;
    }
  }

  return {
    status: res.status,
    headers: res.headers,
    body: json,
    rawText,
    tokenCookie,
    setCookieHeader,
  };
}

async function main() {
  console.log('========================================================================');
  console.log('             EduFlow Production Smoke & Rehearsal Test Suite            ');
  console.log('========================================================================');
  console.log(`Base URL:     ${baseUrl}`);
  console.log(`Mode:         ${isReadOnly ? 'READONLY (Production-Safe)' : 'FIXTURE (Scratch/Staging Only)'}`);
  console.log(`Owner Email:  ${ownerEmail}`);
  console.log(`Timestamp:    ${new Date().toISOString()}`);
  console.log('========================================================================\n');

  const assertions: AssertionResult[] = [];
  let assertionCounter = 1;

  async function assertCheck(
    name: string,
    fn: () => Promise<{ pass: boolean; detail: string }>
  ) {
    const id = assertionCounter++;
    const t0 = performance.now();
    try {
      const { pass, detail } = await fn();
      const durationMs = Math.round(performance.now() - t0);
      assertions.push({ id, name, pass, durationMs, detail });
      const tag = pass ? '[PASS]' : '[FAIL]';
      console.log(`${tag} Check ${id.toString().padStart(2)}: ${name} (${durationMs}ms) - ${detail}`);
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - t0);
      const detail = err.message || String(err);
      assertions.push({ id, name, pass: false, durationMs, detail });
      console.log(`[FAIL] Check ${id.toString().padStart(2)}: ${name} (${durationMs}ms) - Exception: ${detail}`);
    }
  }

  // ---------------------------------------------------------------------------
  // PART 1: READONLY SUITE (Safe for real production centers)
  // ---------------------------------------------------------------------------
  console.log('--- READONLY MODE ASSERTIONS ---');

  // Check 1: Healthcheck API
  await assertCheck('Healthcheck API (/api/health)', async () => {
    const res = await request('/api/health');
    const pass = res.status === 200 && res.body?.success === true && res.body?.status === 'ok';
    return { pass, detail: `Status: ${res.status}` };
  });

  // Check 2: Database Connectivity Health
  await assertCheck('Database Connectivity (/api/health/db)', async () => {
    const res = await request('/api/health/db');
    const pass = res.status === 200 && res.body?.success === true && res.body?.status === 'ok';
    return { pass, detail: `Status: ${res.status}, Branch count: ${res.body?.branchCount ?? 'N/A'}` };
  });

  // Check 3: Public Center Endpoint
  let centerName = '';
  await assertCheck('Public Center Endpoint (/api/public/center)', async () => {
    const res = await request('/api/public/center');
    centerName = res.body?.data?.name || '';
    const pass = res.status === 200 && res.body?.success === true && !!centerName;
    return { pass, detail: `Status: ${res.status}, Center: "${centerName}"` };
  });

  // Check 4: Demo login strictly blocked (404)
  await assertCheck('Demo login returns 404 in production mode', async () => {
    const res = await request('/api/auth/demo', {
      method: 'POST',
      body: { role: 'ADMIN' },
    });
    const pass = res.status === 404;
    return { pass, detail: `Status: ${res.status} (expected 404)` };
  });

  // Check 5: Owner login works with real credentials
  let ownerCookie: string | null = null;
  let ownerSetCookieHeader: string | null = null;
  let ownerUser: any = null;
  await assertCheck('Owner authentication with real password', async () => {
    const res = await request('/api/auth/login', {
      method: 'POST',
      body: { identifier: ownerEmail, password: ownerPassword },
    });
    ownerCookie = res.tokenCookie;
    ownerSetCookieHeader = res.setCookieHeader;
    ownerUser = res.body?.data?.user;
    const pass = res.status === 200 && !!ownerCookie && res.body?.data?.user?.email === ownerEmail;
    return { pass, detail: `Status: ${res.status}, Authenticated: ${ownerUser?.email}` };
  });

  // Check 6: Set-Cookie has HttpOnly
  await assertCheck('Owner Set-Cookie header contains HttpOnly', async () => {
    const cookieLower = (ownerSetCookieHeader || '').toLowerCase();
    const pass = cookieLower.includes('httponly');
    return { pass, detail: `HttpOnly present: ${pass}` };
  });

  // Check 7: Set-Cookie has SameSite attribute
  await assertCheck('Owner Set-Cookie header contains SameSite attribute', async () => {
    const cookieLower = (ownerSetCookieHeader || '').toLowerCase();
    const pass = cookieLower.includes('samesite');
    return { pass, detail: `SameSite present: ${pass}` };
  });

  // Check 8: Set-Cookie has Secure or valid production profile
  await assertCheck('Owner Set-Cookie security configuration', async () => {
    const cookieLower = (ownerSetCookieHeader || '').toLowerCase();
    const pass = cookieLower.includes('httponly') && (cookieLower.includes('secure') || baseUrl.startsWith('http://'));
    return { pass, detail: `Cookie attributes verified: ${pass}` };
  });

  // Check 9: Foreign Origin gets NO Access-Control-Allow-Origin
  await assertCheck('Foreign Origin gets no Access-Control-Allow-Origin', async () => {
    const foreignOrigin = 'https://unauthorized-attacker-site.com';
    const res = await request('/api/public/center', { headers: { Origin: foreignOrigin } });
    const allowOrigin = res.headers.get('access-control-allow-origin');
    const pass = allowOrigin !== foreignOrigin && allowOrigin !== '*';
    return { pass, detail: `Foreign origin header: ${allowOrigin || 'None (blocked)'}` };
  });

  // Check 10: Configured FRONTEND_URL origin gets Access-Control-Allow-Origin
  await assertCheck('Configured FRONTEND_URL origin gets Access-Control-Allow-Origin', async () => {
    const configuredOrigin = process.env.FRONTEND_URL || 'http://localhost:3000';
    const res = await request('/api/public/center', { headers: { Origin: configuredOrigin } });
    const allowOrigin = res.headers.get('access-control-allow-origin');
    const pass = allowOrigin === configuredOrigin || allowOrigin === '*';
    return { pass, detail: `Configured: ${configuredOrigin}, Allowed origin header: ${allowOrigin || 'None'}` };
  });

  // Check 11: Security Headers - x-content-type-options: nosniff
  await assertCheck('Security header x-content-type-options: nosniff present', async () => {
    const res = await request('/api/public/center');
    const pass = res.headers.get('x-content-type-options') === 'nosniff';
    return { pass, detail: `Header value: ${res.headers.get('x-content-type-options') || 'missing'}` };
  });

  // Check 12: Security Headers - Frame protection present
  await assertCheck('Security header frame protection present (X-Frame-Options or CSP)', async () => {
    const res = await request('/api/public/center');
    const xfo = res.headers.get('x-frame-options');
    const csp = res.headers.get('content-security-policy');
    const pass = xfo === 'DENY' || xfo === 'SAMEORIGIN' || (!!csp && csp.includes('frame-ancestors'));
    return { pass, detail: `X-Frame-Options: ${xfo || 'none'}, CSP frame-ancestors: ${!!csp}` };
  });

  // Check 13: /api/auth/* responses carry no-store or no-cache
  await assertCheck('/api/auth/* responses carry Cache-Control: no-store', async () => {
    const res = await request('/api/auth/me', { cookie: ownerCookie || undefined });
    const cc = (res.headers.get('cache-control') || '').toLowerCase();
    const pass = cc.includes('no-store') || cc.includes('no-cache');
    return { pass, detail: `Cache-Control: ${res.headers.get('cache-control') || 'none'}` };
  });

  // Check 14: Forged JWT is rejected (401)
  await assertCheck('Forged JWT secret is strictly rejected with 401', async () => {
    const forgedToken = 'token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.forged_signature_here';
    const res = await request('/api/auth/me', { cookie: forgedToken });
    const pass = res.status === 401;
    return { pass, detail: `Status: ${res.status} (expected 401)` };
  });

  // Checks 15 to 29: 15 protected routes return 401 anonymously
  const protectedEndpoints = [
    '/api/auth/me',
    '/api/users',
    '/api/branches',
    '/api/batches',
    '/api/subjects',
    '/api/chapters',
    '/api/lectures',
    '/api/assignments',
    '/api/fees/dues',
    '/api/fees/payments',
    '/api/settings',
    '/api/notifications',
    '/api/tables/users',
    '/api/tables/students',
    '/api/tables/payments',
  ];

  for (const endpoint of protectedEndpoints) {
    await assertCheck(`Protected route ${endpoint} returns 401 anonymously`, async () => {
      const res = await request(endpoint);
      const pass = res.status === 401;
      return { pass, detail: `Status: ${res.status}` };
    });
  }

  // Check 30: /api/settings is readable by the owner
  await assertCheck('Center settings endpoint /api/settings readable by owner', async () => {
    if (!ownerCookie) return { pass: false, detail: 'Skipped: Owner not authenticated' };
    const res = await request('/api/settings', { cookie: ownerCookie });
    const pass = res.status === 200 && res.body?.success === true;
    return { pass, detail: `Status: ${res.status}` };
  });

  // Check 31: Zero credential / token leak in response payloads
  await assertCheck('No response payload contains password hashes or signing keys', async () => {
    if (!ownerCookie) return { pass: false, detail: 'Skipped: Owner not authenticated' };
    const [meRes, settingsRes, usersRes] = await Promise.all([
      request('/api/auth/me', { cookie: ownerCookie }),
      request('/api/settings', { cookie: ownerCookie }),
      request('/api/users', { cookie: ownerCookie }),
    ]);
    const payloadStr = JSON.stringify([meRes.body, settingsRes.body, usersRes.body]);
    const leaked =
      payloadStr.includes('$2b$10$') ||
      payloadStr.includes('passwordHash') ||
      payloadStr.includes('jwtSecret') ||
      payloadStr.includes('JWT_SECRET');
    return { pass: !leaked, detail: `Payload clean of credential hashes: ${!leaked}` };
  });

  // Optional: Rate limit check (run only when --include-rate-limit is passed)
  if (includeRateLimit) {
    await assertCheck('Login rate limiting returns 429 after failed attempts', async () => {
      let reached429 = false;
      for (let i = 1; i <= 12; i++) {
        const res = await request('/api/auth/login', {
          method: 'POST',
          body: { identifier: `nonexistent_${i}@example.com`, password: 'WrongPassword123!' },
        });
        if (res.status === 429) {
          reached429 = true;
          break;
        }
      }
      return { pass: reached429, detail: `Rate limit 429 triggered: ${reached429}` };
    });
  }

  // ---------------------------------------------------------------------------
  // PART 2: FIXTURE MODE (Staging or Scratch DB Only)
  // ---------------------------------------------------------------------------
  if (!isReadOnly) {
    console.log('\n--- FIXTURE MODE ASSERTIONS (Staging / Scratch Only) ---');

    // Safety guard: refuse unless center name contains STAGING or SCRATCH
    const centerUpper = centerName.toUpperCase();
    if (!centerUpper.includes('STAGING') && !centerUpper.includes('SCRATCH')) {
      console.error(
        `\n[SAFETY GUARD REFUSAL]: Center name "${centerName}" does not contain "STAGING" or "SCRATCH".`
      );
      console.error('Fixture mode is strictly prohibited on production centers.\n');
      process.exit(1);
    }

    const ts = Date.now();
    const createdUserIds: string[] = [];
    let studentId = '';
    let studentTempPassword = '';
    let teacherId = '';
    let branchId = '';
    let subjectId = '';
    let batchId = '';
    let lectureId = '';
    let chargeId = '';
    let paymentId = '';

    // Retrieve active branch
    const branchRes = await request('/api/branches', { cookie: ownerCookie! });
    branchId = branchRes.body?.data?.[0]?.id || '';

    // Check 32: Provision PRODSMOKE- users via API
    await assertCheck('Provision PRODSMOKE- users (Teacher, Student, Guardian, Accountant)', async () => {
      const usersToCreate = [
        { role: 'TEACHER', name: `PRODSMOKE-Teacher-${ts}`, email: `prodsmoke.teacher.${ts}@example.com`, phone: `0178${ts.toString().slice(-7)}` },
        { role: 'STUDENT', name: `PRODSMOKE-Student-${ts}`, email: `prodsmoke.student.${ts}@example.com`, phone: `0177${ts.toString().slice(-7)}` },
        { role: 'GUARDIAN', name: `PRODSMOKE-Guardian-${ts}`, email: `prodsmoke.guardian.${ts}@example.com`, phone: `0176${ts.toString().slice(-7)}` },
        { role: 'ACCOUNTANT', name: `PRODSMOKE-Accountant-${ts}`, email: `prodsmoke.acc.${ts}@example.com`, phone: `0175${ts.toString().slice(-7)}` },
      ];

      let allCreated = true;
      for (const u of usersToCreate) {
        const regRes = await request('/api/auth/register', {
          method: 'POST',
          cookie: ownerCookie!,
          body: { ...u, branchId },
        });
        if (regRes.status === 201) {
          const uId = regRes.body?.data?.user?.id;
          createdUserIds.push(uId);
          if (u.role === 'TEACHER') teacherId = uId;
          if (u.role === 'STUDENT') {
            studentId = uId;
            studentTempPassword = regRes.body?.data?.temporaryPassword;
          }
        } else {
          allCreated = false;
        }
      }
      return { pass: allCreated && !!studentId && !!studentTempPassword, detail: `Provisioned 4 users, Student ID: ${studentId}` };
    });

    // Check 33: Student forced password change flow
    let studentCookie: string | null = null;
    const newStudentPassword = 'NewStudentPass123!Secure';
    await assertCheck('Student forced password change lifecycle', async () => {
      // Login with temp password
      const loginRes = await request('/api/auth/login', {
        method: 'POST',
        body: { identifier: `prodsmoke.student.${ts}@example.com`, password: studentTempPassword },
      });
      if (loginRes.status !== 200 || !loginRes.tokenCookie) {
        return { pass: false, detail: `Temp login failed (${loginRes.status}): ${loginRes.rawText.slice(0, 100)}` };
      }

      // Change password
      const changeRes = await request('/api/auth/change-password', {
        method: 'POST',
        cookie: loginRes.tokenCookie,
        body: { currentPassword: studentTempPassword, newPassword: newStudentPassword },
      });
      if (changeRes.status !== 200) {
        return { pass: false, detail: `Change password failed (${changeRes.status}): ${changeRes.rawText.slice(0, 100)}` };
      }

      // Re-login with new password
      const reLoginRes = await request('/api/auth/login', {
        method: 'POST',
        body: { identifier: `prodsmoke.student.${ts}@example.com`, password: newStudentPassword },
      });
      studentCookie = reLoginRes.tokenCookie;
      const pass = reLoginRes.status === 200 && !!studentCookie;
      return { pass, detail: `Password changed and re-authenticated with new password (reLogin=${reLoginRes.status})` };
    });

    // Check 34: Create Batch and Enrollment
    await assertCheck('Create batch and enroll student', async () => {
      // Find or create subject
      subjectId = '';
      const subListRes = await request('/api/subjects', { cookie: ownerCookie! });
      if (Array.isArray(subListRes.body?.data) && subListRes.body.data.length > 0) {
        subjectId = subListRes.body.data[0].id;
      } else {
        const createSubRes = await request('/api/subjects', {
          method: 'POST',
          cookie: ownerCookie!,
          body: { name: `PRODSMOKE-Sub-${ts}`, code: `PSUB${ts.toString().slice(-4)}` },
        });
        subjectId = createSubRes.body?.data?.id;
      }

      // Create batch
      const batchRes = await request('/api/batches', {
        method: 'POST',
        cookie: ownerCookie!,
        body: {
          name: `PRODSMOKE-Batch-${ts}`,
          type: 'ACADEMIC',
          subjectId,
          teacherId,
        },
      });
      batchId = batchRes.body?.data?.id;

      // Enroll student
      const enrollRes = await request('/api/enrollments', {
        method: 'POST',
        cookie: ownerCookie!,
        body: { studentId, batchId },
      });

      const pass = batchRes.status === 201 && enrollRes.status === 201;
      return { pass, detail: `Batch ID: ${batchId}, Enrollment ID: ${enrollRes.body?.data?.id}` };
    });

    // Check 35: Draft lecture creation & student visibility gating
    await assertCheck('Draft lecture hidden from enrolled student', async () => {
      // Create draft lecture (isPublished: false)
      const lecRes = await request('/api/lectures', {
        method: 'POST',
        cookie: ownerCookie!,
        body: {
          batchId,
          subjectId,
          teacherId,
          title: `PRODSMOKE-Draft-${ts}`,
          plannedTopics: 'PRODSMOKE Rehearsal Lesson',
          startsAt: '2026-12-15T10:00:00.000Z',
          endsAt: '2026-12-15T11:00:00.000Z',
          isPublished: false,
        },
      });
      lectureId = lecRes.body?.data?.id;

      // Query lectures as student
      const studentLecRes = await request(`/api/lectures?batchId=${batchId}`, { cookie: studentCookie! });
      const studentLectures = studentLecRes.body?.data?.items || studentLecRes.body?.data || [];
      const isHidden = !studentLectures.some((l: any) => l.id === lectureId);

      const pass = lecRes.status === 201 && isHidden;
      return { pass, detail: `Draft lecture created (${lecRes.status}) and hidden from student (${isHidden})` };
    });

    // Check 36: Create Fee Charge
    await assertCheck('Create manual fee charge for student', async () => {
      const chargeRes = await request('/api/fees/charges', {
        method: 'POST',
        cookie: ownerCookie!,
        body: {
          studentId,
          batchId,
          kind: 'TUITION',
          amount: 2500,
          description: `PRODSMOKE Tuition ${ts}`,
          period: '2026-11',
          dueDate: '2026-11-20',
        },
      });
      chargeId = chargeRes.body?.data?.id;
      const pass = chargeRes.status === 201 && !!chargeId;
      return { pass, detail: `Charge ID: ${chargeId}, Amount: 2500` };
    });

    // Check 37: Record Payment with Receipt & Subsequent Reversal
    await assertCheck('Record payment with receipt number and reverse payment', async () => {
      // Record payment
      const payRes = await request('/api/fees/payments', {
        method: 'POST',
        cookie: ownerCookie!,
        body: {
          studentId,
          amount: 2500,
          method: 'CASH',
          reference: `REF-PROD-${ts}`,
          note: 'Prod smoke payment',
        },
      });
      paymentId = payRes.body?.data?.payment?.id || payRes.body?.data?.id;
      const receiptNumber = payRes.body?.data?.payment?.receiptNumber || payRes.body?.data?.receiptNumber;

      if (payRes.status !== 201 || !paymentId) {
        return { pass: false, detail: `Payment record failed (${payRes.status}): ${payRes.rawText.slice(0, 80)}` };
      }

      // Reverse payment
      const revRes = await request(`/api/fees/payments/${paymentId}/reverse`, {
        method: 'POST',
        cookie: ownerCookie!,
        body: { reason: 'Prod smoke test automated reversal' },
      });

      const pass = revRes.status === 200;
      return { pass, detail: `Receipt: ${receiptNumber}, Reversal status: ${revRes.status}` };
    });

    // Check 38: Deactivate all PRODSMOKE- fixture users
    await assertCheck('Deactivate PRODSMOKE- users at test completion', async () => {
      let allDeactivated = true;
      for (const uId of createdUserIds) {
        const deactRes = await request(`/api/users/${uId}/status`, {
          method: 'PATCH',
          cookie: ownerCookie!,
          body: { isActive: false },
        });
        if (deactRes.status !== 200) allDeactivated = false;
      }
      return { pass: allDeactivated, detail: `Deactivated ${createdUserIds.length} PRODSMOKE users` };
    });

    // Check 39: Print remaining active fixtures
    await assertCheck('Audit remaining active PRODSMOKE fixtures', async () => {
      const usersRes = await request('/api/users', { cookie: ownerCookie! });
      const activeUsers = (usersRes.body?.data || []).filter(
        (u: any) => u.name?.startsWith('PRODSMOKE-') && u.isActive === true
      );
      const pass = activeUsers.length === 0;
      return { pass, detail: `Remaining active PRODSMOKE users: ${activeUsers.length}` };
    });
  }

  // ---------------------------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------------------------
  console.log('\n========================================================================');
  const total = assertions.length;
  const passed = assertions.filter((a) => a.pass).length;
  const failed = total - passed;
  console.log(`TOTAL CHECKS: ${total} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('========================================================================');

  if (failed > 0) {
    console.error(`\nSuite finished with ${failed} failure(s).`);
    process.exit(1);
  } else {
    console.log('\nSuite passed cleanly with 0 failures.');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('\nFatal smoke error:', err);
  process.exit(1);
});
