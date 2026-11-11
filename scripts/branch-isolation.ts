import dotenv from 'dotenv';
dotenv.config();

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { Role, PrismaClient } from '@prisma/client';
import http from 'http';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const PORT = process.env.PORT || '5000';
const BASE_URL = `http://localhost:${PORT}`;

interface FixturesA {
  branchId: string;
  branchName: string;
  subjectId: string;
  batch1Id: string;
  batch1Name: string;
  batch2Id: string;
  batch2Name: string;
  student1Id: string;
  student1Email: string;
  student2Id: string;
  guardian1Id: string;
  guardian2Id: string;
  teacher1Id: string;
  teacher2Id: string;
  accountantId: string;
  adminId: string;
  enrollment1Id: string;
  pubLectureId: string;
  pubLectureTitle: string;
  draftLectureId: string;
  assignmentId: string;
  assignmentTitle: string;
  submissionId: string;
  testId: string;
  testTitle: string;
  questionId: string;
  attemptId: string;
  resultId: string;
  chargeId: string;
  paymentId: string;
  enquiryId: string;
  enquiryNoteId: string;
  reportPeriodId: string;
  reportRemarkId: string;
  noticeId: string;
  noticeTitle: string;
  attachmentId: string;
  notificationId: string;
  routineSlotId: string;
  resourceId: string;
  adjustmentId: string;
  writtenQuestionId: string;
  studentAnswerId: string;
  practiceSessionId: string;
  guardianLinkId: string;
  reviewId: string;
}

interface FixturesB {
  branchId: string;
  branchName: string;
  adminId: string;
  teacherId: string;
  accountantId: string;
  studentId: string;
  guardianId: string;
}

interface Tokens {
  // Branch B tokens
  ADMIN_B: string;
  TEACHER_B: string;
  ACCOUNTANT_B: string;
  STUDENT_B: string;
  GUARDIAN_B: string;
  // Branch A intra-branch negative probe tokens
  STUDENT_A1: string;
  STUDENT_A2: string;  // enrolled in Batch A2 (NOT Batch A1)
  GUARDIAN_A2: string; // unlinked to Student A1
  TEACHER_A2: string;  // non-assigned to Batch A1
}

interface Leak {
  route: string;
  method: string;
  principal: string;
  status: number;
  evidence: string;
}

function makeToken(user: { id: string; email: string; role: Role; branchId: string }): string {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      branchId: user.branchId,
    },
    JWT_SECRET,
    { expiresIn: '2h' }
  );
}

export async function cleanAllMatrixFixtures() {
  try {
    // 1. Payment reversals & allocations
    await prisma.paymentAllocation.deleteMany({
      where: {
        OR: [
          { payment: { note: { startsWith: 'MATRIX-' } } },
          { payment: { receiptNumber: { startsWith: 'MATRIX-' } } },
          { charge: { description: { startsWith: 'MATRIX-' } } },
        ],
      },
    });

    await prisma.paymentReversal.deleteMany({
      where: {
        OR: [
          { reason: { startsWith: 'MATRIX-' } },
          { payment: { receiptNumber: { startsWith: 'MATRIX-' } } },
        ],
      },
    });

    // 2. Payments & Charges
    await prisma.payment.deleteMany({
      where: {
        OR: [
          { receiptNumber: { startsWith: 'MATRIX-' } },
          { note: { startsWith: 'MATRIX-' } },
          { student: { email: { startsWith: 'matrix.' } } },
        ],
      },
    });

    await prisma.feeAdjustment.deleteMany({
      where: {
        OR: [
          { reason: { startsWith: 'MATRIX-' } },
          { charge: { description: { startsWith: 'MATRIX-' } } },
          { branch: { name: { startsWith: 'MATRIX-' } } },
        ],
      },
    });

    await prisma.feeCharge.deleteMany({
      where: {
        OR: [
          { description: { startsWith: 'MATRIX-' } },
          { student: { email: { startsWith: 'matrix.' } } },
        ],
      },
    });

    // Practice sessions & Reviews & Student answers
    await prisma.practiceSession.deleteMany({
      where: {
        OR: [
          { student: { email: { startsWith: 'matrix.' } } },
          { batch: { name: { startsWith: 'MATRIX-' } } },
        ],
      },
    });

    await prisma.review.deleteMany({
      where: {
        OR: [
          { student: { email: { startsWith: 'matrix.' } } },
          { batch: { name: { startsWith: 'MATRIX-' } } },
        ],
      },
    });

    await prisma.studentAnswer.deleteMany({
      where: {
        OR: [
          { student: { email: { startsWith: 'matrix.' } } },
          { question: { test: { title: { startsWith: 'MATRIX-' } } } },
        ],
      },
    });

    await prisma.resource.deleteMany({
      where: {
        OR: [
          { title: { startsWith: 'MATRIX-' } },
          { batch: { name: { startsWith: 'MATRIX-' } } },
        ],
      },
    });

    // 3. Submissions & Assignments & Attachments
    await prisma.attachment.deleteMany({
      where: {
        OR: [
          { title: { startsWith: 'MATRIX-' } },
          { branch: { name: { startsWith: 'MATRIX-' } } },
        ],
      },
    });

    await prisma.assignmentSubmission.deleteMany({
      where: {
        OR: [
          { student: { email: { startsWith: 'matrix.' } } },
          { assignment: { title: { startsWith: 'MATRIX-' } } },
        ],
      },
    });

    await prisma.assignment.deleteMany({
      where: {
        OR: [
          { title: { startsWith: 'MATRIX-' } },
          { batch: { name: { startsWith: 'MATRIX-' } } },
        ],
      },
    });

    // 4. Test results, attempts, options, questions, tests
    await prisma.result.deleteMany({
      where: {
        OR: [
          { student: { email: { startsWith: 'matrix.' } } },
          { test: { title: { startsWith: 'MATRIX-' } } },
        ],
      },
    });

    await prisma.attemptAnswer.deleteMany({
      where: { attempt: { student: { email: { startsWith: 'matrix.' } } } },
    });

    await prisma.testAttempt.deleteMany({
      where: {
        OR: [
          { student: { email: { startsWith: 'matrix.' } } },
          { test: { title: { startsWith: 'MATRIX-' } } },
        ],
      },
    });

    await prisma.option.deleteMany({
      where: { question: { test: { title: { startsWith: 'MATRIX-' } } } },
    });

    await prisma.question.deleteMany({
      where: { test: { title: { startsWith: 'MATRIX-' } } },
    });

    await prisma.test.deleteMany({
      where: {
        OR: [
          { title: { startsWith: 'MATRIX-' } },
          { batch: { name: { startsWith: 'MATRIX-' } } },
        ],
      },
    });

    // 5. Lectures
    await prisma.lecture.deleteMany({
      where: {
        OR: [
          { title: { startsWith: 'MATRIX-' } },
          { batch: { name: { startsWith: 'MATRIX-' } } },
        ],
      },
    });

    // 6. Report Remarks & Periods
    await prisma.reportRemark.deleteMany({
      where: {
        OR: [
          { period: { label: { startsWith: 'MATRIX-' } } },
          { student: { email: { startsWith: 'matrix.' } } },
        ],
      },
    });

    await prisma.reportPeriod.deleteMany({
      where: {
        OR: [
          { label: { startsWith: 'MATRIX-' } },
          { batch: { name: { startsWith: 'MATRIX-' } } },
        ],
      },
    });

    // 7. Enquiries & Notes
    await prisma.enquiryNote.deleteMany({
      where: {
        OR: [
          { enquiry: { name: { startsWith: 'MATRIX-' } } },
          { enquiry: { email: { startsWith: 'matrix.' } } },
        ],
      },
    });

    await prisma.contactMessage.deleteMany({
      where: {
        OR: [
          { name: { startsWith: 'MATRIX-' } },
          { email: { startsWith: 'matrix.' } },
        ],
      },
    });

    // 8. Notices
    await prisma.notice.deleteMany({
      where: {
        OR: [
          { title: { startsWith: 'MATRIX-' } },
          { branch: { name: { startsWith: 'MATRIX-' } } },
        ],
      },
    });

    // 9. Notifications
    await prisma.notification.deleteMany({
      where: { user: { email: { startsWith: 'matrix.' } } },
    });

    // 10. Attendance
    await prisma.attendance.deleteMany({
      where: {
        OR: [
          { batch: { name: { startsWith: 'MATRIX-' } } },
          { student: { email: { startsWith: 'matrix.' } } },
        ],
      },
    });

    // 11. Routine slots & Reviews
    await prisma.routineSlot.deleteMany({
      where: { batch: { name: { startsWith: 'MATRIX-' } } },
    });
    await prisma.review.deleteMany({
      where: { batch: { name: { startsWith: 'MATRIX-' } } },
    });

    // 12. Enrollments
    await prisma.enrollment.deleteMany({
      where: {
        OR: [
          { batch: { name: { startsWith: 'MATRIX-' } } },
          { student: { email: { startsWith: 'matrix.' } } },
        ],
      },
    });

    // 13. Batches
    await prisma.batch.deleteMany({
      where: { name: { startsWith: 'MATRIX-' } },
    });

    // 14. Guardian Links
    await prisma.guardianLink.deleteMany({
      where: {
        OR: [
          { student: { email: { startsWith: 'matrix.' } } },
          { guardian: { email: { startsWith: 'matrix.' } } },
        ],
      },
    });

    // 15. Users
    await prisma.user.deleteMany({
      where: {
        OR: [
          { email: { startsWith: 'matrix.' } },
          { name: { startsWith: 'MATRIX-' } },
          { branch: { name: { startsWith: 'MATRIX-' } } },
        ],
      },
    });

    // 16. Subjects
    await prisma.subject.deleteMany({
      where: { name: { startsWith: 'MATRIX-' } },
    });

    // 17. Receipt sequences
    await prisma.receiptSequence.deleteMany({
      where: { branch: { name: { startsWith: 'MATRIX-' } } },
    });

    // 18. Branches
    await prisma.branch.deleteMany({
      where: { name: { startsWith: 'MATRIX-' } },
    });
  } catch (err: any) {
    console.warn('Warning during cleanAllMatrixFixtures:', err.message);
  }
}

async function setupIsolationFixtures(): Promise<{
  fixturesA: FixturesA;
  fixturesB: FixturesB;
  tokens: Tokens;
}> {
  await cleanAllMatrixFixtures();
  const ts = Date.now();
  const pwdHash = await bcrypt.hash('MatrixSecret123!', 10);

  // 1. Branches A and B
  const branchA = await prisma.branch.create({
    data: { name: `MATRIX-Branch-A-${ts}`, address: 'Branch A Address' },
  });
  const branchB = await prisma.branch.create({
    data: { name: `MATRIX-Branch-B-${ts}`, address: 'Branch B Address' },
  });

  // 2. Branch A Users
  const adminA = await prisma.user.create({
    data: {
      name: 'MATRIX-Admin-A',
      email: `matrix.admin.a.${ts}@test.local`,
      role: Role.ADMIN,
      branchId: branchA.id,
      password: pwdHash,
      isActive: true,
    },
  });
  const teacherA1 = await prisma.user.create({
    data: {
      name: 'MATRIX-Teacher-A1',
      email: `matrix.teacher.a1.${ts}@test.local`,
      role: Role.TEACHER,
      branchId: branchA.id,
      password: pwdHash,
      isActive: true,
    },
  });
  const teacherA2 = await prisma.user.create({
    data: {
      name: 'MATRIX-Teacher-A2',
      email: `matrix.teacher.a2.${ts}@test.local`,
      role: Role.TEACHER,
      branchId: branchA.id,
      password: pwdHash,
      isActive: true,
    },
  });
  const accountantA = await prisma.user.create({
    data: {
      name: 'MATRIX-Accountant-A',
      email: `matrix.accountant.a.${ts}@test.local`,
      role: Role.ACCOUNTANT,
      branchId: branchA.id,
      password: pwdHash,
      isActive: true,
    },
  });
  const studentA1 = await prisma.user.create({
    data: {
      name: 'MATRIX-Student-A1',
      email: `matrix.student.a1.${ts}@test.local`,
      role: Role.STUDENT,
      branchId: branchA.id,
      password: pwdHash,
      isActive: true,
    },
  });
  const studentA2 = await prisma.user.create({
    data: {
      name: 'MATRIX-Student-A2',
      email: `matrix.student.a2.${ts}@test.local`,
      role: Role.STUDENT,
      branchId: branchA.id,
      password: pwdHash,
      isActive: true,
    },
  });
  const guardianA1 = await prisma.user.create({
    data: {
      name: 'MATRIX-Guardian-A1',
      email: `matrix.guardian.a1.${ts}@test.local`,
      role: Role.GUARDIAN,
      branchId: branchA.id,
      password: pwdHash,
      isActive: true,
    },
  });
  const guardianA2 = await prisma.user.create({
    data: {
      name: 'MATRIX-Guardian-A2',
      email: `matrix.guardian.a2.${ts}@test.local`,
      role: Role.GUARDIAN,
      branchId: branchA.id,
      password: pwdHash,
      isActive: true,
    },
  });

  // Link Guardian A1 to Student A1 (Guardian A2 remains unlinked)
  const guardianLink1 = await prisma.guardianLink.create({
    data: { guardianId: guardianA1.id, studentId: studentA1.id },
  });

  // 3. Branch B Users
  const adminB = await prisma.user.create({
    data: {
      name: 'MATRIX-Admin-B',
      email: `matrix.admin.b.${ts}@test.local`,
      role: Role.ADMIN,
      branchId: branchB.id,
      password: pwdHash,
      isActive: true,
    },
  });
  const teacherB = await prisma.user.create({
    data: {
      name: 'MATRIX-Teacher-B',
      email: `matrix.teacher.b.${ts}@test.local`,
      role: Role.TEACHER,
      branchId: branchB.id,
      password: pwdHash,
      isActive: true,
    },
  });
  const accountantB = await prisma.user.create({
    data: {
      name: 'MATRIX-Accountant-B',
      email: `matrix.accountant.b.${ts}@test.local`,
      role: Role.ACCOUNTANT,
      branchId: branchB.id,
      password: pwdHash,
      isActive: true,
    },
  });
  const studentB = await prisma.user.create({
    data: {
      name: 'MATRIX-Student-B',
      email: `matrix.student.b.${ts}@test.local`,
      role: Role.STUDENT,
      branchId: branchB.id,
      password: pwdHash,
      isActive: true,
    },
  });
  const guardianB = await prisma.user.create({
    data: {
      name: 'MATRIX-Guardian-B',
      email: `matrix.guardian.b.${ts}@test.local`,
      role: Role.GUARDIAN,
      branchId: branchB.id,
      password: pwdHash,
      isActive: true,
    },
  });

  // 4. Branch A Academics & Content
  const subjectA = await prisma.subject.create({
    data: { name: `MATRIX-Subject-A-${ts}` },
  });

  // Batch 1 (assigned to Teacher A1, Student A1 enrolled)
  const batch1 = await prisma.batch.create({
    data: {
      name: `MATRIX-Batch-A1-${ts}`,
      type: 'ACADEMIC',
      branchId: branchA.id,
      subjectId: subjectA.id,
      teacherId: teacherA1.id,
      feeAmount: 500,
      feeBilling: 'MONTHLY',
    },
  });

  const enrollment1 = await prisma.enrollment.create({
    data: {
      batchId: batch1.id,
      studentId: studentA1.id,
      status: 'ACTIVE',
    },
  });

  // Batch 2 in A (assigned to Teacher A2, Student A1 NOT enrolled)
  const batch2 = await prisma.batch.create({
    data: {
      name: `MATRIX-Batch-A2-${ts}`,
      type: 'ACADEMIC',
      branchId: branchA.id,
      subjectId: subjectA.id,
      teacherId: teacherA2.id,
      feeAmount: 500,
      feeBilling: 'MONTHLY',
    },
  });

  const enrollment2 = await prisma.enrollment.create({
    data: {
      batchId: batch2.id,
      studentId: studentA2.id,
      status: 'ACTIVE',
    },
  });

  // Published & Draft Lectures
  const pubLecture = await prisma.lecture.create({
    data: {
      title: `MATRIX-PubLecture-A-${ts}`,
      plannedTopics: 'Matrix planned topics published',
      batchId: batch1.id,
      subjectId: subjectA.id,
      teacherId: teacherA1.id,
      createdById: teacherA1.id,
      status: 'PLANNED',
      isPublished: true,
      startsAt: new Date(Date.now() + 86400000),
      endsAt: new Date(Date.now() + 90000000),
    },
  });

  const draftLecture = await prisma.lecture.create({
    data: {
      title: `MATRIX-DraftLecture-A-${ts}`,
      plannedTopics: 'Matrix planned topics draft',
      batchId: batch1.id,
      subjectId: subjectA.id,
      teacherId: teacherA1.id,
      createdById: teacherA1.id,
      status: 'PLANNED',
      isPublished: false,
      startsAt: new Date(Date.now() + 86400000),
      endsAt: new Date(Date.now() + 90000000),
    },
  });

  // Assignment & Submission
  const assignment = await prisma.assignment.create({
    data: {
      title: `MATRIX-Assignment-A-${ts}`,
      instructions: 'Matrix instructions',
      batchId: batch1.id,
      subjectId: subjectA.id,
      dueAt: new Date(Date.now() + 86400000 * 2),
      maxMarks: 100,
      mode: 'ONLINE',
      publishedAt: new Date(),
      createdById: teacherA1.id,
    },
  });

  const submission = await prisma.assignmentSubmission.create({
    data: {
      assignmentId: assignment.id,
      studentId: studentA1.id,
      textAnswer: 'Matrix answer content',
      submittedAt: new Date(),
      status: 'SUBMITTED',
    },
  });

  // Test, Question, Attempt, Result
  const test = await prisma.test.create({
    data: {
      title: `MATRIX-Test-A-${ts}`,
      type: 'MCQ',
      batchId: batch1.id,
      durationMinutes: 30,
      totalMarks: 50,
      testDate: new Date(),
      createdById: teacherA1.id,
    },
  });

  const question = await prisma.question.create({
    data: {
      testId: test.id,
      text: 'Matrix Question 1',
      marks: 10,
      order: 1,
      type: 'MCQ',
      options: {
        create: [
          { text: 'Option A', isCorrect: true },
          { text: 'Option B', isCorrect: false },
        ],
      },
    },
  });

  const attempt = await prisma.testAttempt.create({
    data: {
      testId: test.id,
      studentId: studentA1.id,
      status: 'SUBMITTED',
      seed: 'matrix-seed-123',
      deadlineAt: new Date(Date.now() + 3600000),
      submittedAt: new Date(),
    },
  });

  const result = await prisma.result.create({
    data: {
      testId: test.id,
      studentId: studentA1.id,
      attemptId: attempt.id,
      totalMarksObtained: 10,
      submittedAt: new Date(),
    },
  });

  // Fee charge & payment
  const charge = await prisma.feeCharge.create({
    data: {
      branchId: branchA.id,
      studentId: studentA1.id,
      batchId: batch1.id,
      amount: 100,
      dueDate: new Date(),
      description: `MATRIX-Charge-A-${ts}`,
      kind: 'TUITION',
      status: 'ACTIVE',
      source: 'MANUAL',
      createdById: adminA.id,
    },
  });

  const payment = await prisma.payment.create({
    data: {
      studentId: studentA1.id,
      amount: 100,
      method: 'CASH',
      receiptNumber: `MATRIX-RCP-${ts}`,
      note: `MATRIX-Payment-A-${ts}`,
      receivedById: adminA.id,
      receivedAt: new Date(),
      source: 'MANUAL',
      branchId: branchA.id,
      allocations: {
        create: {
          chargeId: charge.id,
          amount: 100,
          branchId: branchA.id,
        },
      },
    },
  });

  // Enquiry & EnquiryNote
  const enquiry = await prisma.contactMessage.create({
    data: {
      name: `MATRIX-Enquiry-A-${ts}`,
      email: `matrix.enquiry.${ts}@test.local`,
      phone: '01711999888',
      branchId: branchA.id,
      status: 'NEW',
    },
  });

  const enquiryNote = await prisma.enquiryNote.create({
    data: {
      enquiryId: enquiry.id,
      authorId: adminA.id,
      body: 'Matrix enquiry follow-up note',
    },
  });

  // Report Period & Remark
  const reportPeriod = await prisma.reportPeriod.create({
    data: {
      batchId: batch1.id,
      label: `MATRIX-Period-A-${ts}`,
      from: new Date('2026-01-01'),
      to: new Date('2026-06-30'),
      createdById: adminA.id,
    },
  });

  const reportRemark = await prisma.reportRemark.create({
    data: {
      periodId: reportPeriod.id,
      studentId: studentA1.id,
      remark: 'Matrix student remark',
      updatedById: teacherA1.id,
    },
  });

  // Notice
  const notice = await prisma.notice.create({
    data: {
      title: `MATRIX-Notice-A-${ts}`,
      content: 'Matrix notice content for Branch A',
      branchId: branchA.id,
      batchId: batch1.id,
      createdById: adminA.id,
    },
  });

  // Link Attachment
  const attachment = await prisma.attachment.create({
    data: {
      title: `MATRIX-Attachment-A-${ts}`,
      branchId: branchA.id,
      lectureId: pubLecture.id,
      kind: 'LINK',
      url: 'https://example.com/matrix-link',
      uploadedById: teacherA1.id,
    },
  });

  // Notification
  const notification = await prisma.notification.create({
    data: {
      userId: studentA1.id,
      type: 'ANNOUNCEMENT',
      title: `MATRIX-Notification-A-${ts}`,
      body: 'Matrix notification text',
    },
  });

  // Routine slot in Batch 1
  const routineSlot = await prisma.routineSlot.create({
    data: {
      batchId: batch1.id,
      dayOfWeek: 'MONDAY',
      startTime: '10:00',
      endTime: '11:00',
    },
  });

  // Resource in Batch 1
  const resource = await prisma.resource.create({
    data: {
      title: `MATRIX-Resource-A-${ts}`,
      fileUrl: 'https://example.com/matrix-res.pdf',
      fileType: 'PDF',
      batch: { connect: { id: batch1.id } },
      uploadedBy: { connect: { id: teacherA1.id } },
    },
  });

  // Fee Adjustment in Batch 1
  const adjustment = await prisma.feeAdjustment.create({
    data: {
      chargeId: charge.id,
      branchId: branchA.id,
      type: 'DISCOUNT',
      amount: 10,
      reason: `MATRIX-Adjustment-A-${ts}`,
      createdById: adminA.id,
    },
  });

  // Written Question and Student Answer
  const writtenQuestion = await prisma.question.create({
    data: {
      testId: test.id,
      text: 'Matrix Written Question 1',
      marks: 10,
      order: 2,
      type: 'WRITTEN',
    },
  });

  const studentAnswer = await prisma.studentAnswer.create({
    data: {
      student: { connect: { id: studentA1.id } },
      question: { connect: { id: writtenQuestion.id } },
      writtenAnswerText: 'Matrix written answer text',
    },
  });

  // Practice session for Student A1
  const practiceSession = await prisma.practiceSession.create({
    data: {
      studentId: studentA1.id,
      batchId: batch1.id,
      chapterIds: [],
      questionIds: [question.id],
      totalQuestions: 1,
    },
  });

  // Review in Batch 1 by Student A1
  const review = await prisma.review.create({
    data: {
      batchId: batch1.id,
      studentId: studentA1.id,
      rating: 5,
      comment: 'Matrix batch review',
    },
  });

  const fixturesA: FixturesA = {
    branchId: branchA.id,
    branchName: branchA.name,
    subjectId: subjectA.id,
    batch1Id: batch1.id,
    batch1Name: batch1.name,
    batch2Id: batch2.id,
    batch2Name: batch2.name,
    student1Id: studentA1.id,
    student1Email: studentA1.email,
    student2Id: studentA2.id,
    guardian1Id: guardianA1.id,
    guardian2Id: guardianA2.id,
    teacher1Id: teacherA1.id,
    teacher2Id: teacherA2.id,
    accountantId: accountantA.id,
    adminId: adminA.id,
    enrollment1Id: enrollment1.id,
    pubLectureId: pubLecture.id,
    pubLectureTitle: pubLecture.title,
    draftLectureId: draftLecture.id,
    assignmentId: assignment.id,
    assignmentTitle: assignment.title,
    submissionId: submission.id,
    testId: test.id,
    testTitle: test.title,
    questionId: question.id,
    attemptId: attempt.id,
    resultId: result.id,
    chargeId: charge.id,
    paymentId: payment.id,
    enquiryId: enquiry.id,
    enquiryNoteId: enquiryNote.id,
    reportPeriodId: reportPeriod.id,
    reportRemarkId: reportRemark.id,
    noticeId: notice.id,
    noticeTitle: notice.title,
    attachmentId: attachment.id,
    notificationId: notification.id,
    routineSlotId: routineSlot.id,
    resourceId: resource.id,
    adjustmentId: adjustment.id,
    writtenQuestionId: writtenQuestion.id,
    studentAnswerId: studentAnswer.id,
    practiceSessionId: practiceSession.id,
    guardianLinkId: guardianLink1.id,
    reviewId: review.id,
  };

  const fixturesB: FixturesB = {
    branchId: branchB.id,
    branchName: branchB.name,
    adminId: adminB.id,
    teacherId: teacherB.id,
    accountantId: accountantB.id,
    studentId: studentB.id,
    guardianId: guardianB.id,
  };

  const tokens: Tokens = {
    ADMIN_B: makeToken(adminB),
    TEACHER_B: makeToken(teacherB),
    ACCOUNTANT_B: makeToken(accountantB),
    STUDENT_B: makeToken(studentB),
    GUARDIAN_B: makeToken(guardianB),
    STUDENT_A1: makeToken(studentA1),
    STUDENT_A2: makeToken(studentA2),
    GUARDIAN_A2: makeToken(guardianA2),
    TEACHER_A2: makeToken(teacherA2),
  };

  return { fixturesA, fixturesB, tokens };
}

async function computeFixturesChecksum(f: FixturesA): Promise<string> {
  const hash = crypto.createHash('sha256');

  // Pull all Branch A fixtures
  const users = await prisma.user.findMany({ where: { branchId: f.branchId }, orderBy: { id: 'asc' } });
  const batches = await prisma.batch.findMany({ where: { branchId: f.branchId }, orderBy: { id: 'asc' } });
  const enrollments = await prisma.enrollment.findMany({ where: { batch: { branchId: f.branchId } }, orderBy: { id: 'asc' } });
  const charges = await prisma.feeCharge.findMany({ where: { batch: { branchId: f.branchId } }, orderBy: { id: 'asc' } });
  const payments = await prisma.payment.findMany({ where: { branchId: f.branchId }, orderBy: { id: 'asc' } });
  const lectures = await prisma.lecture.findMany({ where: { batch: { branchId: f.branchId } }, orderBy: { id: 'asc' } });
  const assignments = await prisma.assignment.findMany({ where: { batch: { branchId: f.branchId } }, orderBy: { id: 'asc' } });
  const submissions = await prisma.assignmentSubmission.findMany({ where: { assignment: { batch: { branchId: f.branchId } } }, orderBy: { id: 'asc' } });
  const tests = await prisma.test.findMany({ where: { batch: { branchId: f.branchId } }, orderBy: { id: 'asc' } });
  const notices = await prisma.notice.findMany({ where: { branchId: f.branchId }, orderBy: { id: 'asc' } });
  const attachments = await prisma.attachment.findMany({ where: { branchId: f.branchId }, orderBy: { id: 'asc' } });
  const enquiries = await prisma.contactMessage.findMany({ where: { branchId: f.branchId }, orderBy: { id: 'asc' } });
  const routineSlots = await prisma.routineSlot.findMany({ where: { batch: { branchId: f.branchId } }, orderBy: { id: 'asc' } });
  const resources = await prisma.resource.findMany({ where: { batch: { branchId: f.branchId } }, orderBy: { id: 'asc' } });
  const adjustments = await prisma.feeAdjustment.findMany({ where: { branchId: f.branchId }, orderBy: { id: 'asc' } });
  const practiceSessions = await prisma.practiceSession.findMany({ where: { batch: { branchId: f.branchId } }, orderBy: { id: 'asc' } });

  hash.update(JSON.stringify({
    users: users.map(u => ({ id: u.id, role: u.role, branchId: u.branchId, isActive: u.isActive })),
    batches: batches.map(b => ({ id: b.id, name: b.name, teacherId: b.teacherId, feeAmount: String(b.feeAmount) })),
    enrollments: enrollments.map(e => ({ id: e.id, status: e.status })),
    charges: charges.map(c => ({ id: c.id, status: c.status, amount: String(c.amount) })),
    payments: payments.map(p => ({ id: p.id, amount: String(p.amount) })),
    lectures: lectures.map(l => ({ id: l.id, status: l.status, title: l.title })),
    assignments: assignments.map(a => ({ id: a.id, title: a.title, maxMarks: String(a.maxMarks) })),
    submissions: submissions.map(s => ({ id: s.id, status: s.status })),
    tests: tests.map(t => ({ id: t.id, title: t.title })),
    notices: notices.map(n => ({ id: n.id, title: n.title })),
    attachments: attachments.map(at => ({ id: at.id, title: at.title })),
    enquiries: enquiries.map(eq => ({ id: eq.id, name: eq.name, status: eq.status })),
    routineSlots: routineSlots.map(rs => ({ id: rs.id, dayOfWeek: rs.dayOfWeek, startTime: rs.startTime })),
    resources: resources.map(res => ({ id: res.id, title: res.title })),
    adjustments: adjustments.map(adj => ({ id: adj.id, amount: String(adj.amount), status: adj.status })),
    practiceSessions: practiceSessions.map(ps => ({ id: ps.id, totalQuestions: ps.totalQuestions })),
  }));

  return hash.digest('hex');
}

export async function runBranchIsolationTests(): Promise<{
  routesCovered: number;
  totalCallsMade: number;
  leaks: Leak[];
}> {
  console.log('='.repeat(88));
  console.log('            CROSS-BRANCH & ROLE ISOLATION SECURITY MATRIX SUITE                 ');
  console.log('='.repeat(88));

  const leaks: Leak[] = [];
  let routesCovered = 0;
  let totalCallsMade = 0;

  let fixturesA: FixturesA;
  let fixturesB: FixturesB;
  let tokens: Tokens;

  try {
    const { default: app } = await import('../src/index');
    for (let i = 0; i < 20; i++) {
      try {
        const res = await fetch(`${BASE_URL}/api/health`);
        if (res.ok) break;
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }

    console.log('Creating isolated MATRIX- fixtures for Branch A and Branch B...');
    const setup = await setupIsolationFixtures();
    fixturesA = setup.fixturesA;
    fixturesB = setup.fixturesB;
    tokens = setup.tokens;

    console.log('Recording pre-test SHA-256 fixture state checksum for Branch A...');
    const preChecksum = await computeFixturesChecksum(fixturesA);
    console.log(`Pre-test checksum: ${preChecksum}\n`);

    // Target probes mapping
    // 1. ID-bearing endpoints
    const idEndpoints: Array<{
      method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
      path: (f: FixturesA) => string;
      body?: (f: FixturesA) => any;
      description: string;
      principals: Array<keyof Tokens>;
    }> = [
      // Batches
      {
        method: 'GET',
        path: (f) => `/api/batches/${f.batch1Id}`,
        description: 'Batch details',
        principals: ['ADMIN_B', 'TEACHER_B', 'ACCOUNTANT_B', 'STUDENT_B', 'GUARDIAN_B', 'GUARDIAN_A2', 'TEACHER_A2'],
      },
      {
        method: 'GET',
        path: (f) => `/api/batches/${f.batch2Id}`,
        description: 'Batch details (student not enrolled)',
        principals: ['STUDENT_A1'],
      },
      {
        method: 'GET',
        path: (f) => `/api/batches/${f.batch1Id}/students`,
        description: 'Batch roster',
        principals: ['ADMIN_B', 'TEACHER_B', 'ACCOUNTANT_B', 'STUDENT_B', 'GUARDIAN_B', 'TEACHER_A2'],
      },
      {
        method: 'GET',
        path: (f) => `/api/batches/${f.batch1Id}/attendance`,
        description: 'Batch attendance by date',
        principals: ['ADMIN_B', 'TEACHER_B', 'ACCOUNTANT_B', 'STUDENT_B', 'GUARDIAN_B', 'TEACHER_A2'],
      },
      {
        method: 'GET',
        path: (f) => `/api/batches/${f.batch1Id}/attendance/sheet?month=2026-11`,
        description: 'Batch attendance monthly sheet',
        principals: ['ADMIN_B', 'TEACHER_B', 'ACCOUNTANT_B', 'STUDENT_B', 'GUARDIAN_B', 'TEACHER_A2'],
      },
      {
        method: 'PATCH',
        path: (f) => `/api/batches/${f.batch1Id}`,
        body: () => ({ name: 'MATRIX-Mutated-Batch' }),
        description: 'Update batch',
        principals: ['ADMIN_B', 'TEACHER_B'],
      },
      {
        method: 'DELETE',
        path: (f) => `/api/batches/${f.batch1Id}`,
        description: 'Delete batch',
        principals: ['ADMIN_B'],
      },
      {
        method: 'PATCH',
        path: (f) => `/api/batches/${f.batch1Id}/fee`,
        body: () => ({ feeAmount: 999 }),
        description: 'Update batch fee',
        principals: ['ADMIN_B'],
      },

      // Students & Enrollments
      {
        method: 'GET',
        path: (f) => `/api/students/${f.student1Id}`,
        description: 'Student details',
        principals: ['ADMIN_B', 'TEACHER_B', 'ACCOUNTANT_B', 'STUDENT_B', 'GUARDIAN_B', 'GUARDIAN_A2'],
      },
      {
        method: 'GET',
        path: (f) => `/api/students/${f.student1Id}/batches`,
        description: 'Student enrolled batches',
        principals: ['ADMIN_B', 'TEACHER_B', 'ACCOUNTANT_B', 'STUDENT_B', 'GUARDIAN_B', 'GUARDIAN_A2'],
      },
      {
        method: 'GET',
        path: (f) => `/api/students/${f.student1Id}/attendance`,
        description: 'Student attendance history',
        principals: ['ADMIN_B', 'TEACHER_B', 'ACCOUNTANT_B', 'STUDENT_B', 'GUARDIAN_B', 'GUARDIAN_A2'],
      },
      {
        method: 'PATCH',
        path: (f) => `/api/enrollments/${f.enrollment1Id}/unenroll`,
        body: () => ({}),
        description: 'Unenroll student',
        principals: ['ADMIN_B'],
      },
      {
        method: 'PATCH',
        path: (f) => `/api/enrollments/${f.enrollment1Id}/fee`,
        body: () => ({ customFeeAmount: 450 }),
        description: 'Set student enrollment fee override',
        principals: ['ADMIN_B'],
      },
      {
        method: 'GET',
        path: (f) => `/api/enrollments/${f.enrollment1Id}/net-fee`,
        description: 'Get student net fee',
        principals: ['ADMIN_B'],
      },

      // Lectures
      {
        method: 'GET',
        path: (f) => `/api/lectures/${f.pubLectureId}`,
        description: 'Get published lecture',
        principals: ['ADMIN_B', 'TEACHER_B', 'STUDENT_B', 'GUARDIAN_B'],
      },
      {
        method: 'GET',
        path: (f) => `/api/lectures/${f.draftLectureId}`,
        description: 'Get draft lecture',
        principals: ['ADMIN_B', 'TEACHER_B', 'STUDENT_A1'],
      },
      {
        method: 'PATCH',
        path: (f) => `/api/lectures/${f.pubLectureId}`,
        body: () => ({ title: 'MATRIX-Mutated-Lecture' }),
        description: 'Update lecture',
        principals: ['ADMIN_B', 'TEACHER_B'],
      },
      {
        method: 'DELETE',
        path: (f) => `/api/lectures/${f.pubLectureId}`,
        description: 'Delete lecture',
        principals: ['ADMIN_B', 'TEACHER_B'],
      },

      // Assignments
      {
        method: 'GET',
        path: (f) => `/api/assignments/${f.assignmentId}`,
        description: 'Get assignment details',
        principals: ['ADMIN_B', 'TEACHER_B', 'STUDENT_B'],
      },
      {
        method: 'GET',
        path: (f) => `/api/assignments/${f.assignmentId}/submissions`,
        description: 'Get assignment submissions',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },
      {
        method: 'GET',
        path: (f) => `/api/submissions/${f.submissionId}`,
        description: 'Get single submission',
        principals: ['ADMIN_B', 'TEACHER_B', 'STUDENT_B', 'TEACHER_A2'],
      },

      // Tests
      {
        method: 'GET',
        path: (f) => `/api/tests/${f.testId}`,
        description: 'Get test details',
        principals: ['ADMIN_B', 'TEACHER_B', 'STUDENT_B'],
      },
      {
        method: 'GET',
        path: (f) => `/api/tests/${f.testId}/results`,
        description: 'Get test results roster',
        principals: ['ADMIN_B', 'TEACHER_B', 'STUDENT_B', 'TEACHER_A2'],
      },
      {
        method: 'GET',
        path: (f) => `/api/tests/${f.testId}/attempts`,
        description: 'Get test attempts',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },

      // Fees
      {
        method: 'GET',
        path: (f) => `/api/fees/students/${f.student1Id}/account`,
        description: 'Student fee account',
        principals: ['ADMIN_B', 'TEACHER_B', 'ACCOUNTANT_B', 'STUDENT_B', 'GUARDIAN_B', 'GUARDIAN_A2'],
      },
      {
        method: 'GET',
        path: (f) => `/api/fees/guardian/students/${f.student1Id}/account`,
        description: 'Guardian student fee account',
        principals: ['GUARDIAN_B', 'GUARDIAN_A2'],
      },
      {
        method: 'POST',
        path: (f) => `/api/fees/payments/${f.paymentId}/reverse`,
        body: () => ({ reason: 'MATRIX-Probe-Reverse' }),
        description: 'Reverse payment',
        principals: ['ADMIN_B'],
      },

      // Enquiries
      {
        method: 'GET',
        path: (f) => `/api/enquiries/${f.enquiryId}`,
        description: 'Get enquiry details with notes',
        principals: ['ADMIN_B', 'TEACHER_B', 'ACCOUNTANT_B'],
      },

      // Report Periods
      {
        method: 'GET',
        path: (f) => `/api/report-periods/${f.reportPeriodId}/cards`,
        description: 'Report period cards',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },

      // Notices
      {
        method: 'GET',
        path: (f) => `/api/notices/${f.noticeId}`,
        description: 'Get notice',
        principals: ['ADMIN_B', 'TEACHER_B', 'STUDENT_B'],
      },

      // Additional Cross-Branch & Isolation Probes for Reachable ID Routes:
      // 1. Batches & Branches
      {
        method: 'GET',
        path: (f) => `/api/branches/${f.branchId}`,
        description: 'Branch details by ID',
        principals: ['ADMIN_B', 'TEACHER_B'],
      },
      {
        method: 'GET',
        path: (f) => `/api/batches/${f.batch1Id}/student-view`,
        description: 'Batch student view (foreign/non-enrolled student)',
        principals: ['STUDENT_B', 'STUDENT_A2'],
      },
      {
        method: 'POST',
        path: (f) => `/api/batches/${f.batch1Id}/restore`,
        description: 'Restore foreign branch batch',
        principals: ['ADMIN_B'],
      },
      {
        method: 'GET',
        path: (f) => `/api/batches/${f.batch1Id}/analytics`,
        description: 'Batch analytics (foreign branch or unassigned teacher)',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },
      {
        method: 'GET',
        path: (f) => `/api/batches/${f.batch1Id}/students/${f.student1Id}/trend`,
        description: 'Student trend in batch',
        principals: ['ADMIN_B', 'TEACHER_B', 'STUDENT_B', 'STUDENT_A2', 'TEACHER_A2'],
      },
      {
        method: 'POST',
        path: (f) => `/api/batches/${f.batch1Id}/reviews`,
        body: () => ({ rating: 5, comment: 'Matrix review probe' }),
        description: 'Batch review by non-enrolled or foreign student',
        principals: ['STUDENT_B', 'STUDENT_A2'],
      },
      {
        method: 'GET',
        path: (f) => `/api/batches/${f.batch1Id}/routine`,
        description: 'Get batch routine',
        principals: ['ADMIN_B', 'TEACHER_B', 'STUDENT_B', 'STUDENT_A2'],
      },
      {
        method: 'GET',
        path: (f) => `/api/batches/${f.batch1Id}/report-periods`,
        description: 'Get batch report periods',
        principals: ['ADMIN_B', 'TEACHER_B', 'STUDENT_B', 'STUDENT_A2'],
      },

      // 2. Enrollments & Routine Slots
      {
        method: 'POST',
        path: () => '/api/enrollments',
        body: (f) => ({ batchId: f.batch1Id, studentId: f.student1Id }),
        description: 'Enroll student into foreign batch',
        principals: ['ADMIN_B'],
      },
      {
        method: 'PATCH',
        path: (f) => `/api/enrollments/${f.enrollment1Id}/restore`,
        description: 'Restore foreign branch enrollment',
        principals: ['ADMIN_B'],
      },
      {
        method: 'POST',
        path: () => '/api/routines',
        body: (f) => ({ batchId: f.batch1Id, dayOfWeek: 'TUESDAY', startTime: '11:00', endTime: '12:00' }),
        description: 'Create routine slot in foreign batch',
        principals: ['ADMIN_B'],
      },
      {
        method: 'DELETE',
        path: (f) => `/api/routines/${f.routineSlotId}`,
        description: 'Delete routine slot of foreign branch',
        principals: ['ADMIN_B'],
      },

      // 3. Attendance
      {
        method: 'POST',
        path: () => '/api/attendance',
        body: (f) => ({ batchId: f.batch1Id, date: '2026-11-11', records: [] }),
        description: 'Mark attendance for foreign/unassigned batch',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },

      // 4. Users & Students
      {
        method: 'POST',
        path: (f) => `/api/users/${f.student1Id}/reset-password`,
        description: 'Reset password of foreign branch user',
        principals: ['ADMIN_B'],
      },
      {
        method: 'PATCH',
        path: (f) => `/api/users/${f.student1Id}/status`,
        body: () => ({ isActive: false }),
        description: 'Update status of foreign branch user',
        principals: ['ADMIN_B'],
      },
      {
        method: 'POST',
        path: () => '/api/users/import',
        body: (f) => ({ rows: [{ name: 'Probe Import User', role: 'STUDENT', branchId: f.branchId }] }),
        description: 'Import users targeting foreign branch',
        principals: ['ADMIN_B'],
      },
      {
        method: 'GET',
        path: (f) => `/api/students/${f.student1Id}/guardian-log`,
        description: 'Get guardian change log of foreign student',
        principals: ['ADMIN_B'],
      },

      // 5. Tests, Questions & Submissions
      {
        method: 'GET',
        path: (f) => `/api/batches/${f.batch1Id}/tests`,
        description: 'Get tests for batch',
        principals: ['ADMIN_B', 'TEACHER_B', 'STUDENT_B', 'STUDENT_A2'],
      },
      {
        method: 'POST',
        path: (f) => `/api/tests/${f.testId}/restore`,
        description: 'Restore foreign branch test',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },
      {
        method: 'POST',
        path: (f) => `/api/tests/${f.testId}/start`,
        description: 'Start test attempt (foreign/non-enrolled student)',
        principals: ['STUDENT_B', 'STUDENT_A2'],
      },
      {
        method: 'GET',
        path: (f) => `/api/tests/${f.testId}/attempt`,
        description: 'Get student attempt for foreign test',
        principals: ['STUDENT_B', 'STUDENT_A2'],
      },
      {
        method: 'PUT',
        path: (f) => `/api/tests/${f.testId}/attempt/answers`,
        body: () => ({ answers: [] }),
        description: 'Save answers for foreign test attempt',
        principals: ['STUDENT_B', 'STUDENT_A2'],
      },
      {
        method: 'POST',
        path: (f) => `/api/tests/${f.testId}/attempts/${f.attemptId}/extend`,
        body: () => ({ minutes: 10, reason: 'Probe extension' }),
        description: 'Extend test attempt',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },
      {
        method: 'POST',
        path: (f) => `/api/tests/${f.testId}/finalize`,
        description: 'Finalize test attempts',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },
      {
        method: 'POST',
        path: (f) => `/api/tests/${f.testId}/questions`,
        body: () => ({ text: 'Probe Question', type: 'MCQ', marks: 5, order: 9, options: [{ text: 'A', isCorrect: true }] }),
        description: 'Add question to foreign test',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },
      {
        method: 'POST',
        path: (f) => `/api/tests/${f.testId}/questions/bulk`,
        body: () => ({ questions: [{ text: 'Probe Q Bulk', type: 'MCQ', marks: 5, order: 10, options: [{ text: 'A', isCorrect: true }] }] }),
        description: 'Add questions bulk to foreign test',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },
      {
        method: 'PATCH',
        path: (f) => `/api/questions/${f.questionId}`,
        body: () => ({ text: 'Mutated Question Text' }),
        description: 'Update question in foreign test',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },
      {
        method: 'DELETE',
        path: (f) => `/api/questions/${f.questionId}`,
        description: 'Delete question in foreign test',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },
      {
        method: 'POST',
        path: (f) => `/api/tests/${f.testId}/submit`,
        body: () => ({ answers: [] }),
        description: 'Submit foreign/non-enrolled test',
        principals: ['STUDENT_B', 'STUDENT_A2'],
      },
      {
        method: 'PATCH',
        path: (f) => `/api/answers/${f.studentAnswerId}/grade`,
        body: () => ({ marksAwarded: 5 }),
        description: 'Grade student written answer',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },
      {
        method: 'POST',
        path: (f) => `/api/tests/${f.testId}/manual-results`,
        body: (f) => ({ results: [{ studentId: f.student1Id, marksObtained: 8 }] }),
        description: 'Save manual test results',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },
      {
        method: 'GET',
        path: (f) => `/api/tests/${f.testId}/my-result`,
        description: 'Get my result for test',
        principals: ['STUDENT_B', 'STUDENT_A2'],
      },

      // 6. Fees
      {
        method: 'POST',
        path: () => '/api/fees/payments',
        body: (f) => ({ studentId: f.student1Id, batchId: f.batch1Id, amountPaid: 50, method: 'CASH', dueDate: '2026-12-01', period: '2026-11' }),
        description: 'Record fee payment for foreign student',
        principals: ['ADMIN_B', 'ACCOUNTANT_B'],
      },
      {
        method: 'GET',
        path: (f) => `/api/fees/receipts/${f.paymentId}`,
        description: 'Get fee receipt',
        principals: ['ADMIN_B', 'ACCOUNTANT_B', 'STUDENT_B', 'GUARDIAN_B', 'GUARDIAN_A2'],
      },
      {
        method: 'POST',
        path: (f) => `/api/fees/charges/${f.chargeId}/void`,
        body: () => ({ reason: 'Probe void charge' }),
        description: 'Void fee charge of foreign branch',
        principals: ['ADMIN_B'],
      },
      {
        method: 'POST',
        path: () => '/api/fees/charges/generate',
        body: (f) => ({ batchId: f.batch1Id, month: '2026-11' }),
        description: 'Generate dues for foreign batch',
        principals: ['ADMIN_B', 'ACCOUNTANT_B'],
      },
      {
        method: 'POST',
        path: (f) => `/api/fees/adjustments/${f.adjustmentId}/void`,
        body: () => ({ reason: 'Probe void adjustment' }),
        description: 'Void fee adjustment of foreign branch',
        principals: ['ADMIN_B'],
      },

      // 7. Resources & Guardians
      {
        method: 'GET',
        path: (f) => `/api/batches/${f.batch1Id}/resources`,
        description: 'Get batch resources',
        principals: ['ADMIN_B', 'TEACHER_B', 'STUDENT_B', 'STUDENT_A2'],
      },
      {
        method: 'DELETE',
        path: (f) => `/api/resources/${f.resourceId}`,
        description: 'Delete resource of foreign branch',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },
      {
        method: 'DELETE',
        path: (f) => `/api/guardians/link/${f.guardianLinkId}`,
        description: 'Unlink guardian of foreign branch',
        principals: ['ADMIN_B'],
      },
      {
        method: 'GET',
        path: (f) => `/api/guardians/students/${f.student1Id}/attendance`,
        description: 'Guardian view student attendance',
        principals: ['GUARDIAN_B', 'GUARDIAN_A2'],
      },
      {
        method: 'GET',
        path: (f) => `/api/guardians/students/${f.student1Id}/results`,
        description: 'Guardian view student results',
        principals: ['GUARDIAN_B', 'GUARDIAN_A2'],
      },
      {
        method: 'GET',
        path: (f) => `/api/guardians/students/${f.student1Id}/payments`,
        description: 'Guardian view student payments',
        principals: ['GUARDIAN_B', 'GUARDIAN_A2'],
      },

      // 8. Practice Sessions
      {
        method: 'POST',
        path: (f) => `/api/students/${f.student1Id}/practice-sessions`,
        body: (f) => ({ batchId: f.batch1Id, chapterIds: [] }),
        description: 'Create practice session for another student',
        principals: ['STUDENT_B', 'STUDENT_A2'],
      },
      {
        method: 'GET',
        path: (f) => `/api/students/${f.student1Id}/practice-sessions/${f.practiceSessionId}`,
        description: 'Get practice session of another student',
        principals: ['STUDENT_B', 'STUDENT_A2'],
      },
      {
        method: 'POST',
        path: (f) => `/api/students/${f.student1Id}/practice-sessions/${f.practiceSessionId}/submit`,
        body: () => ({ answers: [] }),
        description: 'Submit practice session of another student',
        principals: ['STUDENT_B', 'STUDENT_A2'],
      },

      // 9. Assignments & Enquiries
      {
        method: 'POST',
        path: () => '/api/assignments',
        body: (f) => ({ batchId: f.batch1Id, subjectId: f.subjectId, title: 'Probe Assignment', dueAt: new Date(Date.now() + 86400000).toISOString(), maxMarks: 50, mode: 'ONLINE' }),
        description: 'Create assignment in foreign batch',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },
      {
        method: 'POST',
        path: (f) => `/api/enquiries/${f.enquiryId}/notes`,
        body: () => ({ kind: 'CALL', body: 'Probe note' }),
        description: 'Add note to foreign enquiry',
        principals: ['ADMIN_B'],
      },
      {
        method: 'POST',
        path: (f) => `/api/enquiries/${f.enquiryId}/convert`,
        body: (f) => ({ name: 'Probe Converted', phone: '01712999777', batchId: f.batch1Id }),
        description: 'Convert foreign enquiry',
        principals: ['ADMIN_B'],
      },

      // 10. Report Periods & Remarks
      {
        method: 'POST',
        path: () => '/api/report-periods',
        body: (f) => ({ batchId: f.batch1Id, label: 'Probe Period', from: '2026-01-01', to: '2026-06-30' }),
        description: 'Create report period in foreign batch',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },
      {
        method: 'PATCH',
        path: (f) => `/api/report-periods/${f.reportPeriodId}`,
        body: () => ({ label: 'Mutated Label' }),
        description: 'Update report period',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },
      {
        method: 'POST',
        path: (f) => `/api/report-periods/${f.reportPeriodId}/publish`,
        description: 'Publish foreign report period',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },
      {
        method: 'POST',
        path: (f) => `/api/report-periods/${f.reportPeriodId}/unpublish`,
        description: 'Unpublish foreign report period',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },
      {
        method: 'PUT',
        path: (f) => `/api/report-periods/${f.reportPeriodId}/remarks/${f.student1Id}`,
        body: () => ({ remark: 'Probe remark' }),
        description: 'Update report remark for foreign student',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },
      {
        method: 'GET',
        path: (f) => `/api/report-periods/${f.reportPeriodId}/cards/${f.student1Id}`,
        description: 'Get foreign student report card',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },
      {
        method: 'GET',
        path: (f) => `/api/exports/batch-results?batchId=${f.batch1Id}&periodId=${f.reportPeriodId}`,
        description: 'Export batch results of foreign batch',
        principals: ['ADMIN_B'],
      },

      // 11. Complete remaining reachable non-super-admin ID routes
      {
        method: 'PATCH',
        path: (f) => `/api/reviews/${f.reviewId}`,
        body: () => ({ rating: 1, comment: 'Mutated review' }),
        description: 'Update review owned by another student',
        principals: ['STUDENT_B', 'STUDENT_A2'],
      },
      {
        method: 'DELETE',
        path: (f) => `/api/reviews/${f.reviewId}`,
        description: 'Delete review owned by another student',
        principals: ['STUDENT_B', 'STUDENT_A2'],
      },
      {
        method: 'PATCH',
        path: (f) => `/api/students/${f.student1Id}`,
        body: () => ({ name: 'MATRIX-Mutated-Student' }),
        description: 'Update student in foreign branch',
        principals: ['ADMIN_B'],
      },
      {
        method: 'PATCH',
        path: (f) => `/api/tests/${f.testId}`,
        body: () => ({ title: 'MATRIX-Mutated-Test' }),
        description: 'Update test of foreign/unassigned batch',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },
      {
        method: 'DELETE',
        path: (f) => `/api/tests/${f.testId}`,
        description: 'Delete test of foreign/unassigned batch',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },
      {
        method: 'POST',
        path: () => '/api/notices',
        body: (f) => ({ title: 'MATRIX-Probe-Notice', content: 'Probe content', batchId: f.batch1Id }),
        description: 'Create notice targeting foreign/unassigned batch',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },
      {
        method: 'DELETE',
        path: (f) => `/api/notices/${f.noticeId}`,
        description: 'Delete notice of foreign branch',
        principals: ['ADMIN_B'],
      },
      {
        method: 'POST',
        path: (f) => `/api/lectures/${f.pubLectureId}/complete`,
        body: () => ({}),
        description: 'Complete lecture of foreign/unassigned batch',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },
      {
        method: 'POST',
        path: (f) => `/api/lectures/${f.pubLectureId}/cancel`,
        body: () => ({ reason: 'Probe cancel' }),
        description: 'Cancel lecture of foreign/unassigned batch',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },
      {
        method: 'POST',
        path: (f) => `/api/batches/${f.batch1Id}/lectures/generate`,
        body: () => ({ fromDate: '2026-11-10', toDate: '2026-11-17' }),
        description: 'Generate lectures for foreign/unassigned batch',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },
      {
        method: 'GET',
        path: (f) => `/api/batches/${f.batch1Id}/syllabus-progress`,
        description: 'Get syllabus progress of foreign/unassigned/unenrolled batch',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2', 'STUDENT_B', 'STUDENT_A2'],
      },
      {
        method: 'PATCH',
        path: (f) => `/api/assignments/${f.assignmentId}`,
        body: () => ({ title: 'MATRIX-Mutated-Assignment' }),
        description: 'Update assignment of foreign/unassigned batch',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },
      {
        method: 'DELETE',
        path: (f) => `/api/assignments/${f.assignmentId}`,
        description: 'Delete assignment of foreign/unassigned batch',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },
      {
        method: 'POST',
        path: (f) => `/api/assignments/${f.assignmentId}/submit`,
        body: () => ({ answerText: 'Probe answer' }),
        description: 'Submit assignment of foreign/unenrolled batch',
        principals: ['STUDENT_B', 'STUDENT_A2'],
      },
      {
        method: 'POST',
        path: (f) => `/api/assignments/${f.assignmentId}/marks`,
        body: (f) => ({ marks: [{ studentId: f.student1Id, marksObtained: 10 }] }),
        description: 'Enter offline marks for assignment of foreign/unassigned batch',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },
      {
        method: 'PATCH',
        path: (f) => `/api/submissions/${f.submissionId}/grade`,
        body: () => ({ marksObtained: 10 }),
        description: 'Grade assignment submission of foreign/unassigned batch',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },
      {
        method: 'POST',
        path: () => '/api/attachments',
        body: (f) => ({ lectureId: f.pubLectureId, kind: 'LINK', title: 'Probe Attachment', url: 'https://example.com' }),
        description: 'Create attachment on lecture of foreign/unassigned batch',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },
      {
        method: 'GET',
        path: (f) => `/api/attachments/${f.attachmentId}/download`,
        description: 'Download attachment of foreign/unassigned/unenrolled batch',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2', 'STUDENT_B', 'STUDENT_A2', 'GUARDIAN_B', 'GUARDIAN_A2'],
      },
      {
        method: 'DELETE',
        path: (f) => `/api/attachments/${f.attachmentId}`,
        description: 'Delete attachment of foreign/unassigned batch',
        principals: ['ADMIN_B', 'TEACHER_B', 'TEACHER_A2'],
      },
      {
        method: 'PATCH',
        path: (f) => `/api/enquiries/${f.enquiryId}`,
        body: () => ({ status: 'LOST', lostReason: 'Probe lost' }),
        description: 'Update enquiry of foreign branch',
        principals: ['ADMIN_B'],
      },
      {
        method: 'GET',
        path: (f) => `/api/my/report-cards/${f.reportPeriodId}`,
        description: 'Get report card by period for foreign/unenrolled/unlinked user',
        principals: ['STUDENT_B', 'STUDENT_A2', 'GUARDIAN_B', 'GUARDIAN_A2'],
      },

    ];

    // 2. List & Search Endpoints (should never leak Branch A fixture IDs to Branch B principals)
    const listEndpoints: Array<{
      path: string;
      principals: Array<keyof Tokens>;
    }> = [
      { path: '/api/batches', principals: ['ADMIN_B', 'TEACHER_B', 'ACCOUNTANT_B', 'STUDENT_B', 'GUARDIAN_B'] },
      { path: '/api/users', principals: ['ADMIN_B', 'TEACHER_B'] },
      { path: '/api/fees/dues', principals: ['ADMIN_B', 'ACCOUNTANT_B'] },
      { path: '/api/fees/students/search?q=MATRIX', principals: ['ADMIN_B', 'ACCOUNTANT_B'] },
      { path: '/api/enquiries', principals: ['ADMIN_B'] },
      { path: '/api/notices', principals: ['ADMIN_B', 'TEACHER_B', 'STUDENT_B', 'GUARDIAN_B'] },
      { path: '/api/attendance/low', principals: ['ADMIN_B', 'TEACHER_B'] },
    ];

    routesCovered = idEndpoints.length + listEndpoints.length;

    // Execute ID Endpoint Probes
    console.log(`Executing ${idEndpoints.length} ID-bearing route isolation checks...`);
    for (const ep of idEndpoints) {
      const targetPath = ep.path(fixturesA);

      for (const p of ep.principals) {
        totalCallsMade++;
        process.stdout.write('.');
        const token = tokens[p];
        let status = 0;
        let bodyText = '';

        try {
          const res = await fetch(`${BASE_URL}${targetPath}`, {
            method: ep.method,
            headers: {
              Cookie: `token=${token}`,
              'Content-Type': 'application/json',
            },
            body: ep.body ? JSON.stringify(ep.body(fixturesA)) : undefined,
            signal: AbortSignal.timeout(8000),
          });

          status = res.status;
          bodyText = await res.text();
        } catch (err: any) {
          status = -1;
          bodyText = err.message;
        }

        // Intra-branch or cross-branch access to foreign branch/unassigned batch/unlinked student
        // MUST return 403 or 404.
        const isForbiddenOrNotFound = status === 403 || status === 404;
        const isSuccessStatus = status === 200 || status === 201 || status === 204;

        // Check data leakage in body text
        const leaksSecret =
          bodyText.includes(fixturesA.student1Email) ||
          bodyText.includes('01711999888') ||
          bodyText.includes(fixturesA.batch1Name) ||
          bodyText.includes(fixturesA.assignmentTitle) ||
          bodyText.includes(fixturesA.testTitle) ||
          bodyText.includes('Matrix enquiry follow-up note');

        if (isSuccessStatus || (!isForbiddenOrNotFound && status !== 400 && status !== 401) || leaksSecret) {
          leaks.push({
            route: `${ep.method} ${targetPath}`,
            method: ep.method,
            principal: p,
            status,
            evidence: leaksSecret
              ? `Leaked sensitive Branch A fixture data in body: ${bodyText.slice(0, 100)}`
              : `Expected 403 or 404, received HTTP ${status}: ${bodyText.slice(0, 100)}`,
          });
        }
      }
    }

    // Execute List Endpoint Probes
    console.log(`Executing ${listEndpoints.length} List/Search route isolation checks...`);
    const branchAIds = [
      fixturesA.branchId,
      fixturesA.batch1Id,
      fixturesA.batch2Id,
      fixturesA.student1Id,
      fixturesA.student2Id,
      fixturesA.guardian1Id,
      fixturesA.teacher1Id,
      fixturesA.enquiryId,
      fixturesA.noticeId,
      fixturesA.assignmentId,
      fixturesA.testId,
    ];

    for (const lep of listEndpoints) {
      for (const p of lep.principals) {
        totalCallsMade++;
        process.stdout.write('.');
        const token = tokens[p];
        let bodyText = '';
        let status = 0;

        try {
          const res = await fetch(`${BASE_URL}${lep.path}`, {
            method: 'GET',
            headers: { Cookie: `token=${token}` },
            signal: AbortSignal.timeout(8000),
          });
          status = res.status;
          bodyText = await res.text();
        } catch (err: any) {
          status = -1;
          bodyText = err.message;
        }

        if (status === 200) {
          const leakedId = branchAIds.find(id => bodyText.includes(id));
          if (leakedId) {
            leaks.push({
              route: `GET ${lep.path}`,
              method: 'GET',
              principal: p,
              status,
              evidence: `Leaked Branch A fixture ID (${leakedId}) in list response: ${bodyText.slice(0, 120)}`,
            });
          }
        }
      }
    }

    // Verify Fixture Immutability Checksum
    console.log('Recording post-test SHA-256 fixture state checksum for Branch A...');
    const postChecksum = await computeFixturesChecksum(fixturesA);
    console.log(`Post-test checksum: ${postChecksum}`);

    if (preChecksum !== postChecksum) {
      leaks.push({
        route: 'DATABASE_MUTATION_CHECK',
        method: 'INTEGRITY',
        principal: 'ALL',
        status: 500,
        evidence: `Branch A fixtures modified during branch-isolation test run! Pre: ${preChecksum}, Post: ${postChecksum}`,
      });
    }
  } finally {
    console.log('\nCleaning up all MATRIX- fixtures in finally block...');
    await cleanAllMatrixFixtures();
    console.log('Cleanup complete.');
    await prisma.$disconnect();
  }

  // Print Report
  console.log('\n' + '='.repeat(88));
  console.log('                   BRANCH ISOLATION AUDIT RESULTS REPORT                         ');
  console.log('='.repeat(88));
  console.log(`Total Routes Covered: ${routesCovered}`);
  console.log(`Total Isolation Calls Made: ${totalCallsMade}`);
  console.log(`Total Leaks Detected: ${leaks.length}\n`);

  if (leaks.length > 0) {
    console.error('LEAKS DETECTED TABLE:');
    console.error('-'.repeat(88));
    console.error(
      `${'ROUTE'.padEnd(38)} | ${'PRINCIPAL'.padEnd(12)} | ${'STATUS'.padEnd(6)} | EVIDENCE`
    );
    console.error('-'.repeat(88));
    for (const l of leaks) {
      console.error(
        `${l.route.slice(0, 38).padEnd(38)} | ${l.principal.padEnd(12)} | ${String(l.status).padEnd(6)} | ${l.evidence.slice(0, 60)}`
      );
    }
    console.error('-'.repeat(88) + '\n');
  } else {
    console.log('✓ All cross-branch and intra-branch isolation checks PASSED with 0 leaks.');
  }

  return { routesCovered, totalCallsMade, leaks };
}

if (require.main === module) {
  runBranchIsolationTests()
    .then((res) => {
      if (res.leaks.length > 0) {
        process.exit(1);
      } else {
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Fatal error running branch-isolation:', err);
      process.exit(1);
    });
}
