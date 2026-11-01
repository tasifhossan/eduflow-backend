import { Request, Response } from 'express';
import { Role } from '@prisma/client';
import prisma from '../utils/prisma';
import { createAuditLog } from '../utils/audit';
import {
  exportStudentsQuerySchema,
  exportBatchResultsQuerySchema,
} from '../validators/report-card.validator';

function sanitizeCsvField(val: unknown): string {
  if (val === null || val === undefined) return '';
  let str = String(val).trim();
  // Formula neutralization: prefix with single quote if starts with formula characters
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  // Escape quotes
  if (/[",\n\r]/.test(str)) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * GET /api/exports/students?format=csv
 * Scope: ADMIN (own branch), SUPER_ADMIN (all).
 * Headers: Name, Student Code, Phone, Guardian Name, Guardian Phone, Batches, Status, Joined Date
 * Limit: 5000 rows, formula-neutralized, UTF-8 BOM, audit logged.
 */
export async function exportStudents(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (req.user.role !== Role.ADMIN && req.user.role !== Role.SUPER_ADMIN) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Admin or Super Admin privileges required',
      });
    }

    const queryResult = exportStudentsQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: queryResult.error.flatten(),
      });
    }

    const userWhere: { role: Role; branchId?: string; isActive?: boolean } = {
      role: Role.STUDENT,
    };

    if (req.user.role === Role.ADMIN) {
      userWhere.branchId = req.user.branchId;
    }

    if (queryResult.data.status === 'ACTIVE') {
      userWhere.isActive = true;
    } else if (queryResult.data.status === 'INACTIVE') {
      userWhere.isActive = false;
    }

    const students = await prisma.user.findMany({
      where: userWhere,
      select: {
        id: true,
        name: true,
        studentCode: true,
        phone: true,
        guardianName: true,
        guardianPhone: true,
        isActive: true,
        createdAt: true,
        enrollments: {
          select: {
            batch: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });

    const headers = [
      'Name',
      'Student Code',
      'Phone',
      'Guardian Name',
      'Guardian Phone',
      'Batches',
      'Status',
      'Joined Date',
    ];

    const rows: string[] = [];
    rows.push(headers.join(','));

    for (const s of students) {
      const batchNames = s.enrollments.map((e) => e.batch.name).join('; ');
      const joinedDate = s.createdAt.toISOString().slice(0, 10);
      const statusStr = s.isActive ? 'Active' : 'Inactive';

      const line = [
        sanitizeCsvField(s.name),
        sanitizeCsvField(s.studentCode || '-'),
        sanitizeCsvField(s.phone || '-'),
        sanitizeCsvField(s.guardianName || '-'),
        sanitizeCsvField(s.guardianPhone || '-'),
        sanitizeCsvField(batchNames || '-'),
        sanitizeCsvField(statusStr),
        sanitizeCsvField(joinedDate),
      ].join(',');

      rows.push(line);
    }

    await createAuditLog({
      actorId: req.user.userId,
      action: 'REPORT_EXPORTED',
      entityType: 'Export',
      entityId: 'students',
      branchId: req.user.branchId || null,
      metadata: {
        exportType: 'students',
        rowCount: students.length,
      },
      ip: req.ip || null,
    });

    const csvContent = '\uFEFF' + rows.join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="students-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.status(200).send(csvContent);
  } catch (error) {
    console.error('Export students error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

/**
 * GET /api/exports/batch-results?batchId&periodId&format=csv
 * Scope: ADMIN (own branch), SUPER_ADMIN (all).
 * Per student, per test matrix/rows.
 * Limit: 5000 rows, formula-neutralized, UTF-8 BOM, audit logged.
 */
export async function exportBatchResults(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (req.user.role !== Role.ADMIN && req.user.role !== Role.SUPER_ADMIN) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Admin or Super Admin privileges required',
      });
    }

    const queryResult = exportBatchResultsQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: queryResult.error.flatten(),
      });
    }

    const { batchId, periodId } = queryResult.data;

    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      select: { id: true, name: true, branchId: true },
    });

    if (!batch) {
      return res.status(404).json({ success: false, message: 'Batch not found' });
    }

    if (req.user.role === Role.ADMIN && batch.branchId !== req.user.branchId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied to batch in another branch',
      });
    }

    const period = await prisma.reportPeriod.findUnique({
      where: { id: periodId },
      select: { id: true, batchId: true, label: true, from: true, to: true },
    });

    if (!period || period.batchId !== batchId) {
      return res.status(404).json({
        success: false,
        message: 'Report period not found for this batch',
      });
    }

    const fromDate = new Date(period.from);
    fromDate.setUTCHours(0, 0, 0, 0);
    const toDate = new Date(period.to);
    toDate.setUTCHours(23, 59, 59, 999);

    // Enrolled students in batch
    const enrollments = await prisma.enrollment.findMany({
      where: {
        batchId,
        enrolledAt: { lte: toDate },
      },
      include: {
        student: {
          select: { id: true, name: true, studentCode: true },
        },
      },
      orderBy: { student: { name: 'asc' } },
    });

    // Tests in period
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
            studentAnswers: {
              select: {
                studentId: true,
                marksAwarded: true,
              },
            },
          },
        },
        results: { select: { studentId: true, totalMarksObtained: true, rank: true } },
      },
      orderBy: { testDate: 'asc' },
    });

    const now = new Date();
    // Filter closed tests
    const closedTests = tests.filter((t) => {
      const testEndTime = t.windowEndsAt
        ? new Date(t.windowEndsAt)
        : t.durationMinutes
        ? new Date(new Date(t.testDate).getTime() + t.durationMinutes * 60 * 1000)
        : new Date(t.testDate);
      return now > testEndTime;
    });

    const headers = [
      'Student Name',
      'Student Code',
      'Test Title',
      'Test Date',
      'Total Marks',
      'Marks Obtained',
      'Percentage',
      'Rank',
      'Status',
    ];

    const rows: string[] = [];
    rows.push(headers.join(','));

    let rowCount = 0;

    for (const enr of enrollments) {
      if (rowCount >= 5000) break;
      const student = enr.student;

      if (closedTests.length === 0) {
        // Output row for student indicating no closed tests
        rows.push([
          sanitizeCsvField(student.name),
          sanitizeCsvField(student.studentCode || '-'),
          sanitizeCsvField('No closed tests in period'),
          sanitizeCsvField('-'),
          sanitizeCsvField('0.00'),
          sanitizeCsvField('0.00'),
          sanitizeCsvField('0.00%'),
          sanitizeCsvField('-'),
          sanitizeCsvField('N/A'),
        ].join(','));
        rowCount++;
        continue;
      }

      for (const test of closedTests) {
        if (rowCount >= 5000) break;

        const result = test.results.find((r) => r.studentId === student.id);
        const hasPendingWritten = test.questions.some(
          (q) => q.type === 'WRITTEN' && q.studentAnswers.some((sa) => sa.studentId === student.id && sa.marksAwarded === null)
        );

        let marksStr = '-';
        let percentStr = '-';
        let rankStr = '-';
        let status = 'Unattempted';

        if (hasPendingWritten) {
          status = 'Pending Written Grading';
        } else if (result) {
          marksStr = result.totalMarksObtained.toFixed(2);
          const percent = test.totalMarks > 0 ? (result.totalMarksObtained / test.totalMarks) * 100 : 0;
          percentStr = `${percent.toFixed(2)}%`;
          rankStr = result.rank !== null ? String(result.rank) : '-';
          status = 'Graded';
        }

        const line = [
          sanitizeCsvField(student.name),
          sanitizeCsvField(student.studentCode || '-'),
          sanitizeCsvField(test.title),
          sanitizeCsvField(test.testDate.toISOString().slice(0, 10)),
          sanitizeCsvField(test.totalMarks.toFixed(2)),
          sanitizeCsvField(marksStr),
          sanitizeCsvField(percentStr),
          sanitizeCsvField(rankStr),
          sanitizeCsvField(status),
        ].join(',');

        rows.push(line);
        rowCount++;
      }
    }

    await createAuditLog({
      actorId: req.user.userId,
      action: 'REPORT_EXPORTED',
      entityType: 'Export',
      entityId: 'batch-results',
      branchId: batch.branchId,
      metadata: {
        exportType: 'batch-results',
        batchId,
        periodId,
        rowCount,
      },
      ip: req.ip || null,
    });

    const csvContent = '\uFEFF' + rows.join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="batch-results-${batchId}-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.status(200).send(csvContent);
  } catch (error) {
    console.error('Export batch results error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}
