import prisma from '../src/utils/prisma';

interface ModelCount {
  model: string;
  before: number;
  after: number;
}

const PREFIX_PATTERNS = ['SMOKE-', 'SMB2', 'QA-', 'smoke', 'Smoke', 'matrix', 'Matrix'];

function matchesPrefix(val: string | null | undefined): boolean {
  if (!val) return false;
  return PREFIX_PATTERNS.some((p) => val.startsWith(p) || val.toLowerCase().startsWith(p.toLowerCase()));
}

async function run() {
  console.log('=== Cleaning Test Fixtures (SMOKE-, SMB2, QA-, smoke) ===\n');

  // 1. Collect counts BEFORE
  const usersBefore = await prisma.user.findMany({
    where: {
      OR: [
        { name: { startsWith: 'SMOKE' } },
        { name: { startsWith: 'QA-' } },
        { email: { startsWith: 'smoke' } },
        { email: { startsWith: 'matrix' } },
        { name: { startsWith: 'Matrix' } },
      ],
    },
  });

  const branchesBefore = await prisma.branch.findMany({
    where: {
      OR: [
        { name: { startsWith: 'SMOKE' } },
        { code: { startsWith: 'SMB2' } },
        { name: { startsWith: 'QA-' } },
      ],
    },
  });

  const batchesBefore = await prisma.batch.findMany({
    where: {
      OR: [
        { name: { startsWith: 'SMOKE' } },
        { name: { startsWith: 'QA-' } },
        { name: { startsWith: 'Matrix' } },
      ],
    },
  });

  const testsBefore = await prisma.test.findMany({
    where: {
      OR: [
        { title: { startsWith: 'SMOKE' } },
        { title: { startsWith: 'QA-' } },
      ],
    },
  });

  const assignmentsBefore = await prisma.assignment.findMany({
    where: {
      OR: [
        { title: { startsWith: 'SMOKE' } },
        { title: { startsWith: 'QA-' } },
      ],
    },
  });

  const lecturesBefore = await prisma.lecture.findMany({
    where: {
      OR: [
        { title: { startsWith: 'SMOKE' } },
        { title: { startsWith: 'QA-' } },
      ],
    },
  });

  const enquiriesBefore = await prisma.contactMessage.findMany({
    where: {
      OR: [
        { name: { startsWith: 'SMOKE' } },
        { name: { startsWith: 'QA-' } },
      ],
    },
  });

  const reportPeriodsBefore = await prisma.reportPeriod.findMany({
    where: {
      OR: [
        { label: { startsWith: 'SMOKE' } },
        { label: { startsWith: 'QA-' } },
      ],
    },
  });

  console.log('--- COUNTS BEFORE CLEANUP ---');
  console.log(`User: ${usersBefore.length}`);
  console.log(`Branch: ${branchesBefore.length}`);
  console.log(`Batch: ${batchesBefore.length}`);
  console.log(`Test: ${testsBefore.length}`);
  console.log(`Assignment: ${assignmentsBefore.length}`);
  console.log(`Lecture: ${lecturesBefore.length}`);
  console.log(`Enquiry: ${enquiriesBefore.length}`);
  console.log(`ReportPeriod: ${reportPeriodsBefore.length}`);

  // 2. Perform safe deletion in reverse-dependency order
  const testIds = testsBefore.map((t) => t.id);
  const assignmentIds = assignmentsBefore.map((a) => a.id);
  const lectureIds = lecturesBefore.map((l) => l.id);
  const batchIds = batchesBefore.map((b) => b.id);
  const userIds = usersBefore.map((u) => u.id);
  const branchIds = branchesBefore.map((b) => b.id);
  const enquiryIds = enquiriesBefore.map((e) => e.id);
  const reportPeriodIds = reportPeriodsBefore.map((r) => r.id);

  if (testIds.length > 0) {
    await prisma.result.deleteMany({ where: { testId: { in: testIds } } });
    await prisma.question.deleteMany({ where: { testId: { in: testIds } } });
    await prisma.test.deleteMany({ where: { id: { in: testIds } } });
  }

  if (assignmentIds.length > 0) {
    await prisma.assignmentSubmission.deleteMany({ where: { assignmentId: { in: assignmentIds } } });
    await prisma.assignment.deleteMany({ where: { id: { in: assignmentIds } } });
  }

  if (lectureIds.length > 0) {
    await prisma.attendance.deleteMany({ where: { lectureId: { in: lectureIds } } });
    await prisma.lecture.deleteMany({ where: { id: { in: lectureIds } } });
  }

  if (reportPeriodIds.length > 0) {
    await prisma.reportRemark.deleteMany({ where: { reportPeriodId: { in: reportPeriodIds } } });
    await prisma.reportPeriod.deleteMany({ where: { id: { in: reportPeriodIds } } });
  }

  if (batchIds.length > 0) {
    await prisma.attendance.deleteMany({ where: { batchId: { in: batchIds } } });
    await prisma.result.deleteMany({ where: { test: { batchId: { in: batchIds } } } });
    await prisma.testAttempt.deleteMany({ where: { test: { batchId: { in: batchIds } } } });
    await prisma.question.deleteMany({ where: { test: { batchId: { in: batchIds } } } });
    await prisma.test.deleteMany({ where: { batchId: { in: batchIds } } });
    await prisma.assignmentSubmission.deleteMany({ where: { assignment: { batchId: { in: batchIds } } } });
    await prisma.assignment.deleteMany({ where: { batchId: { in: batchIds } } });
    await prisma.lecture.deleteMany({ where: { batchId: { in: batchIds } } });
    await prisma.enrollment.deleteMany({ where: { batchId: { in: batchIds } } });
    await prisma.routineSlot.deleteMany({ where: { batchId: { in: batchIds } } });
    await prisma.feeCharge.deleteMany({ where: { batchId: { in: batchIds } } });
    await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
  }

  if (enquiryIds.length > 0) {
    await prisma.enquiryNote.deleteMany({ where: { enquiryId: { in: enquiryIds } } });
    await prisma.contactMessage.deleteMany({ where: { id: { in: enquiryIds } } });
  }

  if (userIds.length > 0) {
    await prisma.guardianLink.deleteMany({ where: { OR: [{ studentId: { in: userIds } }, { guardianId: { in: userIds } }] } });
    await prisma.enrollment.deleteMany({ where: { studentId: { in: userIds } } });
    await prisma.paymentAllocation.deleteMany({ where: { payment: { studentId: { in: userIds } } } });
    await prisma.payment.deleteMany({ where: { studentId: { in: userIds } } });
    await prisma.feeCharge.deleteMany({ where: { studentId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  if (branchIds.length > 0) {
    await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
  }

  // 3. Collect counts AFTER
  const usersAfter = await prisma.user.count({
    where: {
      OR: [
        { name: { startsWith: 'SMOKE' } },
        { name: { startsWith: 'QA-' } },
        { email: { startsWith: 'smoke' } },
        { email: { startsWith: 'matrix' } },
        { name: { startsWith: 'Matrix' } },
      ],
    },
  });

  const branchesAfter = await prisma.branch.count({
    where: {
      OR: [
        { name: { startsWith: 'SMOKE' } },
        { code: { startsWith: 'SMB2' } },
        { name: { startsWith: 'QA-' } },
      ],
    },
  });

  const batchesAfter = await prisma.batch.count({
    where: {
      OR: [
        { name: { startsWith: 'SMOKE' } },
        { name: { startsWith: 'QA-' } },
        { name: { startsWith: 'Matrix' } },
      ],
    },
  });

  const testsAfter = await prisma.test.count({
    where: {
      OR: [
        { title: { startsWith: 'SMOKE' } },
        { title: { startsWith: 'QA-' } },
      ],
    },
  });

  const assignmentsAfter = await prisma.assignment.count({
    where: {
      OR: [
        { title: { startsWith: 'SMOKE' } },
        { title: { startsWith: 'QA-' } },
      ],
    },
  });

  const lecturesAfter = await prisma.lecture.count({
    where: {
      OR: [
        { title: { startsWith: 'SMOKE' } },
        { title: { startsWith: 'QA-' } },
      ],
    },
  });

  const enquiriesAfter = await prisma.contactMessage.count({
    where: {
      OR: [
        { name: { startsWith: 'SMOKE' } },
        { name: { startsWith: 'QA-' } },
      ],
    },
  });

  const reportPeriodsAfter = await prisma.reportPeriod.count({
    where: {
      OR: [
        { label: { startsWith: 'SMOKE' } },
        { label: { startsWith: 'QA-' } },
      ],
    },
  });

  console.log('\n--- COUNTS AFTER CLEANUP ---');
  console.log(`User: ${usersAfter}`);
  console.log(`Branch: ${branchesAfter}`);
  console.log(`Batch: ${batchesAfter}`);
  console.log(`Test: ${testsAfter}`);
  console.log(`Assignment: ${assignmentsAfter}`);
  console.log(`Lecture: ${lecturesAfter}`);
  console.log(`Enquiry: ${enquiriesAfter}`);
  console.log(`ReportPeriod: ${reportPeriodsAfter}`);

  console.log('\n✓ Fixtures cleanup complete.');
  process.exit(0);
}

run().catch((err) => {
  console.error('Fixture cleanup error:', err);
  process.exit(1);
});
