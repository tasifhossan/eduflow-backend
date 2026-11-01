import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { getCenterSettings } from './settings.service';

export interface AttendanceReportSummary {
  present: number;
  absent: number;
  late: number;
  total: number;
  percent: string;
}

export interface ExamReportItem {
  testId: string;
  title: string;
  date: string;
  marks: string | null;
  maxMarks: string;
  percent: string | null;
  rank: number | null;
  pending: boolean;
}

export interface ExamReportSummary {
  tests: ExamReportItem[];
  totalMarksObtained: string;
  totalMaxMarks: string;
  overallPercent: string;
  grade: string | null;
  hasPendingWritten: boolean;
}

export interface AssignmentReportSummary {
  marks: string;
  maxMarks: string;
  percent: string;
  gradedCount: number;
}

export interface SyllabusReportSummary {
  coveredChapters: number;
  totalChapters: number;
  percent: string;
}

export interface StudentFullReportCard {
  period: {
    id: string;
    batchId: string;
    batchName: string;
    label: string;
    from: string;
    to: string;
    publishedAt: string | null;
  };
  student: {
    id: string;
    name: string;
    studentCode: string | null;
    avatarUrl: string | null;
    phone: string | null;
  };
  center: {
    name: string;
    logoUrl: string | null;
    receiptHeader: string | null;
    receiptFooter: string | null;
    branchName?: string;
  };
  attendance: AttendanceReportSummary;
  exams: ExamReportSummary;
  assignments: AssignmentReportSummary;
  syllabus: SyllabusReportSummary;
  remark: {
    text: string;
    updatedAt: string;
  } | null;
}

export interface StudentRosterCardSummary {
  student: {
    id: string;
    name: string;
    studentCode: string | null;
    avatarUrl: string | null;
  };
  attendance: AttendanceReportSummary;
  exam: {
    overallPercent: string;
    grade: string | null;
    hasPendingWritten: boolean;
  };
  remark: {
    text: string;
    updatedAt: string;
  } | null;
}

/**
 * Pure helper to compute attendance summary.
 */
export function computeAttendanceSummary(
  attendances: Array<{ status: 'PRESENT' | 'ABSENT' | 'LATE' }>
): AttendanceReportSummary {
  let present = 0;
  let absent = 0;
  let late = 0;

  for (const a of attendances) {
    if (a.status === 'PRESENT') present++;
    else if (a.status === 'ABSENT') absent++;
    else if (a.status === 'LATE') late++;
  }

  const total = present + absent + late;
  let percent = '0.00';
  if (total > 0) {
    percent = new Prisma.Decimal(present + late)
      .div(total)
      .times(100)
      .toFixed(2, Prisma.Decimal.ROUND_HALF_UP);
  }

  return { present, absent, late, total, percent };
}

/**
 * Pure helper to assign grade label based on grading scale.
 */
export function resolveGrade(
  percentStr: string,
  gradingScale?: Array<{ minPercent: number; label: string }> | null
): string | null {
  if (!gradingScale || !Array.isArray(gradingScale) || gradingScale.length === 0) {
    return null;
  }

  const percent = Number(percentStr);
  if (isNaN(percent)) return null;

  for (const range of gradingScale) {
    if (percent >= range.minPercent) {
      return range.label;
    }
  }

  return null;
}

/**
 * Computes report card data for a single student in a report period.
 */
export async function computeStudentReportCard(
  batchId: string,
  periodId: string,
  studentId: string
): Promise<StudentFullReportCard | null> {
  const period = await prisma.reportPeriod.findUnique({
    where: { id: periodId },
    include: {
      batch: {
        include: {
          branch: true,
          subject: {
            include: {
              chapters: true,
            },
          },
        },
      },
    },
  });

  if (!period || period.batchId !== batchId) {
    return null;
  }

  const fromDate = new Date(period.from);
  fromDate.setUTCHours(0, 0, 0, 0);
  const toDate = new Date(period.to);
  toDate.setUTCHours(23, 59, 59, 999);

  // Verify enrollment in batch during period
  const enrollment = await prisma.enrollment.findFirst({
    where: {
      batchId,
      studentId,
      enrolledAt: { lte: toDate },
    },
    include: {
      student: {
        select: {
          id: true,
          name: true,
          studentCode: true,
          avatarUrl: true,
          phone: true,
        },
      },
    },
  });

  if (!enrollment) {
    return null;
  }

  const student = enrollment.student;
  const settings = await getCenterSettings();
  const gradingScale = settings.gradingScale as Array<{ minPercent: number; label: string }> | null;

  // 1. Attendance in period
  const attendances = await prisma.attendance.findMany({
    where: {
      batchId,
      studentId,
      date: {
        gte: fromDate,
        lte: toDate,
      },
    },
    select: { status: true },
  });

  const attendanceSummary = computeAttendanceSummary(attendances);

  // 2. Exams in period (Closed tests only)
  const now = new Date();
  const tests = await prisma.test.findMany({
    where: {
      batchId,
      testDate: {
        gte: fromDate,
        lte: toDate,
      },
      archivedAt: null,
    },
    include: {
      questions: {
        select: {
          id: true,
          type: true,
          marks: true,
          studentAnswers: {
            where: { studentId },
            select: {
              marksAwarded: true,
            },
          },
        },
      },
      results: {
        select: {
          studentId: true,
          totalMarksObtained: true,
        },
      },
    },
    orderBy: { testDate: 'asc' },
  });

  // Filter only tests closed for everyone
  const closedTests = tests.filter((t) => {
    const testEndTime = t.windowEndsAt
      ? new Date(t.windowEndsAt)
      : t.durationMinutes
      ? new Date(new Date(t.testDate).getTime() + t.durationMinutes * 60 * 1000)
      : new Date(t.testDate);
    return now > testEndTime;
  });

  const examItems: ExamReportItem[] = [];
  let totalMarksObtainedDec = new Prisma.Decimal(0);
  let totalMaxMarksDec = new Prisma.Decimal(0);
  let overallHasPendingWritten = false;
  let nonPendingTestsCount = 0;

  for (const test of closedTests) {
    // Check if written questions are pending for this student
    const hasWrittenQuestions = test.questions.some((q) => q.type === 'WRITTEN');
    const pendingWrittenAnswer = test.questions.some(
      (q) => q.type === 'WRITTEN' && q.studentAnswers.some((sa) => sa.marksAwarded === null)
    );

    // If test has written questions and student answered but marksAwarded is still null
    const isPending = hasWrittenQuestions && pendingWrittenAnswer;
    if (isPending) {
      overallHasPendingWritten = true;
    }

    // Determine student score and rank with ties
    const studentResult = test.results.find((r) => r.studentId === studentId);
    const maxMarksDec = new Prisma.Decimal(test.totalMarks);
    const maxMarksStr = maxMarksDec.toFixed(2, Prisma.Decimal.ROUND_HALF_UP);

    let marksStr: string | null = null;
    let percentStr: string | null = null;
    let rank: number | null = null;

    if (!isPending) {
      const marksObtained = studentResult ? studentResult.totalMarksObtained : 0;
      const marksDec = new Prisma.Decimal(marksObtained);
      marksStr = marksDec.toFixed(2, Prisma.Decimal.ROUND_HALF_UP);

      if (maxMarksDec.gt(0)) {
        percentStr = marksDec.div(maxMarksDec).times(100).toFixed(2, Prisma.Decimal.ROUND_HALF_UP);
      } else {
        percentStr = '0.00';
      }

      // Compute rank with ties (competition ranking: 1, 1, 3)
      if (studentResult) {
        const sortedScores = test.results
          .map((r) => r.totalMarksObtained)
          .sort((a, b) => b - a);

        let currentRank = 1;
        for (let i = 0; i < sortedScores.length; i++) {
          if (i > 0 && sortedScores[i] < sortedScores[i - 1]) {
            currentRank = i + 1;
          }
          if (sortedScores[i] === studentResult.totalMarksObtained) {
            rank = currentRank;
            break;
          }
        }
      }

      totalMarksObtainedDec = totalMarksObtainedDec.add(marksDec);
      totalMaxMarksDec = totalMaxMarksDec.add(maxMarksDec);
      nonPendingTestsCount++;
    }

    examItems.push({
      testId: test.id,
      title: test.title,
      date: test.testDate.toISOString().slice(0, 10),
      marks: marksStr,
      maxMarks: maxMarksStr,
      percent: percentStr,
      rank,
      pending: isPending,
    });
  }

  let overallExamPercent = '0.00';
  if (totalMaxMarksDec.gt(0)) {
    overallExamPercent = totalMarksObtainedDec
      .div(totalMaxMarksDec)
      .times(100)
      .toFixed(2, Prisma.Decimal.ROUND_HALF_UP);
  }

  const overallGrade = nonPendingTestsCount > 0 ? resolveGrade(overallExamPercent, gradingScale) : null;

  const examsSummary: ExamReportSummary = {
    tests: examItems,
    totalMarksObtained: totalMarksObtainedDec.toFixed(2, Prisma.Decimal.ROUND_HALF_UP),
    totalMaxMarks: totalMaxMarksDec.toFixed(2, Prisma.Decimal.ROUND_HALF_UP),
    overallPercent: overallExamPercent,
    grade: overallGrade,
    hasPendingWritten: overallHasPendingWritten,
  };

  // 3. Assignments in period (Graded only)
  const assignmentSubmissions = await prisma.assignmentSubmission.findMany({
    where: {
      studentId,
      marks: { not: null },
      assignment: {
        batchId,
        dueAt: {
          gte: fromDate,
          lte: toDate,
        },
      },
    },
    include: {
      assignment: {
        select: { maxMarks: true },
      },
    },
  });

  let totalAssignmentMarks = new Prisma.Decimal(0);
  let totalAssignmentMax = new Prisma.Decimal(0);

  for (const sub of assignmentSubmissions) {
    if (sub.marks !== null) {
      totalAssignmentMarks = totalAssignmentMarks.add(sub.marks);
      totalAssignmentMax = totalAssignmentMax.add(sub.assignment.maxMarks);
    }
  }

  let assignmentPercent = '0.00';
  if (totalAssignmentMax.gt(0)) {
    assignmentPercent = totalAssignmentMarks
      .div(totalAssignmentMax)
      .times(100)
      .toFixed(2, Prisma.Decimal.ROUND_HALF_UP);
  }

  const assignmentsSummary: AssignmentReportSummary = {
    marks: totalAssignmentMarks.toFixed(2, Prisma.Decimal.ROUND_HALF_UP),
    maxMarks: totalAssignmentMax.toFixed(2, Prisma.Decimal.ROUND_HALF_UP),
    percent: assignmentPercent,
    gradedCount: assignmentSubmissions.length,
  };

  // 4. Syllabus Progress for batch up to period end
  const subjectChapters = period.batch.subject.chapters;
  const totalChapters = subjectChapters.length;

  const completedLectures = await prisma.lecture.findMany({
    where: {
      batchId,
      status: 'COMPLETED',
      endsAt: { lte: toDate },
      chapterId: { not: null },
    },
    select: { chapterId: true },
  });

  const coveredChapterIds = new Set<string>();
  for (const l of completedLectures) {
    if (l.chapterId) coveredChapterIds.add(l.chapterId);
  }

  let coveredCount = 0;
  for (const c of subjectChapters) {
    if (coveredChapterIds.has(c.id)) coveredCount++;
  }

  let syllabusPercent = '0.00';
  if (totalChapters > 0) {
    syllabusPercent = new Prisma.Decimal(coveredCount)
      .div(totalChapters)
      .times(100)
      .toFixed(2, Prisma.Decimal.ROUND_HALF_UP);
  }

  const syllabusSummary: SyllabusReportSummary = {
    coveredChapters: coveredCount,
    totalChapters,
    percent: syllabusPercent,
  };

  // 5. Teacher remark
  const remarkRecord = await prisma.reportRemark.findUnique({
    where: {
      periodId_studentId: {
        periodId,
        studentId,
      },
    },
  });

  const remark = remarkRecord
    ? {
        text: remarkRecord.remark,
        updatedAt: remarkRecord.updatedAt.toISOString(),
      }
    : null;

  return {
    period: {
      id: period.id,
      batchId: period.batchId,
      batchName: period.batch.name,
      label: period.label,
      from: period.from.toISOString().slice(0, 10),
      to: period.to.toISOString().slice(0, 10),
      publishedAt: period.publishedAt ? period.publishedAt.toISOString() : null,
    },
    student: {
      id: student.id,
      name: student.name,
      studentCode: student.studentCode,
      avatarUrl: student.avatarUrl,
      phone: student.phone,
    },
    center: {
      name: settings.name,
      logoUrl: settings.logoUrl,
      receiptHeader: settings.receiptHeader,
      receiptFooter: settings.receiptFooter,
      branchName: period.batch.branch.name,
    },
    attendance: attendanceSummary,
    exams: examsSummary,
    assignments: assignmentsSummary,
    syllabus: syllabusSummary,
    remark,
  };
}

/**
 * Computes roster summary cards for all students in a report period (paginated).
 */
export async function computeBatchRosterReportCards(
  periodId: string,
  page = 1,
  limit = 20
) {
  const period = await prisma.reportPeriod.findUnique({
    where: { id: periodId },
    include: {
      batch: {
        include: {
          branch: true,
        },
      },
    },
  });

  if (!period) return null;

  const batchId = period.batchId;
  const toDate = new Date(period.to);
  toDate.setUTCHours(23, 59, 59, 999);

  // Total enrolled students
  const total = await prisma.enrollment.count({
    where: {
      batchId,
      enrolledAt: { lte: toDate },
    },
  });

  const skip = (page - 1) * limit;
  const enrollments = await prisma.enrollment.findMany({
    where: {
      batchId,
      enrolledAt: { lte: toDate },
    },
    include: {
      student: {
        select: {
          id: true,
          name: true,
          studentCode: true,
          avatarUrl: true,
        },
      },
    },
    orderBy: {
      student: { name: 'asc' },
    },
    skip,
    take: limit,
  });

  // Check tests in period with pending written answers
  const fromDate = new Date(period.from);
  fromDate.setUTCHours(0, 0, 0, 0);

  const pendingWrittenTests = await prisma.test.findMany({
    where: {
      batchId,
      testDate: {
        gte: fromDate,
        lte: toDate,
      },
      archivedAt: null,
      questions: {
        some: {
          type: 'WRITTEN',
          studentAnswers: {
            some: {
              marksAwarded: null,
            },
          },
        },
      },
    },
    select: {
      id: true,
      title: true,
      questions: {
        where: { type: 'WRITTEN' },
        select: {
          studentAnswers: {
            where: { marksAwarded: null },
            select: { id: true },
          },
        },
      },
    },
  });

  const pendingTests = pendingWrittenTests
    .map((t) => {
      let pendingCount = 0;
      for (const q of t.questions) {
        pendingCount += q.studentAnswers.length;
      }
      return {
        id: t.id,
        title: t.title,
        pendingCount,
      };
    })
    .filter((t) => t.pendingCount > 0);

  const cards: StudentRosterCardSummary[] = [];

  for (const enr of enrollments) {
    const card = await computeStudentReportCard(batchId, periodId, enr.studentId);
    if (card) {
      cards.push({
        student: card.student,
        attendance: card.attendance,
        exam: {
          overallPercent: card.exams.overallPercent,
          grade: card.exams.grade,
          hasPendingWritten: card.exams.hasPendingWritten,
        },
        remark: card.remark,
      });
    }
  }

  return {
    period: {
      id: period.id,
      batchId: period.batchId,
      batchName: period.batch.name,
      label: period.label,
      from: period.from.toISOString().slice(0, 10),
      to: period.to.toISOString().slice(0, 10),
      publishedAt: period.publishedAt ? period.publishedAt.toISOString() : null,
    },
    cards,
    pendingTests,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}
