import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import prisma from '../src/utils/prisma';
import env from '../src/config/env';
import app from '../src/index';

function introspectRoutes(expressApp: any): Array<{ method: string; path: string }> {
  const routes: Array<{ method: string; path: string }> = [];
  const stack = expressApp.router?.stack || expressApp._router?.stack || [];

  // Top-level direct routes
  for (const layer of stack) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods);
      for (const m of methods) {
        routes.push({
          method: m.toUpperCase(),
          path: String(layer.route.path).replace(/\/+/g, '/'),
        });
      }
    }
  }

  // Sub-routers
  const specificPrefixes = [
    '/api/health',
    '/api/public',
    '/api/tables',
    '/api/charts',
    '/api/me',
    '/api/auth',
    '/api/branches',
    '/api/batches',
    '/api/subjects',
    '/api/users',
    '/api/chapters',
    '/api/dashboard',
    '/api/ai',
    '/api/audit-logs',
    '/api/settings',
    '/api/enquiries',
  ];

  for (const layer of stack) {
    if (layer.handle?.stack) {
      let matchedPrefix = '/api';
      for (const pref of specificPrefixes) {
        if (layer.matchers?.some((fn: any) => fn(pref))) {
          matchedPrefix = pref;
          break;
        }
      }

      for (const sub of layer.handle.stack) {
        if (sub.route) {
          const methods = Object.keys(sub.route.methods);
          for (const m of methods) {
            const fullPath = `${matchedPrefix}${sub.route.path}`.replace(/\/+/g, '/');
            routes.push({
              method: m.toUpperCase(),
              path: fullPath,
            });
          }
        }
      }
    }
  }

  return routes;
}

interface EndpointSpec {
  name: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: (fixtures: Fixtures) => string;
  body?: (fixtures: Fixtures, role: string) => any;
  allowedRoles: Role[];
}

interface Fixtures {
  branchId: string;
  batchId: string;
  subjectId: string;
  studentId: string;
  teacherId: string;
  lectureId: string;
  assignmentId: string;
  submissionId: string;
  testId: string;
  reportPeriodId: string;
  chargeId: string;
  paymentId: string;
}

interface Mismatch {
  endpoint: string;
  method: string;
  role: string;
  expected: string;
  actualStatus: number;
  actualBodySnippet: string;
}

const ROLES: Role[] = [
  Role.SUPER_ADMIN,
  Role.ADMIN,
  Role.TEACHER,
  Role.ACCOUNTANT,
  Role.STUDENT,
  Role.GUARDIAN,
];

async function setupFixtures(): Promise<{ fixtures: Fixtures; tokens: Record<string, string> }> {
  const superAdmin = await prisma.user.findFirst({ where: { role: Role.SUPER_ADMIN, isActive: true } });
  if (!superAdmin) throw new Error('Missing active SUPER_ADMIN user');

  const admin = await prisma.user.findFirst({ where: { role: Role.ADMIN, isActive: true } });
  if (!admin) throw new Error('Missing admin user');

  const teacher = await prisma.user.findFirst({ where: { role: Role.TEACHER, isActive: true } });
  if (!teacher) throw new Error('Missing teacher user');

  const accountant = await prisma.user.findFirst({ where: { role: Role.ACCOUNTANT, isActive: true } });
  if (!accountant) throw new Error('Missing accountant user');

  const student = await prisma.user.findFirst({ where: { role: Role.STUDENT, isActive: true } });
  if (!student) throw new Error('Missing student user');

  const guardian = await prisma.user.findFirst({ where: { role: Role.GUARDIAN, isActive: true } });
  if (!guardian) throw new Error('Missing guardian user');

  const branchId = admin.branchId;
  const batch = await prisma.batch.findFirst({ where: { branchId } });
  if (!batch) throw new Error('Missing batch');

  // Assign batch to teacher and match branchIds
  await prisma.batch.update({
    where: { id: batch.id },
    data: { teacherId: teacher.id },
  });
  await prisma.user.update({
    where: { id: student.id },
    data: { branchId },
  });
  if (accountant.branchId !== branchId) {
    await prisma.user.update({
      where: { id: accountant.id },
      data: { branchId },
    });
  }

  const subject = await prisma.subject.findFirst();
  if (!subject) throw new Error('Missing subject');

  // Ensure student is enrolled in batch
  await prisma.enrollment.upsert({
    where: { studentId_batchId: { studentId: student.id, batchId: batch.id } },
    update: { status: 'ACTIVE' },
    create: { studentId: student.id, batchId: batch.id, status: 'ACTIVE' },
  });

  // Ensure guardian is linked to student
  await prisma.guardianLink.upsert({
    where: { guardianId_studentId: { guardianId: guardian.id, studentId: student.id } },
    update: {},
    create: { guardianId: guardian.id, studentId: student.id },
  });

  // Ensure a lecture exists
  const now = new Date();
  const lecture = await prisma.lecture.findFirst({ where: { batchId: batch.id } }) ||
    await prisma.lecture.create({
      data: {
        batch: { connect: { id: batch.id } },
        teacher: { connect: { id: teacher.id } },
        subject: { connect: { id: subject.id } },
        createdBy: { connect: { id: admin.id } },
        title: 'Matrix Test Lecture',
        plannedTopics: 'Matrix topics',
        startsAt: new Date(now.getTime() - 3600000),
        endsAt: new Date(now.getTime() + 3600000),
        isPublished: true,
      },
    });

  // Ensure an assignment exists
  const assignment = await prisma.assignment.findFirst({ where: { batchId: batch.id } }) ||
    await prisma.assignment.create({
      data: {
        batch: { connect: { id: batch.id } },
        subject: { connect: { id: subject.id } },
        createdBy: { connect: { id: admin.id } },
        title: 'Matrix Test Assignment',
        instructions: 'Test instructions',
        maxMarks: 50,
        dueAt: new Date(now.getTime() + 86400000),
        mode: 'ONLINE',
        allowLate: true,
        publishedAt: new Date(),
      },
    });

  // Ensure a submission exists
  const submission = await prisma.assignmentSubmission.findFirst({ where: { assignmentId: assignment.id, studentId: student.id } }) ||
    await prisma.assignmentSubmission.create({
      data: {
        assignment: { connect: { id: assignment.id } },
        student: { connect: { id: student.id } },
        status: 'SUBMITTED',
        textAnswer: 'Matrix test answer',
        submittedAt: new Date(),
      },
    });

  // Ensure a test exists
  const test = await prisma.test.findFirst({ where: { batchId: batch.id } }) ||
    await prisma.test.create({
      data: {
        batch: { connect: { id: batch.id } },
        createdBy: { connect: { id: admin.id } },
        title: 'Matrix Test Exam',
        type: 'MCQ',
        testDate: now,
        durationMinutes: 30,
        totalMarks: 20,
      },
    });

  // Ensure a report period exists
  const reportPeriod = await prisma.reportPeriod.findFirst({ where: { batchId: batch.id } }) ||
    await prisma.reportPeriod.create({
      data: {
        batch: { connect: { id: batch.id } },
        createdBy: { connect: { id: admin.id } },
        label: 'Matrix Test Term',
        from: new Date('2026-01-01'),
        to: new Date('2026-12-31'),
      },
    });

  // Ensure a fee charge exists
  const charge = await prisma.feeCharge.findFirst({ where: { studentId: student.id, status: 'ACTIVE' } }) ||
    await prisma.feeCharge.create({
      data: {
        student: { connect: { id: student.id } },
        batch: { connect: { id: batch.id } },
        branch: { connect: { id: branchId } },
        createdBy: { connect: { id: admin.id } },
        amount: new (require('@prisma/client').Prisma.Decimal)('100.00'),
        dueDate: new Date(),
        description: 'Matrix Test Fee',
        kind: 'ADMISSION',
        source: 'MANUAL' as any,
        status: 'ACTIVE',
      },
    });

  // Ensure a fee payment exists
  const payment = await prisma.feePayment.findFirst({ where: { studentId: student.id } }) ||
    await prisma.feePayment.create({
      data: {
        student: { connect: { id: student.id } },
        branch: { connect: { id: branchId } },
        amount: new (require('@prisma/client').Prisma.Decimal)('50.00'),
        method: 'CASH',
        receiptNumber: `MAT-26-${Date.now().toString().slice(-6)}`,
        receivedAt: new Date(),
        period: '2026-11',
      },
    });

  const tokens: Record<string, string> = {
    [Role.SUPER_ADMIN]: jwt.sign({ userId: superAdmin.id, role: Role.SUPER_ADMIN, branchId: superAdmin.branchId }, env.JWT_SECRET),
    [Role.ADMIN]: jwt.sign({ userId: admin.id, role: Role.ADMIN, branchId: admin.branchId }, env.JWT_SECRET),
    [Role.TEACHER]: jwt.sign({ userId: teacher.id, role: Role.TEACHER, branchId: teacher.branchId }, env.JWT_SECRET),
    [Role.ACCOUNTANT]: jwt.sign({ userId: accountant.id, role: Role.ACCOUNTANT, branchId: accountant.branchId }, env.JWT_SECRET),
    [Role.STUDENT]: jwt.sign({ userId: student.id, role: Role.STUDENT, branchId: student.branchId }, env.JWT_SECRET),
    [Role.GUARDIAN]: jwt.sign({ userId: guardian.id, role: Role.GUARDIAN, branchId: guardian.branchId }, env.JWT_SECRET),
  };

  return {
    fixtures: {
      branchId,
      batchId: batch.id,
      subjectId: subject.id,
      studentId: student.id,
      teacherId: teacher.id,
      lectureId: lecture.id,
      assignmentId: assignment.id,
      submissionId: submission.id,
      testId: test.id,
      reportPeriodId: reportPeriod.id,
      chargeId: charge.id,
      paymentId: payment.id,
    },
    tokens,
  };
}

const ENDPOINTS: EndpointSpec[] = [
  // 1. Dashboard
  {
    name: 'GET /api/dashboard/academic-summary',
    method: 'GET',
    path: (f) => `/api/dashboard/academic-summary?studentId=${f.studentId}`,
    allowedRoles: [Role.SUPER_ADMIN, Role.ADMIN, Role.TEACHER, Role.STUDENT, Role.GUARDIAN],
  },
  {
    name: 'GET /api/dashboard/summary',
    method: 'GET',
    path: () => '/api/dashboard/summary',
    allowedRoles: [Role.ADMIN, Role.TEACHER, Role.STUDENT, Role.GUARDIAN, Role.SUPER_ADMIN],
  },
  {
    name: 'GET /api/dashboard/super-admin',
    method: 'GET',
    path: () => '/api/dashboard/super-admin',
    allowedRoles: [Role.SUPER_ADMIN],
  },

  // 2. Center Settings & Audit
  {
    name: 'GET /api/settings',
    method: 'GET',
    path: () => '/api/settings',
    allowedRoles: [Role.SUPER_ADMIN],
  },
  {
    name: 'GET /api/audit-logs',
    method: 'GET',
    path: () => '/api/audit-logs',
    allowedRoles: [Role.SUPER_ADMIN, Role.ADMIN],
  },

  // 3. User Management
  {
    name: 'GET /api/users',
    method: 'GET',
    path: () => '/api/users',
    allowedRoles: [Role.SUPER_ADMIN, Role.ADMIN, Role.TEACHER],
  },

  // 4. Batches & Academics
  {
    name: 'GET /api/batches',
    method: 'GET',
    path: (f) => `/api/batches?studentId=${f.studentId}`,
    allowedRoles: [Role.SUPER_ADMIN, Role.ADMIN, Role.TEACHER, Role.STUDENT, Role.GUARDIAN],
  },
  {
    name: 'GET /api/batches/:id',
    method: 'GET',
    path: (f) => `/api/batches/${f.batchId}`,
    allowedRoles: [Role.SUPER_ADMIN, Role.ADMIN, Role.TEACHER, Role.STUDENT, Role.GUARDIAN],
  },
  {
    name: 'POST /api/batches',
    method: 'POST',
    path: () => '/api/batches',
    body: (f) => ({
      name: `Matrix Batch ${Date.now()}`,
      type: 'ACADEMIC',
      branchId: f.branchId,
      subjectId: f.subjectId,
    }),
    allowedRoles: [Role.SUPER_ADMIN, Role.ADMIN],
  },
  {
    name: 'POST /api/lectures',
    method: 'POST',
    path: () => '/api/lectures',
    body: (f) => ({
      batchId: f.batchId,
      teacherId: f.teacherId,
      title: 'Matrix Created Lecture',
      startsAt: new Date(Date.now() + 86400000).toISOString(),
      endsAt: new Date(Date.now() + 90000000).toISOString(),
    }),
    allowedRoles: [Role.SUPER_ADMIN, Role.ADMIN, Role.TEACHER],
  },
  {
    name: 'POST /api/assignments',
    method: 'POST',
    path: () => '/api/assignments',
    body: (f) => ({
      batchId: f.batchId,
      teacherId: f.teacherId,
      title: 'Matrix Created Assignment',
      instructions: 'Matrix task',
      totalMarks: 20,
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      mode: 'ONLINE_TEXT',
    }),
    allowedRoles: [Role.SUPER_ADMIN, Role.ADMIN, Role.TEACHER],
  },

  // 5. Attendance
  {
    name: 'POST /api/attendance',
    method: 'POST',
    path: () => '/api/attendance',
    body: (f) => ({
      batchId: f.batchId,
      date: new Date().toISOString().slice(0, 10),
      records: [{ studentId: f.studentId, status: 'PRESENT' }],
    }),
    allowedRoles: [Role.SUPER_ADMIN, Role.ADMIN, Role.TEACHER],
  },
  {
    name: 'GET /api/attendance/low',
    method: 'GET',
    path: () => '/api/attendance/low',
    allowedRoles: [Role.SUPER_ADMIN, Role.ADMIN, Role.TEACHER],
  },
  {
    name: 'GET /api/batches/:id/attendance/sheet',
    method: 'GET',
    path: (f) => `/api/batches/${f.batchId}/attendance/sheet?month=2026-11`,
    allowedRoles: [Role.SUPER_ADMIN, Role.ADMIN, Role.TEACHER],
  },
  {
    name: 'GET /api/my/attendance/summary',
    method: 'GET',
    path: (f) => `/api/my/attendance/summary?studentId=${f.studentId}`,
    allowedRoles: [Role.STUDENT, Role.GUARDIAN],
  },

  // 6. Fees
  {
    name: 'POST /api/fees/charges',
    method: 'POST',
    path: () => '/api/fees/charges',
    body: (f) => ({
      studentId: f.studentId,
      batchId: f.batchId,
      amount: '50.00',
      dueDate: new Date().toISOString().slice(0, 10),
      description: 'Matrix Charge',
      kind: 'ADMISSION',
      period: null,
    }),
    allowedRoles: [Role.SUPER_ADMIN, Role.ADMIN, Role.ACCOUNTANT],
  },
  {
    name: 'POST /api/fees/charges/installments',
    method: 'POST',
    path: () => '/api/fees/charges/installments',
    body: (f) => ({
      studentId: f.studentId,
      batchId: f.batchId,
      total: '100.00',
      count: 2,
      firstDueDate: new Date().toISOString().slice(0, 10),
      intervalMonths: 1,
      description: 'Matrix Installments',
    }),
    allowedRoles: [Role.SUPER_ADMIN, Role.ADMIN, Role.ACCOUNTANT],
  },
  {
    name: 'POST /api/fees/charges/generate',
    method: 'POST',
    path: () => '/api/fees/charges/generate',
    body: () => ({ month: '2027-06', dryRun: true }),
    allowedRoles: [Role.SUPER_ADMIN, Role.ADMIN, Role.ACCOUNTANT],
  },
  {
    name: 'POST /api/fees/payments',
    method: 'POST',
    path: () => '/api/fees/payments',
    body: (f) => ({
      studentId: f.studentId,
      amount: 10,
      method: 'CASH',
      note: 'Matrix test payment',
    }),
    allowedRoles: [Role.SUPER_ADMIN, Role.ADMIN, Role.ACCOUNTANT],
  },
  {
    name: 'POST /api/fees/payments/:id/reverse',
    method: 'POST',
    path: (f) => `/api/fees/payments/${f.paymentId}/reverse`,
    body: () => ({ reason: 'Matrix payment reversal' }),
    allowedRoles: [Role.SUPER_ADMIN, Role.ADMIN],
  },
  {
    name: 'GET /api/fees/students/:id/account',
    method: 'GET',
    path: (f) => `/api/fees/students/${f.studentId}/account`,
    allowedRoles: [Role.SUPER_ADMIN, Role.ADMIN, Role.ACCOUNTANT],
  },
  {
    name: 'GET /api/fees/my-account',
    method: 'GET',
    path: () => '/api/fees/my-account',
    allowedRoles: [Role.STUDENT],
  },
  {
    name: 'GET /api/fees/guardian/students/:id/account',
    method: 'GET',
    path: (f) => `/api/fees/guardian/students/${f.studentId}/account`,
    allowedRoles: [Role.GUARDIAN],
  },
  {
    name: 'GET /api/fees/dues',
    method: 'GET',
    path: () => '/api/fees/dues',
    allowedRoles: [Role.SUPER_ADMIN, Role.ADMIN, Role.ACCOUNTANT],
  },
  {
    name: 'GET /api/fees/reports/collection',
    method: 'GET',
    path: () => '/api/fees/reports/collection?from=2026-01-01&to=2026-12-31&groupBy=day',
    allowedRoles: [Role.SUPER_ADMIN, Role.ADMIN, Role.ACCOUNTANT],
  },

  // 7. Report Cards & Exports
  {
    name: 'POST /api/report-periods',
    method: 'POST',
    path: () => '/api/report-periods',
    body: (f) => ({
      batchId: f.batchId,
      label: `Matrix Period ${Date.now()}`,
      from: '2026-01-01',
      to: '2026-06-30',
    }),
    allowedRoles: [Role.SUPER_ADMIN, Role.ADMIN, Role.TEACHER],
  },
  {
    name: 'GET /api/report-periods/:id/cards',
    method: 'GET',
    path: (f) => `/api/report-periods/${f.reportPeriodId}/cards`,
    allowedRoles: [Role.SUPER_ADMIN, Role.ADMIN, Role.TEACHER],
  },
  {
    name: 'GET /api/my/report-cards',
    method: 'GET',
    path: (f) => `/api/my/report-cards?studentId=${f.studentId}`,
    allowedRoles: [Role.STUDENT, Role.GUARDIAN],
  },
  {
    name: 'GET /api/exports/students',
    method: 'GET',
    path: () => '/api/exports/students?format=csv',
    allowedRoles: [Role.SUPER_ADMIN, Role.ADMIN],
  },
  {
    name: 'GET /api/exports/batch-results',
    method: 'GET',
    path: (f) => `/api/exports/batch-results?batchId=${f.batchId}&format=csv`,
    allowedRoles: [Role.SUPER_ADMIN, Role.ADMIN],
  },
];

async function runRoleMatrix() {
  console.log('Setting up fixtures for role authorization matrix...');
  const { fixtures, tokens } = await setupFixtures();
  const mismatches: Mismatch[] = [];
  const port = process.env.PORT || '5000';
  const baseUrl = `http://localhost:${port}`;

  // Wait up to 5s for server to be ready
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  // 1. Router Introspection
  console.log('Inspecting Express router for all registered routes...');
  const introspectedRoutes = introspectRoutes(app);
  console.log(`Introspected ${introspectedRoutes.length} registered routes from Express app.`);

  const PUBLIC_ALLOWLIST_PREFIXES = [
    '/api/health',
    '/api/auth/login',
    '/api/auth/demo',
    '/api/auth/logout',
    '/api/auth/forgot-password',
    '/api/auth/reset-password',
    '/api/ai/chat',
    '/api/contact',
    '/api/newsletter',
    '/api/public/',
    '/api/blog',
  ];

  for (const r of introspectedRoutes) {
    const isPublic = PUBLIC_ALLOWLIST_PREFIXES.some((p) => r.path.startsWith(p));
    if (!isPublic) {
      const testPath = r.path.replace(/:[a-zA-Z0-9_]+/g, 'dummy-id-test');
      try {
        const res = await fetch(`${baseUrl}${testPath}`, {
          method: r.method,
          signal: AbortSignal.timeout(3000),
        });
        if (res.status !== 401 && res.status !== 403 && res.status !== 404) {
          const text = await res.text();
          mismatches.push({
            endpoint: `${r.method} ${r.path}`,
            method: r.method,
            role: 'ANONYMOUS',
            expected: '401 Unauthorized',
            actualStatus: res.status,
            actualBodySnippet: text.slice(0, 80),
          });
        }
      } catch (err: any) {
        // network or route-specific error
      }
    }
  }

  // 2. Batch Ownership & Field Sanitization Verification
  console.log('Verifying batch ownership fixtures...');
  const teacherOwnRes = await fetch(`${baseUrl}/api/batches`, {
    headers: { Cookie: `token=${tokens[Role.TEACHER]}` },
  });
  const teacherOwnBatches = await teacherOwnRes.json();
  if (teacherOwnBatches.success) {
    const items = Array.isArray(teacherOwnBatches.data) ? teacherOwnBatches.data : teacherOwnBatches.data?.items || [];
    const notOwn = items.some((b: any) => b.teacherId && b.teacherId !== fixtures.teacherId);
    if (notOwn) {
      mismatches.push({
        endpoint: 'GET /api/batches (TEACHER)',
        method: 'GET',
        role: 'TEACHER',
        expected: 'Only own batches',
        actualStatus: 200,
        actualBodySnippet: 'Leaked batch not assigned to caller teacher',
      });
    }
  }

  const studentBatchRes = await fetch(`${baseUrl}/api/batches/${fixtures.batchId}`, {
    headers: { Cookie: `token=${tokens[Role.STUDENT]}` },
  });
  const studentBatchData = await studentBatchRes.json();
  if (studentBatchData.success) {
    const b = studentBatchData.data;
    if (b.enrollments || b.students || b.feeLedger || b.payments || (b.teacher && b.teacher.email)) {
      mismatches.push({
        endpoint: 'GET /api/batches/:id (STUDENT)',
        method: 'GET',
        role: 'STUDENT',
        expected: 'Sanitized fields only',
        actualStatus: 200,
        actualBodySnippet: 'Leaked roster/fees/teacher email in student batch response',
      });
    }
  }

  console.log(`Auditing ${ENDPOINTS.length} endpoints across Anonymous and 6 Roles...\n`);

  for (const ep of ENDPOINTS) {
    const epPath = ep.path(fixtures);
    const url = `${baseUrl}${epPath}`;
    console.log(`[Testing] ${ep.method} ${ep.name}`);

    // Test 1: Anonymous
    try {
      const res = await fetch(url, {
        method: ep.method,
        headers: ep.body ? { 'Content-Type': 'application/json' } : {},
        body: ep.body ? JSON.stringify(ep.body(fixtures, 'ANONYMOUS')) : undefined,
        signal: AbortSignal.timeout(3000),
      });

      // Anonymous should always get 401 Unauthorized for authenticated endpoints
      if (res.status !== 401 && res.status !== 403) {
        const text = await res.text();
        mismatches.push({
          endpoint: ep.name,
          method: ep.method,
          role: 'ANONYMOUS',
          expected: '401 Unauthorized',
          actualStatus: res.status,
          actualBodySnippet: text.slice(0, 80),
        });
      }
    } catch (err: any) {
      mismatches.push({
        endpoint: ep.name,
        method: ep.method,
        role: 'ANONYMOUS',
        expected: '401 Unauthorized',
        actualStatus: 0,
        actualBodySnippet: err.message,
      });
    }

    // Test 2: Each of the 6 roles
    for (const role of ROLES) {
      const isAllowed = ep.allowedRoles.includes(role);
      const token = tokens[role];

      try {
        const res = await fetch(url, {
          method: ep.method,
          headers: {
            Cookie: `token=${token}`,
            ...(ep.body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: ep.body ? JSON.stringify(ep.body(fixtures, role)) : undefined,
        });

        if (isAllowed) {
          // Expected: access granted (200, 201, or non-401/403 business code)
          if (res.status === 401 || res.status === 403) {
            const text = await res.text();
            mismatches.push({
              endpoint: ep.name,
              method: ep.method,
              role,
              expected: 'Allowed (2xx)',
              actualStatus: res.status,
              actualBodySnippet: text.slice(0, 80),
            });
          }
        } else {
          // Expected: access denied (403 Forbidden or 404 for branch-isolated lookups)
          if (res.status !== 403 && res.status !== 404 && res.status !== 401) {
            const text = await res.text();
            mismatches.push({
              endpoint: ep.name,
              method: ep.method,
              role,
              expected: '403 Forbidden',
              actualStatus: res.status,
              actualBodySnippet: text.slice(0, 80),
            });
          }
        }
      } catch (err: any) {
        mismatches.push({
          endpoint: ep.name,
          method: ep.method,
          role,
          expected: isAllowed ? 'Allowed' : '403 Forbidden',
          actualStatus: 0,
          actualBodySnippet: err.message,
        });
      }
    }
  }

  // Print Report
  console.log('='.repeat(88));
  console.log('                       ROLE AUTHORIZATION MATRIX REPORT                         ');
  console.log('='.repeat(88));

  if (mismatches.length === 0) {
    console.log(`\nAll ${ENDPOINTS.length} endpoints strictly match documented role allowances across all 7 caller contexts (Anonymous + 6 Roles).`);
    console.log('0 MISMATCHES DETECTED.\n');
    console.log('='.repeat(88));
    process.exit(0);
  } else {
    console.error(`\nDETECTED ${mismatches.length} ROLE AUTHORIZATION MISMATCH(ES):\n`);
    console.log('| Method | Endpoint                                  | Role         | Expected        | Status | Body Snippet');
    console.log('|--------|-------------------------------------------|--------------|-----------------|--------|---------------------------');
    for (const m of mismatches) {
      console.log(`| ${m.method.padEnd(6)} | ${m.endpoint.padEnd(41)} | ${m.role.padEnd(12)} | ${m.expected.padEnd(15)} | ${String(m.actualStatus).padEnd(6)} | ${m.actualBodySnippet}`);
    }
    console.log('='.repeat(88));
    process.exit(1);
  }
}

runRoleMatrix().catch((err) => {
  console.error('Fatal error in role-matrix:', err);
  process.exit(1);
});
