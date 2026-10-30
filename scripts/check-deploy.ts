import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { execSync } from 'child_process';

const prisma = new PrismaClient();

interface CheckResult {
  name: string;
  pass: boolean;
  reason?: string;
}

const KNOWN_DEFAULT_PASSWORDS = [
  'Admin123!',
  'Teacher123!',
  'Student123!',
  'Admin@123',
  'Teacher@123',
  'Student@123',
  'password123',
  'password',
  'admin',
  'secret',
];

const SEED_EMAILS = [
  'admin@eduflow.com',
  'teacher@eduflow.com',
  'student@eduflow.com',
];

async function runChecks(): Promise<boolean> {
  const results: CheckResult[] = [];

  // Check 1: Required env variables present (names only)
  const requiredEnvs = ['DATABASE_URL', 'JWT_SECRET', 'FRONTEND_URL', 'NODE_ENV'];
  const missingEnvs = requiredEnvs.filter((k) => !process.env[k]);
  results.push({
    name: 'Required environment variables present',
    pass: missingEnvs.length === 0,
    reason: missingEnvs.length === 0 ? undefined : `Missing variables: ${missingEnvs.join(', ')}`,
  });

  // Check 2: NODE_ENV=production
  const isProd = process.env.NODE_ENV === 'production';
  results.push({
    name: 'NODE_ENV is set to production',
    pass: isProd,
    reason: isProd ? undefined : 'NODE_ENV is not "production"',
  });

  // Check 3: JWT_SECRET length >= 32
  const jwtSecret = process.env.JWT_SECRET || '';
  const jwtPass = jwtSecret.length >= 32;
  results.push({
    name: 'JWT_SECRET length at least 32 characters',
    pass: jwtPass,
    reason: jwtPass ? undefined : 'JWT_SECRET is shorter than 32 characters or not set',
  });

  // Check 4: FRONTEND_URL is https and has no trailing slash
  const frontendUrl = process.env.FRONTEND_URL || '';
  const frontendUrlValid =
    frontendUrl.startsWith('https://') &&
    !frontendUrl.endsWith('/') &&
    frontendUrl.length > 8;
  results.push({
    name: 'FRONTEND_URL is HTTPS without trailing slash',
    pass: frontendUrlValid,
    reason: frontendUrlValid ? undefined : 'FRONTEND_URL must start with https:// and not end with /',
  });

  // Check 5: DEMO_MODE is not true
  const demoMode = process.env.DEMO_MODE === 'true';
  results.push({
    name: 'DEMO_MODE is disabled',
    pass: !demoMode,
    reason: !demoMode ? undefined : 'DEMO_MODE is set to true in production',
  });

  // Check 6: LLM_STUB is not set
  const llmStub = !!process.env.LLM_STUB;
  results.push({
    name: 'LLM_STUB is not set',
    pass: !llmStub,
    reason: !llmStub ? undefined : 'LLM_STUB is set in production',
  });

  // Check 6b: ALLOW_RELAXED_RATE_LIMIT is not set
  const relaxedRateLimit = process.env.ALLOW_RELAXED_RATE_LIMIT === 'true';
  results.push({
    name: 'ALLOW_RELAXED_RATE_LIMIT is disabled',
    pass: !relaxedRateLimit,
    reason: !relaxedRateLimit ? undefined : 'ALLOW_RELAXED_RATE_LIMIT must never be set in production deploy',
  });

  // Check 7: DATABASE_URL reachable
  let dbReachable = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch (err: any) {
    dbReachable = false;
  }
  results.push({
    name: 'Database is reachable',
    pass: dbReachable,
    reason: dbReachable ? undefined : 'Failed to connect to database',
  });

  // Check 8: prisma migrate status clean
  let migrateClean = false;
  let migrateReason: string | undefined;
  if (dbReachable) {
    try {
      const output = execSync('npx prisma migrate status', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (
        output.includes('Database schema is up to date') ||
        output.includes('The database is up to date') ||
        output.includes('No pending migrations')
      ) {
        migrateClean = true;
      } else {
        migrateClean = false;
        migrateReason = 'Database has pending or unapplied migrations';
      }
    } catch (e: any) {
      const out = (e.stdout || '') + (e.stderr || '');
      if (
        out.includes('Database schema is up to date') ||
        out.includes('The database is up to date')
      ) {
        migrateClean = true;
      } else {
        migrateClean = false;
        migrateReason = 'Prisma migrate status reported schema drift or unapplied migrations';
      }
    }
  } else {
    migrateReason = 'Cannot verify migrations because database is unreachable';
  }
  results.push({
    name: 'Prisma migrations are up to date',
    pass: migrateClean,
    reason: migrateClean ? undefined : migrateReason,
  });

  // Check 9: CenterSettings row exists
  let settingsRow: any = null;
  if (dbReachable) {
    try {
      settingsRow = await prisma.centerSettings.findUnique({
        where: { key: 'center' },
      });
    } catch {
      settingsRow = null;
    }
  }
  results.push({
    name: 'CenterSettings row exists',
    pass: !!settingsRow,
    reason: !!settingsRow ? undefined : 'CenterSettings row with key "center" was not found',
  });

  // Check 9b: CenterSettings does not contain default placeholders or default name
  let settingsNoPlaceholders = true;
  let placeholderReason: string | undefined;

  if (settingsRow) {
    const issues: string[] = [];
    if (settingsRow.name === 'EduFlow Coaching' || settingsRow.name === 'Coaching Center') {
      issues.push(`default center name "${settingsRow.name}"`);
    }
    if (settingsRow.tagline === 'Modern Coaching Center Management Platform') {
      issues.push('placeholder tagline "Modern Coaching Center Management Platform"');
    }
    if (typeof settingsRow.contactEmail === 'string' && settingsRow.contactEmail.endsWith('.local')) {
      issues.push(`placeholder contactEmail "${settingsRow.contactEmail}"`);
    }
    if (settingsRow.contactPhone === '01700000000') {
      issues.push('placeholder contactPhone "01700000000"');
    }

    if (issues.length > 0) {
      settingsNoPlaceholders = false;
      placeholderReason = `Settings contain unconfigured placeholders: ${issues.join(', ')}`;
    }
  } else if (!dbReachable) {
    settingsNoPlaceholders = false;
    placeholderReason = 'Cannot verify settings placeholders because database is unreachable';
  }

  results.push({
    name: 'CenterSettings contains no unconfigured placeholders or default name',
    pass: settingsNoPlaceholders,
    reason: settingsNoPlaceholders ? undefined : placeholderReason,
  });

  // Check 10: Exactly one or more active SUPER_ADMIN exists
  let superAdminCount = 0;
  if (dbReachable) {
    try {
      superAdminCount = await prisma.user.count({
        where: {
          role: Role.SUPER_ADMIN,
          isActive: true,
        },
      });
    } catch {
      superAdminCount = 0;
    }
  }
  results.push({
    name: 'At least one active SUPER_ADMIN exists',
    pass: superAdminCount >= 1,
    reason: superAdminCount >= 1 ? undefined : 'No active SUPER_ADMIN user found in database',
  });

  // Check 11: No user with email ending @demo.eduflow.local
  let demoUserCount = 0;
  if (dbReachable) {
    try {
      demoUserCount = await prisma.user.count({
        where: {
          email: {
            endsWith: '@demo.eduflow.local',
          },
        },
      });
    } catch {
      demoUserCount = 0;
    }
  }
  results.push({
    name: 'No @demo.eduflow.local users exist in production',
    pass: demoUserCount === 0,
    reason: demoUserCount === 0 ? undefined : `Found ${demoUserCount} demo user(s) in database`,
  });

  // Check 12: No known default passwords work for seed-era emails
  let seedPasswordsSafe = true;
  let seedPasswordReason: string | undefined;
  if (dbReachable) {
    try {
      const seedUsers = await prisma.user.findMany({
        where: {
          email: { in: SEED_EMAILS },
        },
        select: {
          email: true,
          password: true,
        },
      });

      for (const u of seedUsers) {
        for (const pwd of KNOWN_DEFAULT_PASSWORDS) {
          const match = await bcrypt.compare(pwd, u.password);
          if (match) {
            seedPasswordsSafe = false;
            seedPasswordReason = `Known default password detected for account: ${u.email}`;
            break;
          }
        }
        if (!seedPasswordsSafe) break;
      }
    } catch (e: any) {
      seedPasswordsSafe = false;
      seedPasswordReason = 'Error checking user passwords';
    }
  }
  results.push({
    name: 'No default/seed passwords active for seed accounts',
    pass: seedPasswordsSafe,
    reason: seedPasswordsSafe ? undefined : seedPasswordReason,
  });

  // Check 13: If features.aiAssistant is true then GEMINI_API_KEY exists
  let aiConfigValid = true;
  let aiReason: string | undefined;
  const features = (settingsRow?.features as any) || {};
  if (features.aiAssistant !== false) {
    if (!process.env.GEMINI_API_KEY) {
      aiConfigValid = false;
      aiReason = 'aiAssistant is enabled in CenterSettings but GEMINI_API_KEY is not configured';
    }
  }
  results.push({
    name: 'AI Assistant credentials configured if enabled',
    pass: aiConfigValid,
    reason: aiConfigValid ? undefined : aiReason,
  });

  // Check 14: CORS origin config present
  const corsConfigPresent = !!(process.env.FRONTEND_URL || process.env.CORS_ORIGIN);
  results.push({
    name: 'CORS origin configuration present',
    pass: corsConfigPresent,
    reason: corsConfigPresent ? undefined : 'Neither FRONTEND_URL nor CORS_ORIGIN is set',
  });

  // Output PASS / FAIL lines only (no secret values)
  console.log('================================================================');
  console.log(' DEPLOYMENT HEALTH CHECK RESULTS');
  console.log('================================================================');

  let allPass = true;
  for (const r of results) {
    if (r.pass) {
      console.log(`[PASS] ${r.name}`);
    } else {
      allPass = false;
      console.log(`[FAIL] ${r.name} - ${r.reason || 'Check failed'}`);
    }
  }
  console.log('================================================================');
  console.log(allPass ? 'SUMMARY: ALL DEPLOYMENT CHECKS PASSED' : 'SUMMARY: ONE OR MORE CHECKS FAILED');
  console.log('================================================================');

  return allPass;
}

runChecks()
  .then((pass) => {
    process.exit(pass ? 0 : 1);
  })
  .catch((err) => {
    console.error('Fatal error running deploy checks:', err.message || err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
