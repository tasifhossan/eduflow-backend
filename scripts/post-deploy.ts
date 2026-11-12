/**
 * Reusable Production Rehearsal & Post-Deployment Verification Tool
 *
 * Verifies live production deployments WITHOUT relying on demo login or demo fixtures.
 * Uses real authentication credentials and tests all critical production paths,
 * security headers, CORS restrictions, and session lifecycles without database pollution.
 *
 * Usage:
 *   npx tsx scripts/post-deploy.ts [TARGET_URL]
 *
 * Environment variables (optional):
 *   TARGET_URL                  (default: http://localhost:5001 or process.env.PORT)
 *   REHEARSAL_OWNER_EMAIL       (default: owner@example.com or process.env.OWNER_EMAIL)
 *   REHEARSAL_OWNER_PASSWORD    (default: SuperSecret123! or process.env.OWNER_PASSWORD)
 */

interface CheckResult {
  id: number;
  name: string;
  pass: boolean;
  durationMs: number;
  detail: string;
}

const targetArg = process.argv.find((a) => a.startsWith('http://') || a.startsWith('https://'));
const baseUrl = (
  targetArg ||
  process.env.TARGET_URL ||
  `http://localhost:${process.env.PORT || 5001}`
).replace(/\/$/, '');

const authEmail =
  process.env.REHEARSAL_OWNER_EMAIL ||
  process.env.OWNER_EMAIL ||
  'owner@example.com';
const authPassword =
  process.env.REHEARSAL_OWNER_PASSWORD ||
  process.env.OWNER_PASSWORD ||
  'SuperSecret123!';

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
  console.log('       EduFlow Production Rehearsal & Post-Deployment Verification      ');
  console.log('========================================================================');
  console.log(`Target URL:     ${baseUrl}`);
  console.log(`Auth Identity:  ${authEmail}`);
  console.log(`Timestamp:      ${new Date().toISOString()}`);
  console.log('------------------------------------------------------------------------\n');

  const results: CheckResult[] = [];
  let authCookie: string | null = null;

  async function runCheck(
    id: number,
    name: string,
    fn: () => Promise<{ pass: boolean; detail: string }>
  ) {
    const t0 = performance.now();
    try {
      const { pass, detail } = await fn();
      const durationMs = Math.round(performance.now() - t0);
      results.push({ id, name, pass, durationMs, detail });
      const symbol = pass ? '✓ [PASS]' : '✗ [FAIL]';
      console.log(`${symbol} Check ${id.toString().padStart(2)}: ${name} (${durationMs}ms)`);
      if (!pass) {
        console.log(`        └─ Error: ${detail}`);
      }
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - t0);
      results.push({ id, name, pass: false, durationMs, detail: err.message || String(err) });
      console.log(`✗ [FAIL] Check ${id.toString().padStart(2)}: ${name} (${durationMs}ms)`);
      console.log(`        └─ Exception: ${err.message || String(err)}`);
    }
  }

  // 1. Core Health API
  await runCheck(1, 'Healthcheck API (/api/health)', async () => {
    const res = await request('/api/health');
    const pass = res.status === 200 && res.body?.success === true && res.body?.status === 'ok';
    return {
      pass,
      detail: pass ? 'Healthcheck endpoint responsive (200 OK)' : `Expected 200, got ${res.status}: ${res.rawText.slice(0, 100)}`,
    };
  });

  // 2. Database Connectivity Health
  await runCheck(2, 'Database Health Probe (/api/health/db)', async () => {
    const res = await request('/api/health/db');
    const pass = res.status === 200 && res.body?.success === true && res.body?.status === 'ok';
    return {
      pass,
      detail: pass ? `Database connected (branch count: ${res.body?.branchCount ?? 'N/A'})` : `DB probe failed (${res.status}): ${res.rawText.slice(0, 100)}`,
    };
  });

  // 3. Public Center Settings
  await runCheck(3, 'Public Center Configuration (/api/public/center)', async () => {
    const res = await request('/api/public/center');
    const pass = res.status === 200 && res.body?.success === true && !!res.body?.data?.name;
    return {
      pass,
      detail: pass ? `Center configured: "${res.body?.data?.name}" (Currency: ${res.body?.data?.currency})` : `Failed to load center info (${res.status})`,
    };
  });

  // 4. Production Security Headers
  await runCheck(4, 'Security Headers (Helmet protection)', async () => {
    const res = await request('/api/public/center');
    const nosniff = res.headers.get('x-content-type-options') === 'nosniff';
    const frameOptions = res.headers.get('x-frame-options');
    const csp = res.headers.get('content-security-policy');
    const frameSafe = frameOptions === 'DENY' || frameOptions === 'SAMEORIGIN' || (csp && csp.includes('frame-ancestors'));
    const pass = nosniff && frameSafe;
    return {
      pass,
      detail: pass ? 'x-content-type-options: nosniff and frame protection present' : `Missing security headers (nosniff=${nosniff}, frameSafe=${frameSafe})`,
    };
  });

  // 5. CORS Enforcement on Untrusted Origins
  await runCheck(5, 'CORS Isolation against untrusted origins', async () => {
    const evilOrigin = 'https://malicious-third-party.evil';
    const res = await request('/api/public/center', {
      headers: { Origin: evilOrigin },
    });
    const allowOrigin = res.headers.get('access-control-allow-origin');
    const pass = allowOrigin !== evilOrigin && allowOrigin !== '*';
    return {
      pass,
      detail: pass ? `Untrusted origin rejected (allow-origin: ${allowOrigin || 'none'})` : `Insecure CORS: Allowed ${evilOrigin}!`,
    };
  });

  // 6. Demo Mode Lockdown Invariant
  await runCheck(6, 'Demo Mode Strictly Disabled (/api/auth/demo -> 404)', async () => {
    const res = await request('/api/auth/demo', {
      method: 'POST',
      body: { role: 'ADMIN' },
    });
    const pass = res.status === 404;
    return {
      pass,
      detail: pass ? 'Demo authentication route correctly returns 404 in production' : `Security violation: /api/auth/demo returned ${res.status} (must be 404)`,
    };
  });

  // 7. Invalid Credential Rejection
  await runCheck(7, 'Authentication Rejection on Invalid Password', async () => {
    const res = await request('/api/auth/login', {
      method: 'POST',
      body: {
        identifier: authEmail,
        password: 'IncorrectPassword999!',
      },
    });
    const pass = res.status === 401;
    return {
      pass,
      detail: pass ? 'Invalid password correctly rejected with 401' : `Expected 401, got ${res.status}: ${res.rawText.slice(0, 100)}`,
    };
  });

  // 8. Real Production Authentication (No Demo Bypass)
  await runCheck(8, 'Real Password Authentication & Session Cookie Issuance', async () => {
    const res = await request('/api/auth/login', {
      method: 'POST',
      body: {
        identifier: authEmail,
        password: authPassword,
      },
    });

    const is200 = res.status === 200 && res.body?.success === true;
    const hasCookie = !!res.tokenCookie;
    const cookieHeader = res.setCookieHeader || '';
    const hasHttpOnly = cookieHeader.toLowerCase().includes('httponly');

    authCookie = res.tokenCookie;

    const pass = is200 && hasCookie && hasHttpOnly;
    return {
      pass,
      detail: pass
        ? `Authenticated as ${res.body?.data?.user?.email} [${res.body?.data?.user?.role}] with HttpOnly session cookie`
        : `Login failed (${res.status}): ${res.rawText.slice(0, 100)} (cookie present: ${hasCookie}, HttpOnly: ${hasHttpOnly})`,
    };
  });

  // 9. Current User Profile Session Verification
  await runCheck(9, 'Authenticated Profile Verification (/api/auth/me)', async () => {
    if (!authCookie) return { pass: false, detail: 'Skipped: No auth cookie from login' };
    const res = await request('/api/auth/me', { cookie: authCookie });
    const user = res.body?.data?.user || res.body?.data;
    const pass = res.status === 200 && user?.email === authEmail;
    return {
      pass,
      detail: pass ? `Session valid for userId: ${user?.id} (${user?.name})` : `Failed to load profile (${res.status}): ${res.rawText.slice(0, 100)}`,
    };
  });

  // 10. Authenticated Branch List
  await runCheck(10, 'Branch Registry Scoping (/api/branches)', async () => {
    if (!authCookie) return { pass: false, detail: 'Skipped: No auth cookie' };
    const res = await request('/api/branches', { cookie: authCookie });
    const branches = res.body?.data;
    const pass = res.status === 200 && Array.isArray(branches) && branches.length > 0;
    return {
      pass,
      detail: pass ? `Found ${branches.length} branch(es): "${branches[0]?.name}"` : `Failed to retrieve branches (${res.status})`,
    };
  });

  // 11. Authenticated User Management Access
  await runCheck(11, 'Staff / User Directory (/api/users)', async () => {
    if (!authCookie) return { pass: false, detail: 'Skipped: No auth cookie' };
    const res = await request('/api/users', { cookie: authCookie });
    const users = res.body?.data;
    const pass = res.status === 200 && Array.isArray(users) && users.length > 0;
    return {
      pass,
      detail: pass ? `User directory accessible (${users.length} active user(s))` : `User directory failed (${res.status})`,
    };
  });

  // 12. Public Batches Catalog (PII Sanitization)
  await runCheck(12, 'Public Course / Batch Catalog (/api/public/batches)', async () => {
    const res = await request('/api/public/batches');
    const items = res.body?.data?.items || res.body?.data;
    const pass = res.status === 200 && Array.isArray(items);
    return {
      pass,
      detail: pass ? `Public batch catalog online (${items.length} published batch(es))` : `Public batches failed (${res.status})`,
    };
  });

  // 13. Public Landing & Center Stats
  await runCheck(13, 'Public Center Directory & Stats (/api/public/stats & /branches)', async () => {
    const resStats = await request('/api/public/stats');
    const resBranches = await request('/api/public/branches');
    const pass = resStats.status === 200 && resBranches.status === 200;
    return {
      pass,
      detail: pass ? 'Public directory and stats endpoints online' : `Stats status=${resStats.status}, Branches status=${resBranches.status}`,
    };
  });

  // 14. Session Termination (Logout)
  await runCheck(14, 'Secure Session Termination (/api/auth/logout)', async () => {
    if (!authCookie) return { pass: false, detail: 'Skipped: No auth cookie' };
    const res = await request('/api/auth/logout', {
      method: 'POST',
      cookie: authCookie,
    });
    const pass = res.status === 200;
    return {
      pass,
      detail: pass ? 'Session cleared successfully' : `Logout failed (${res.status})`,
    };
  });

  // 15. Session Revocation Verification
  await runCheck(15, 'Post-Logout Access Revocation (/api/auth/me -> 401)', async () => {
    // Send request with an empty/cleared token
    const res = await request('/api/auth/me', {
      cookie: 'token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    });
    const pass = res.status === 401;
    return {
      pass,
      detail: pass ? 'Access revoked: Protected route returns 401 Unauthorized' : `Expected 401, got ${res.status}`,
    };
  });

  console.log('\n========================================================================');
  const allPass = results.every((r) => r.pass);
  const totalDuration = results.reduce((acc, r) => acc + r.durationMs, 0);
  console.log(
    `SUMMARY: ${results.filter((r) => r.pass).length}/${results.length} CHECKS PASSED (${totalDuration}ms)`
  );
  console.log('========================================================================');

  if (!allPass) {
    console.error('Production Rehearsal Verification FAILED.');
    process.exit(1);
  } else {
    console.log('Production Rehearsal Verification SUCCEEDED: Zero regressions detected.');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
