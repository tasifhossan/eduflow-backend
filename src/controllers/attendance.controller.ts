import { Request, Response } from 'express';
import { Role, Prisma, EnrollmentStatus } from '@prisma/client';
import {
  markAttendanceSchema,
  lowAttendanceQuerySchema,
  attendanceSheetQuerySchema,
  myAttendanceSummaryQuerySchema,
} from '../validators/attendance.validator';
import { sendEmail } from '../utils/mailer';
import { escapeHtml } from '../utils/escapeHtml';
import { createAuditLog } from '../utils/audit';
import { getCenterSettings } from '../services/settings.service';
import { getZonedDateParts } from '../utils/timezone';
import prisma from '../utils/prisma';

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

export async function markAttendance(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const parseResult = markAttendanceSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { batchId, date, records } = parseResult.data;
    const branchId = req.user.branchId;

    // Verify batch exists and belongs to the user's branch (or any branch for SUPER_ADMIN)
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      select: { id: true, name: true, branchId: true, teacherId: true },
    });

    if (!batch || (req.user.role !== Role.SUPER_ADMIN && batch.branchId !== branchId)) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found or access denied',
      });
    }

    // Role check for teachers: can mark only their own batches
    if (req.user.role === Role.TEACHER && batch.teacherId !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Teachers can only mark attendance for their own batches',
      });
    }

    // Center settings, timezone and policy
    const settings = await getCenterSettings();
    const timeZone = settings?.timezone || 'Asia/Dhaka';
    const policy = (settings?.attendancePolicy as {
      alertOnLate?: boolean;
      lowThresholdPercent?: number;
      editWindowDays?: number;
    }) || {};
    const alertOnLate = Boolean(policy.alertOnLate);
    const editWindowDays = typeof policy.editWindowDays === 'number' ? policy.editWindowDays : 7;
    const attendanceAlertsOn = (settings?.features as Record<string, unknown> | undefined)?.attendanceAlerts !== false;

    // Normalize date to UTC midnight
    const parsedDate = new Date(date);
    const now = new Date();

    const nowParts = getZonedDateParts(now, timeZone);
    const targetParts = getZonedDateParts(parsedDate, timeZone);

    const nowDateMidnight = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day));
    const targetDateMidnight = new Date(Date.UTC(targetParts.year, targetParts.month - 1, targetParts.day));

    // Reject future attendance dates
    const diffDays = Math.floor((nowDateMidnight.getTime() - targetDateMidnight.getTime()) / (24 * 60 * 60 * 1000));
    if (diffDays < 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot mark attendance for future dates',
      });
    }

    // Edit window check for teachers
    if (req.user.role === Role.TEACHER && diffDays > editWindowDays) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: Attendance records older than ${editWindowDays} days can only be modified by administrators`,
      });
    }

    const normalizedDate = targetDateMidnight;

    // Verify all students exist and belong to the same branch (or center)
    const studentIds = records.map((r) => r.studentId);
    const students = await prisma.user.findMany({
      where: {
        id: { in: studentIds },
        role: Role.STUDENT,
        ...(req.user.role !== Role.SUPER_ADMIN ? { branchId } : {}),
      },
    });

    if (students.length !== new Set(studentIds).size) {
      return res.status(400).json({
        success: false,
        message: 'One or more student IDs are invalid or belong to a different branch',
      });
    }

    // Find existing attendance records for audit and alert check
    const existingRecords = await prisma.attendance.findMany({
      where: {
        batchId,
        date: normalizedDate,
        studentId: { in: studentIds },
      },
      select: {
        id: true,
        studentId: true,
        status: true,
        alertedAt: true,
      },
    });
    const existingMap = new Map(existingRecords.map((r) => [r.studentId, r]));

    // Audit log status changes
    for (const record of records) {
      const existing = existingMap.get(record.studentId);
      if (existing && existing.status !== record.status) {
        await createAuditLog({
          actorId: req.user.userId,
          action: 'ATTENDANCE_UPDATED',
          entityType: 'Attendance',
          entityId: existing.id,
          branchId: batch.branchId,
          metadata: {
            studentId: record.studentId,
            batchId,
            date: normalizedDate.toISOString(),
            oldStatus: existing.status,
            newStatus: record.status,
          },
          ip: req.ip || null,
        });
      }
    }

    // Determine which students should be alerted:
    // Newly marked ABSENT (or LATE if alertOnLate) and alertedAt is null.
    const recordsToAlert: typeof records = [];
    if (attendanceAlertsOn) {
      for (const record of records) {
        const existing = existingMap.get(record.studentId);
        const shouldAlertStatus = record.status === 'ABSENT' || (alertOnLate && record.status === 'LATE');
        if (!shouldAlertStatus) continue;

        // If an existing record was already alerted, never re-alert!
        if (existing && existing.alertedAt !== null) {
          continue;
        }

        recordsToAlert.push(record);
      }
    }

    const alertSet = new Set(recordsToAlert.map((r) => r.studentId));
    const nowTimestamp = new Date();

    // Upsert attendance records in a transaction
    const upserts = records.map((record) => {
      const willAlert = alertSet.has(record.studentId);
      return prisma.attendance.upsert({
        where: {
          studentId_batchId_date: {
            studentId: record.studentId,
            batchId,
            date: normalizedDate,
          },
        },
        update: {
          status: record.status,
          markedById: req.user!.userId,
          ...(willAlert ? { alertedAt: nowTimestamp } : {}),
        },
        create: {
          studentId: record.studentId,
          batchId,
          date: normalizedDate,
          status: record.status,
          markedById: req.user!.userId,
          alertedAt: willAlert ? nowTimestamp : null,
        },
      });
    });

    await prisma.$transaction(upserts);

    // Alerts to linked guardians: in-app notification saved, email async & non-blocking
    if (recordsToAlert.length > 0) {
      try {
        const studentIdsToAlert = recordsToAlert.map((r) => r.studentId);
        const studentsWithGuardians = await prisma.user.findMany({
          where: { id: { in: studentIdsToAlert } },
          select: {
            id: true,
            name: true,
            studentGuardians: {
              select: {
                guardian: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    notifyByEmail: true,
                    isActive: true,
                  },
                },
              },
            },
          },
        });

        const studentMap = new Map(studentsWithGuardians.map((s) => [s.id, s]));
        const dateStr = normalizedDate.toLocaleDateString('en-GB', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          timeZone,
        });

        const inAppNotifications: Array<{
          userId: string;
          type: string;
          title: string;
          body: string;
          entityType: string;
          entityId: string;
        }> = [];

        const emailsToSend: Array<{
          email: string;
          subject: string;
          html: string;
        }> = [];

        for (const alertRec of recordsToAlert) {
          const student = studentMap.get(alertRec.studentId);
          if (!student) continue;

          const firstName = student.name.split(' ')[0] || student.name;
          const statusWord = alertRec.status === 'ABSENT' ? 'absent' : 'late';
          const alertText = `${firstName} was marked ${statusWord} in ${batch.name} on ${dateStr}.`;

          for (const gl of student.studentGuardians) {
            const guardian = gl.guardian;
            if (!guardian || guardian.isActive === false) continue;

            inAppNotifications.push({
              userId: guardian.id,
              type: 'ATTENDANCE_ALERT',
              title: 'Attendance Alert',
              body: alertText,
              entityType: 'Attendance',
              entityId: batch.id,
            });

            if (guardian.email && guardian.notifyByEmail) {
              const escapedText = escapeHtml(alertText);
              const emailHtml = `
                <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:16px;">
                  <h2 style="color:${alertRec.status === 'ABSENT' ? '#ef4444' : '#f59e0b'};margin-bottom:12px;">Attendance Notice</h2>
                  <p style="font-size:15px;line-height:1.5;color:#1f2937;">${escapedText}</p>
                  <p style="margin-top:20px;font-size:12px;color:#6b7280;">This is an automated notification from ${escapeHtml(settings?.name || 'EduFlow')}. Please do not reply directly to this email.</p>
                </div>
              `;
              emailsToSend.push({
                email: guardian.email,
                subject: `Attendance Alert: ${firstName} was marked ${statusWord}`,
                html: emailHtml,
              });
            }
          }
        }

        if (inAppNotifications.length > 0) {
          await prisma.notification.createMany({
            data: inAppNotifications,
          });
        }

        if (emailsToSend.length > 0) {
          setImmediate(async () => {
            try {
              for (const item of emailsToSend) {
                await sendEmail([item.email], item.subject, item.html);
              }
            } catch (err) {
              console.error('[attendance] Async email error:', err);
            }
          });
        }
      } catch (err) {
        console.error('[attendance] Alert dispatch error:', err);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Attendance marked successfully',
    });
  } catch (error) {
    console.error('Mark attendance error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function getAttendanceByBatchAndDate(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const batchId = req.params.batchId as string;
    const { date } = req.query;
    const branchId = req.user.branchId;

    if (!date || typeof date !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Date query parameter is required',
      });
    }

    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format',
      });
    }

    const normalizedDate = new Date(parsedDate.toISOString().split('T')[0] + 'T00:00:00.000Z');

    // Verify batch exists and belongs to branch (or any branch for SUPER_ADMIN)
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
    });
    if (!batch || (req.user.role !== Role.SUPER_ADMIN && batch.branchId !== branchId)) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found or access denied',
      });
    }

    const records = await prisma.attendance.findMany({
      where: {
        batchId,
        date: normalizedDate,
      },
      include: {
        student: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            studentCode: true,
          },
        },
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Attendance records retrieved successfully',
      data: records,
    });
  } catch (error) {
    console.error('Get attendance by batch and date error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function getAttendanceByStudent(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const studentId = req.params.studentId as string;
    const branchId = req.user.branchId;

    // Enforce student self-access check
    if (req.user.role === Role.STUDENT && req.user.userId !== studentId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied to other student attendance records',
      });
    }

    // Verify student exists and belongs to the same branch
    const student = await prisma.user.findUnique({
      where: { id: studentId },
    });
    if (!student || (req.user.role !== Role.SUPER_ADMIN && student.branchId !== branchId) || student.role !== Role.STUDENT) {
      return res.status(404).json({
        success: false,
        message: 'Student not found or access denied',
      });
    }

    const batchId = req.query.batchId as string | undefined;

    if (batchId) {
      const batch = await prisma.batch.findUnique({
        where: { id: batchId },
      });
      if (!batch || (req.user.role !== Role.SUPER_ADMIN && batch.branchId !== branchId)) {
        return res.status(404).json({
          success: false,
          message: 'Batch not found or access denied',
        });
      }
    }

    const whereClause: Prisma.AttendanceWhereInput = {
      studentId,
      ...(batchId ? { batchId } : {}),
    };

    const history = await prisma.attendance.findMany({
      where: whereClause,
      include: {
        batch: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
      },
      orderBy: {
        date: 'desc',
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Student attendance history retrieved successfully',
      data: history,
    });
  } catch (error) {
    console.error('Get attendance by student error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function getTodayAttendanceSummary(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const branchId = req.user.branchId;
    const { date } = req.query;

    let targetDate = new Date();
    if (date && typeof date === 'string') {
      const parsedDate = new Date(date);
      if (!isNaN(parsedDate.getTime())) {
        targetDate = parsedDate;
      } else {
        return res.status(400).json({
          success: false,
          message: 'Invalid date format',
        });
      }
    }

    const normalizedDate = new Date(targetDate.toISOString().split('T')[0] + 'T00:00:00.000Z');

    const batches = await prisma.batch.findMany({
      where: {
        ...(req.user.role !== Role.SUPER_ADMIN ? { branchId } : {}),
        ...(req.user.role === Role.TEACHER ? { teacherId: req.user.userId } : {}),
      },
      select: {
        id: true,
        name: true,
        type: true,
        classLevel: true,
        subject: {
          select: {
            name: true,
          },
        },
        teacher: {
          select: {
            name: true,
          },
        },
        _count: {
          select: {
            enrollments: true,
          },
        },
        attendances: {
          where: {
            date: normalizedDate,
          },
          select: {
            id: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const summary = batches.map((batch) => {
      const totalEnrolled = batch._count.enrollments;
      const markedCount = batch.attendances.length;

      let status: 'marked' | 'partial' | 'unmarked' = 'unmarked';
      if (markedCount > 0) {
        if (totalEnrolled > 0 && markedCount >= totalEnrolled) {
          status = 'marked';
        } else {
          status = 'partial';
        }
      }

      return {
        id: batch.id,
        name: batch.name,
        type: batch.type,
        classLevel: batch.classLevel,
        subjectName: batch.subject.name,
        teacherName: batch.teacher?.name || null,
        totalEnrolled,
        todayMarkedCount: markedCount,
        status,
      };
    });

    return res.status(200).json({
      success: true,
      message: "Today's attendance summary retrieved successfully",
      data: summary,
    });
  } catch (error) {
    console.error('Get today\'s attendance summary error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

/**
 * GET /api/attendance/low
 * Reports students below threshold with present, absent, late, percent.
 */
export async function getLowAttendanceReport(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const parseResult = lowAttendanceQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({ success: false, message: 'Validation failed', data: parseResult.error.flatten() });
    }

    const { from, to, batchId, page, limit, format } = parseResult.data;
    const settings = await getCenterSettings();
    const policy = (settings?.attendancePolicy as { lowThresholdPercent?: number }) || {};
    const threshold = parseResult.data.threshold ?? policy.lowThresholdPercent ?? 75;

    // Scope batches by role
    const batchWhere: Prisma.BatchWhereInput = {};
    if (req.user.role === Role.TEACHER) {
      batchWhere.teacherId = req.user.userId;
      if (batchId) {
        batchWhere.id = batchId;
      }
    } else if (req.user.role === Role.ADMIN) {
      batchWhere.branchId = req.user.branchId;
      if (batchId) {
        batchWhere.id = batchId;
      }
    } else if (req.user.role === Role.SUPER_ADMIN) {
      if (batchId) {
        batchWhere.id = batchId;
      }
    } else {
      return res.status(403).json({ success: false, message: 'Forbidden: Insufficient privileges' });
    }

    // Verify batchId exists in user scope if specified
    if (batchId) {
      const b = await prisma.batch.findFirst({ where: batchWhere });
      if (!b) {
        return res.status(404).json({ success: false, message: 'Batch not found or access denied' });
      }
    }

    // Build attendance date filter
    const dateFilter: Prisma.DateTimeFilter = {};
    if (from) {
      dateFilter.gte = new Date(from);
    }
    if (to) {
      dateFilter.lte = new Date(to);
    }

    const attendanceWhere: Prisma.AttendanceWhereInput = {
      batch: batchWhere,
      ...(from || to ? { date: dateFilter } : {}),
    };

    const attendances = await prisma.attendance.findMany({
      where: attendanceWhere,
      select: {
        studentId: true,
        batchId: true,
        status: true,
        student: {
          select: {
            id: true,
            name: true,
            studentCode: true,
            email: true,
            phone: true,
          },
        },
        batch: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Aggregate by studentId + batchId
    const aggregated = new Map<string, {
      studentId: string;
      studentName: string;
      studentCode: string | null;
      batchId: string;
      batchName: string;
      present: number;
      absent: number;
      late: number;
      total: number;
      ratePercent: number;
    }>();

    for (const att of attendances) {
      const key = `${att.studentId}_${att.batchId}`;
      if (!aggregated.has(key)) {
        aggregated.set(key, {
          studentId: att.studentId,
          studentName: att.student.name,
          studentCode: att.student.studentCode,
          batchId: att.batchId,
          batchName: att.batch.name,
          present: 0,
          absent: 0,
          late: 0,
          total: 0,
          ratePercent: 100,
        });
      }
      const entry = aggregated.get(key)!;
      entry.total += 1;
      if (att.status === 'PRESENT') entry.present += 1;
      else if (att.status === 'ABSENT') entry.absent += 1;
      else if (att.status === 'LATE') entry.late += 1;
    }

    const lowStudents: Array<{
      studentId: string;
      studentName: string;
      studentCode: string | null;
      batchId: string;
      batchName: string;
      present: number;
      absent: number;
      late: number;
      total: number;
      ratePercent: number;
    }> = [];

    for (const item of aggregated.values()) {
      item.ratePercent = item.total > 0 ? Math.round(((item.present + item.late) / item.total) * 100) : 0;
      if (item.ratePercent < threshold) {
        lowStudents.push(item);
      }
    }

    // Sort ascending by ratePercent (worst first), then studentName
    lowStudents.sort((a, b) => a.ratePercent - b.ratePercent || a.studentName.localeCompare(b.studentName));

    if (format === 'csv') {
      await createAuditLog({
        actorId: req.user.userId,
        action: 'ATTENDANCE_REPORT_EXPORTED',
        entityType: 'AttendanceReport',
        branchId: req.user.branchId || null,
        metadata: { threshold, count: lowStudents.length, format: 'csv' },
        ip: req.ip || null,
      });

      const header = ['Student Name', 'Student Code', 'Batch', 'Total Classes', 'Present', 'Absent', 'Late', 'Attendance Rate (%)'];
      const rows = lowStudents.map((s) => [
        sanitizeCsvField(s.studentName),
        sanitizeCsvField(s.studentCode || '—'),
        sanitizeCsvField(s.batchName),
        sanitizeCsvField(s.total),
        sanitizeCsvField(s.present),
        sanitizeCsvField(s.absent),
        sanitizeCsvField(s.late),
        sanitizeCsvField(`${s.ratePercent}%`),
      ]);
      const csvContent = '\uFEFF' + [header.join(','), ...rows.map((r) => r.join(','))].join('\r\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="low-attendance-report.csv"');
      return res.status(200).send(csvContent);
    }

    const total = lowStudents.length;
    const startIndex = (page - 1) * limit;
    const items = lowStudents.slice(startIndex, startIndex + limit);

    return res.status(200).json({
      success: true,
      data: {
        items,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 1,
        },
        threshold,
      },
    });
  } catch (error) {
    console.error('Get low attendance report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

/**
 * GET /api/batches/:id/attendance/sheet?month=YYYY-MM
 * Matrix of students by class dates with statuses and totals.
 */
export async function getBatchAttendanceSheet(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const batchId = req.params.id as string;
    const parseResult = attendanceSheetQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({ success: false, message: 'Validation failed', data: parseResult.error.flatten() });
    }

    const { month, format } = parseResult.data;
    const [yearStr, monthStr] = month.split('-');
    const year = parseInt(yearStr, 10);
    const monthNum = parseInt(monthStr, 10);

    // Verify batch and authorization
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      select: { id: true, name: true, branchId: true, teacherId: true },
    });

    if (!batch) {
      return res.status(404).json({ success: false, message: 'Batch not found' });
    }

    if (req.user.role === Role.TEACHER && batch.teacherId !== req.user.userId) {
      return res.status(403).json({ success: false, message: 'Forbidden: Access denied to other teacher batches' });
    }
    if (req.user.role === Role.ADMIN && batch.branchId !== req.user.branchId) {
      return res.status(403).json({ success: false, message: 'Forbidden: Access denied to other branch batches' });
    }

    // Calculate month range in UTC
    const monthStart = new Date(Date.UTC(year, monthNum - 1, 1, 0, 0, 0, 0));
    const lastDay = new Date(Date.UTC(year, monthNum, 0, 23, 59, 59, 999)).getUTCDate();
    const monthEnd = new Date(Date.UTC(year, monthNum - 1, lastDay, 23, 59, 59, 999));

    // 1. Find all active enrollments for this batch
    const enrollments = await prisma.enrollment.findMany({
      where: { batchId, status: EnrollmentStatus.ACTIVE },
      select: {
        student: {
          select: {
            id: true,
            name: true,
            studentCode: true,
          },
        },
      },
      orderBy: { student: { name: 'asc' } },
    });

    // 2. Find lectures in month
    const lectures = await prisma.lecture.findMany({
      where: {
        batchId,
        startsAt: { gte: monthStart, lte: monthEnd },
      },
      select: { startsAt: true },
    });

    // 3. Find attendance records in month
    const attendances = await prisma.attendance.findMany({
      where: {
        batchId,
        date: { gte: monthStart, lte: monthEnd },
      },
      select: {
        id: true,
        studentId: true,
        date: true,
        status: true,
      },
    });

    // Collect and format all distinct dates YYYY-MM-DD
    const dateSet = new Set<string>();
    for (const l of lectures) {
      dateSet.add(l.startsAt.toISOString().slice(0, 10));
    }
    for (const a of attendances) {
      dateSet.add(a.date.toISOString().slice(0, 10));
    }

    const sortedDates = Array.from(dateSet).sort();

    // Map attendances by `studentId_date`
    const attMap = new Map<string, 'PRESENT' | 'ABSENT' | 'LATE'>();
    for (const a of attendances) {
      const dStr = a.date.toISOString().slice(0, 10);
      attMap.set(`${a.studentId}_${dStr}`, a.status);
    }

    const studentsMatrix = enrollments.map((enr) => {
      const student = enr.student;
      const dateStatuses: Record<string, 'P' | 'A' | 'L' | '-'> = {};
      let present = 0;
      let absent = 0;
      let late = 0;

      for (const dStr of sortedDates) {
        const rawStatus = attMap.get(`${student.id}_${dStr}`);
        if (rawStatus === 'PRESENT') {
          dateStatuses[dStr] = 'P';
          present += 1;
        } else if (rawStatus === 'ABSENT') {
          dateStatuses[dStr] = 'A';
          absent += 1;
        } else if (rawStatus === 'LATE') {
          dateStatuses[dStr] = 'L';
          late += 1;
        } else {
          dateStatuses[dStr] = '-';
        }
      }

      const totalHeld = sortedDates.length;
      const ratePercent = totalHeld > 0 ? Math.round(((present + late) / totalHeld) * 100) : 0;

      return {
        studentId: student.id,
        name: student.name,
        studentCode: student.studentCode,
        dates: dateStatuses,
        totals: {
          totalClasses: totalHeld,
          present,
          absent,
          late,
          ratePercent,
        },
      };
    });

    if (format === 'csv') {
      await createAuditLog({
        actorId: req.user.userId,
        action: 'ATTENDANCE_SHEET_EXPORTED',
        entityType: 'AttendanceSheet',
        branchId: batch.branchId,
        metadata: { batchId, month, count: studentsMatrix.length, format: 'csv' },
        ip: req.ip || null,
      });

      const header = ['Student Name', 'Student Code', ...sortedDates, 'Total Classes', 'Present', 'Absent', 'Late', 'Rate (%)'];
      const rows = studentsMatrix.map((s) => [
        sanitizeCsvField(s.name),
        sanitizeCsvField(s.studentCode || '—'),
        ...sortedDates.map((d) => sanitizeCsvField(s.dates[d] || '-')),
        sanitizeCsvField(s.totals.totalClasses),
        sanitizeCsvField(s.totals.present),
        sanitizeCsvField(s.totals.absent),
        sanitizeCsvField(s.totals.late),
        sanitizeCsvField(`${s.totals.ratePercent}%`),
      ]);

      const csvContent = '\uFEFF' + [header.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="attendance-sheet-${month}.csv"`);
      return res.status(200).send(csvContent);
    }

    return res.status(200).json({
      success: true,
      data: {
        batchId: batch.id,
        batchName: batch.name,
        month,
        dates: sortedDates,
        students: studentsMatrix,
      },
    });
  } catch (error) {
    console.error('Get batch attendance sheet error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

/**
 * GET /api/my/attendance/summary?studentId=
 * Returns monthly percent, totals, recent records, scoped by enrollment and GuardianLink.
 */
export async function getMyAttendanceSummary(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const parseResult = myAttendanceSummaryQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({ success: false, message: 'Validation failed' });
    }

    let targetStudentId = req.user.userId;
    let linkedChildren: Array<{ id: string; name: string; studentCode: string | null }> = [];

    if (req.user.role === Role.GUARDIAN) {
      // Find all linked students
      const links = await prisma.guardianLink.findMany({
        where: { guardianId: req.user.userId },
        select: {
          student: {
            select: { id: true, name: true, studentCode: true },
          },
        },
      });

      linkedChildren = links.map((l) => l.student);
      if (linkedChildren.length === 0) {
        return res.status(200).json({
          success: true,
          data: {
            student: null,
            linkedChildren: [],
            monthPercent: 100,
            overallPercent: 100,
            totals: { present: 0, absent: 0, late: 0, total: 0 },
            recentRecords: [],
          },
        });
      }

      const requestedStudentId = parseResult.data.studentId;
      if (requestedStudentId) {
        const isLinked = linkedChildren.some((c) => c.id === requestedStudentId);
        if (!isLinked) {
          return res.status(403).json({ success: false, message: 'Forbidden: Access denied to unlinked student' });
        }
        targetStudentId = requestedStudentId;
      } else {
        targetStudentId = linkedChildren[0].id;
      }
    } else if (req.user.role === Role.STUDENT) {
      if (parseResult.data.studentId && parseResult.data.studentId !== req.user.userId) {
        return res.status(403).json({ success: false, message: 'Forbidden: Access denied to other student attendance' });
      }
      targetStudentId = req.user.userId;
    } else {
      return res.status(403).json({ success: false, message: 'Forbidden: Student or guardian access only' });
    }

    const studentUser = await prisma.user.findUnique({
      where: { id: targetStudentId },
      select: { id: true, name: true, studentCode: true },
    });

    if (!studentUser) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    // Time calculations in center timezone
    const settings = await getCenterSettings();
    const timeZone = settings?.timezone || 'Asia/Dhaka';
    const now = new Date();
    const nowParts = getZonedDateParts(now, timeZone);
    const monthStart = new Date(Date.UTC(nowParts.year, nowParts.month - 1, 1, 0, 0, 0, 0));

    // Fetch all student attendance
    const allRecords = await prisma.attendance.findMany({
      where: { studentId: targetStudentId },
      select: {
        id: true,
        date: true,
        status: true,
        batch: {
          select: { id: true, name: true },
        },
      },
      orderBy: { date: 'desc' },
    });

    let overallPresent = 0;
    let overallAbsent = 0;
    let overallLate = 0;
    let monthPresent = 0;
    let monthAbsent = 0;
    let monthLate = 0;

    for (const r of allRecords) {
      if (r.status === 'PRESENT') overallPresent += 1;
      else if (r.status === 'ABSENT') overallAbsent += 1;
      else if (r.status === 'LATE') overallLate += 1;

      if (r.date >= monthStart) {
        if (r.status === 'PRESENT') monthPresent += 1;
        else if (r.status === 'ABSENT') monthAbsent += 1;
        else if (r.status === 'LATE') monthLate += 1;
      }
    }

    const overallTotal = allRecords.length;
    const monthTotal = monthPresent + monthAbsent + monthLate;

    const overallPercent = overallTotal > 0 ? Math.round(((overallPresent + overallLate) / overallTotal) * 100) : 100;
    const monthPercent = monthTotal > 0 ? Math.round(((monthPresent + monthLate) / monthTotal) * 100) : 100;

    const recentRecords = allRecords.slice(0, 30).map((r) => ({
      id: r.id,
      date: r.date.toISOString(),
      status: r.status,
      batch: r.batch,
    }));

    return res.status(200).json({
      success: true,
      data: {
        student: studentUser,
        linkedChildren: req.user.role === Role.GUARDIAN ? linkedChildren : undefined,
        monthPercent,
        overallPercent,
        totals: {
          present: overallPresent,
          absent: overallAbsent,
          late: overallLate,
          total: overallTotal,
          monthPresent,
          monthAbsent,
          monthLate,
          monthTotal,
        },
        recentRecords,
      },
    });
  } catch (error) {
    console.error('Get my attendance summary error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}
