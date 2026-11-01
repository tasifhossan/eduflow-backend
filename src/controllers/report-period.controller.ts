import { Request, Response } from 'express';
import { Role } from '@prisma/client';
import prisma from '../utils/prisma';
import { createAuditLog } from '../utils/audit';
import {
  createReportPeriodSchema,
  updateReportPeriodSchema,
  updateReportRemarkSchema,
  reportPeriodCardsQuerySchema,
  myReportCardsQuerySchema,
} from '../validators/report-card.validator';
import {
  computeStudentReportCard,
  computeBatchRosterReportCards,
} from '../services/report-card.service';

/**
 * Checks if the caller has staff access to a specific batch.
 */
async function verifyBatchStaffAccess(
  user: { userId: string; role: Role; branchId: string },
  batchId: string
) {
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    select: { id: true, branchId: true, teacherId: true, name: true },
  });

  if (!batch) return { allowed: false, batch: null, status: 404, message: 'Batch not found' };

  if (user.role === Role.SUPER_ADMIN) {
    return { allowed: true, batch, status: 200, message: 'OK' };
  }

  if (user.role === Role.ADMIN) {
    if (batch.branchId !== user.branchId) {
      return { allowed: false, batch, status: 403, message: 'Forbidden: Access denied to batch in another branch' };
    }
    return { allowed: true, batch, status: 200, message: 'OK' };
  }

  if (user.role === Role.TEACHER) {
    if (batch.teacherId !== user.userId) {
      return { allowed: false, batch, status: 403, message: 'Forbidden: You are not assigned to this batch' };
    }
    return { allowed: true, batch, status: 200, message: 'OK' };
  }

  return { allowed: false, batch, status: 403, message: 'Forbidden: Staff access required' };
}

/**
 * POST /api/report-periods
 */
export async function createReportPeriod(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const parseResult = createReportPeriodSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: parseResult.error.flatten(),
      });
    }

    const { batchId, label, from, to } = parseResult.data;
    const access = await verifyBatchStaffAccess(req.user, batchId);
    if (!access.allowed || !access.batch) {
      return res.status(access.status).json({ success: false, message: access.message });
    }

    // Check duplicate label for batch
    const existing = await prisma.reportPeriod.findUnique({
      where: {
        batchId_label: {
          batchId,
          label,
        },
      },
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'A report period with this label already exists for this batch',
      });
    }

    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T00:00:00.000Z`);

    const period = await prisma.reportPeriod.create({
      data: {
        batchId,
        label,
        from: fromDate,
        to: toDate,
        createdById: req.user.userId,
      },
      include: {
        batch: {
          select: { id: true, name: true, branchId: true },
        },
      },
    });

    await createAuditLog({
      actorId: req.user.userId,
      action: 'REPORT_PERIOD_CREATED',
      entityType: 'ReportPeriod',
      entityId: period.id,
      branchId: access.batch.branchId,
      metadata: {
        periodId: period.id,
        batchId: period.batchId,
      },
      ip: req.ip || null,
    });

    return res.status(201).json({
      success: true,
      data: {
        id: period.id,
        batchId: period.batchId,
        batchName: period.batch.name,
        label: period.label,
        from: period.from.toISOString().slice(0, 10),
        to: period.to.toISOString().slice(0, 10),
        publishedAt: period.publishedAt ? period.publishedAt.toISOString() : null,
        createdAt: period.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Create report period error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

/**
 * GET /api/batches/:id/report-periods
 */
export async function getBatchReportPeriods(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const batchId = req.params.id as string;
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      select: { id: true, branchId: true, teacherId: true, name: true },
    });

    if (!batch) {
      return res.status(404).json({ success: false, message: 'Batch not found' });
    }

    const user = req.user;
    const isStaff = user.role === Role.SUPER_ADMIN || user.role === Role.ADMIN || user.role === Role.TEACHER;

    if (user.role === Role.ADMIN && batch.branchId !== user.branchId) {
      return res.status(403).json({ success: false, message: 'Forbidden: Access denied to another branch batch' });
    }

    if (user.role === Role.TEACHER && batch.teacherId !== user.userId) {
      return res.status(403).json({ success: false, message: 'Forbidden: Access denied to unassigned batch' });
    }

    if (user.role === Role.STUDENT) {
      const enrollment = await prisma.enrollment.findUnique({
        where: {
          studentId_batchId: { studentId: user.userId, batchId },
        },
      });
      if (!enrollment) {
        return res.status(403).json({ success: false, message: 'Forbidden: Active enrollment required' });
      }
    }

    if (user.role === Role.GUARDIAN) {
      const studentId = req.query.studentId as string;
      if (!studentId) {
        return res.status(400).json({ success: false, message: 'studentId query parameter required' });
      }
      const link = await prisma.guardianLink.findUnique({
        where: {
          guardianId_studentId: { guardianId: user.userId, studentId },
        },
      });
      if (!link) {
        return res.status(403).json({ success: false, message: 'Forbidden: Guardian is not linked to this student' });
      }
      const enrollment = await prisma.enrollment.findUnique({
        where: {
          studentId_batchId: { studentId, batchId },
        },
      });
      if (!enrollment) {
        return res.status(403).json({ success: false, message: 'Forbidden: Student has no enrollment in this batch' });
      }
    }

    const whereClause: { batchId: string; publishedAt?: { not: null } } = { batchId };
    if (!isStaff) {
      whereClause.publishedAt = { not: null };
    }

    const periods = await prisma.reportPeriod.findMany({
      where: whereClause,
      orderBy: [{ from: 'desc' }, { createdAt: 'desc' }],
    });

    const data = periods.map((p) => ({
      id: p.id,
      batchId: p.batchId,
      batchName: batch.name,
      label: p.label,
      from: p.from.toISOString().slice(0, 10),
      to: p.to.toISOString().slice(0, 10),
      publishedAt: p.publishedAt ? p.publishedAt.toISOString() : null,
      createdAt: p.createdAt.toISOString(),
    }));

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Get batch report periods error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

/**
 * PATCH /api/report-periods/:id
 * Only allowed while unpublished.
 */
export async function updateReportPeriod(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const periodId = req.params.id as string;
    const period = await prisma.reportPeriod.findUnique({
      where: { id: periodId },
      include: {
        batch: { select: { id: true, branchId: true, teacherId: true } },
      },
    });

    if (!period) {
      return res.status(404).json({ success: false, message: 'Report period not found' });
    }

    const access = await verifyBatchStaffAccess(req.user, period.batchId);
    if (!access.allowed) {
      return res.status(access.status).json({ success: false, message: access.message });
    }

    // Only while unpublished
    if (period.publishedAt !== null) {
      return res.status(400).json({
        success: false,
        message: 'Cannot edit a published report period. Unpublish first.',
      });
    }

    const parseResult = updateReportPeriodSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: parseResult.error.flatten(),
      });
    }

    const updateData: { label?: string; from?: Date; to?: Date } = {};
    if (parseResult.data.label) updateData.label = parseResult.data.label;
    if (parseResult.data.from) updateData.from = new Date(`${parseResult.data.from}T00:00:00.000Z`);
    if (parseResult.data.to) updateData.to = new Date(`${parseResult.data.to}T00:00:00.000Z`);

    const updated = await prisma.reportPeriod.update({
      where: { id: periodId },
      data: updateData,
    });

    await createAuditLog({
      actorId: req.user.userId,
      action: 'REPORT_PERIOD_UPDATED',
      entityType: 'ReportPeriod',
      entityId: period.id,
      branchId: period.batch.branchId,
      metadata: { periodId: period.id },
      ip: req.ip || null,
    });

    return res.status(200).json({
      success: true,
      data: {
        id: updated.id,
        batchId: updated.batchId,
        label: updated.label,
        from: updated.from.toISOString().slice(0, 10),
        to: updated.to.toISOString().slice(0, 10),
        publishedAt: updated.publishedAt ? updated.publishedAt.toISOString() : null,
      },
    });
  } catch (error) {
    console.error('Update report period error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

/**
 * POST /api/report-periods/:id/publish
 */
export async function publishReportPeriod(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const periodId = req.params.id as string;
    const period = await prisma.reportPeriod.findUnique({
      where: { id: periodId },
      include: {
        batch: { select: { id: true, branchId: true, teacherId: true } },
      },
    });

    if (!period) {
      return res.status(404).json({ success: false, message: 'Report period not found' });
    }

    const access = await verifyBatchStaffAccess(req.user, period.batchId);
    if (!access.allowed) {
      return res.status(access.status).json({ success: false, message: access.message });
    }

    const updated = await prisma.reportPeriod.update({
      where: { id: periodId },
      data: { publishedAt: new Date() },
    });

    await createAuditLog({
      actorId: req.user.userId,
      action: 'REPORT_PERIOD_PUBLISHED',
      entityType: 'ReportPeriod',
      entityId: period.id,
      branchId: period.batch.branchId,
      metadata: {
        periodId: period.id,
        batchId: period.batchId,
      },
      ip: req.ip || null,
    });

    return res.status(200).json({
      success: true,
      message: 'Report period published successfully',
      data: {
        id: updated.id,
        publishedAt: updated.publishedAt?.toISOString(),
      },
    });
  } catch (error) {
    console.error('Publish report period error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

/**
 * POST /api/report-periods/:id/unpublish
 */
export async function unpublishReportPeriod(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const periodId = req.params.id as string;
    const period = await prisma.reportPeriod.findUnique({
      where: { id: periodId },
      include: {
        batch: { select: { id: true, branchId: true, teacherId: true } },
      },
    });

    if (!period) {
      return res.status(404).json({ success: false, message: 'Report period not found' });
    }

    const access = await verifyBatchStaffAccess(req.user, period.batchId);
    if (!access.allowed) {
      return res.status(access.status).json({ success: false, message: access.message });
    }

    const updated = await prisma.reportPeriod.update({
      where: { id: periodId },
      data: { publishedAt: null },
    });

    await createAuditLog({
      actorId: req.user.userId,
      action: 'REPORT_PERIOD_UNPUBLISHED',
      entityType: 'ReportPeriod',
      entityId: period.id,
      branchId: period.batch.branchId,
      metadata: {
        periodId: period.id,
        batchId: period.batchId,
      },
      ip: req.ip || null,
    });

    return res.status(200).json({
      success: true,
      message: 'Report period unpublished successfully',
      data: {
        id: updated.id,
        publishedAt: null,
      },
    });
  } catch (error) {
    console.error('Unpublish report period error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

/**
 * PUT /api/report-periods/:id/remarks/:studentId
 */
export async function updateReportRemark(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const periodId = req.params.id as string;
    const studentId = req.params.studentId as string;

    const period = await prisma.reportPeriod.findUnique({
      where: { id: periodId },
      include: {
        batch: { select: { id: true, branchId: true, teacherId: true } },
      },
    });

    if (!period) {
      return res.status(404).json({ success: false, message: 'Report period not found' });
    }

    const access = await verifyBatchStaffAccess(req.user, period.batchId);
    if (!access.allowed) {
      return res.status(access.status).json({ success: false, message: access.message });
    }

    // Verify student is enrolled in batch
    const enrollment = await prisma.enrollment.findFirst({
      where: {
        batchId: period.batchId,
        studentId,
      },
    });

    if (!enrollment) {
      return res.status(404).json({
        success: false,
        message: 'Student is not enrolled in this batch',
      });
    }

    const parseResult = updateReportRemarkSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: parseResult.error.flatten(),
      });
    }

    const remark = await prisma.reportRemark.upsert({
      where: {
        periodId_studentId: {
          periodId,
          studentId,
        },
      },
      create: {
        periodId,
        studentId,
        remark: parseResult.data.remark,
        updatedById: req.user.userId,
      },
      update: {
        remark: parseResult.data.remark,
        updatedById: req.user.userId,
      },
    });

    await createAuditLog({
      actorId: req.user.userId,
      action: 'REPORT_REMARK_UPDATED',
      entityType: 'ReportRemark',
      entityId: remark.id,
      branchId: period.batch.branchId,
      metadata: {
        periodId,
        studentId,
      },
      ip: req.ip || null,
    });

    return res.status(200).json({
      success: true,
      message: 'Remark updated successfully',
      data: {
        id: remark.id,
        periodId: remark.periodId,
        studentId: remark.studentId,
        remark: remark.remark,
        updatedAt: remark.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Update report remark error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

/**
 * GET /api/report-periods/:id/cards
 * Staff only: Paginated class roster with each student's computed summary
 */
export async function getReportPeriodCards(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const periodId = req.params.id as string;
    const period = await prisma.reportPeriod.findUnique({
      where: { id: periodId },
      include: {
        batch: { select: { id: true, branchId: true, teacherId: true } },
      },
    });

    if (!period) {
      return res.status(404).json({ success: false, message: 'Report period not found' });
    }

    const access = await verifyBatchStaffAccess(req.user, period.batchId);
    if (!access.allowed) {
      return res.status(access.status).json({ success: false, message: access.message });
    }

    const queryResult = reportPeriodCardsQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: queryResult.error.flatten(),
      });
    }

    const { page, limit } = queryResult.data;
    const data = await computeBatchRosterReportCards(periodId, page, limit);

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Get report period cards error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

/**
 * GET /api/report-periods/:id/cards/:studentId
 * Staff full report card for a single student.
 */
export async function getStudentReportCard(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const periodId = req.params.id as string;
    const studentId = req.params.studentId as string;

    const period = await prisma.reportPeriod.findUnique({
      where: { id: periodId },
      include: {
        batch: { select: { id: true, branchId: true, teacherId: true } },
      },
    });

    if (!period) {
      return res.status(404).json({ success: false, message: 'Report period not found' });
    }

    const access = await verifyBatchStaffAccess(req.user, period.batchId);
    if (!access.allowed) {
      return res.status(access.status).json({ success: false, message: access.message });
    }

    const card = await computeStudentReportCard(period.batchId, periodId, studentId);
    if (!card) {
      return res.status(404).json({
        success: false,
        message: 'Student has no active enrollment in this batch during the period',
      });
    }

    return res.status(200).json({ success: true, data: card });
  } catch (error) {
    console.error('Get student report card error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

/**
 * GET /api/my/report-cards
 * Student & Guardian: list published periods for enrolled batches.
 */
export async function getMyReportCards(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const queryResult = myReportCardsQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return res.status(400).json({ success: false, message: 'Validation failed' });
    }

    let targetStudentId = req.user.userId;
    let linkedChildren: Array<{ id: string; name: string; studentCode: string | null }> = [];

    if (req.user.role === Role.GUARDIAN) {
      const links = await prisma.guardianLink.findMany({
        where: { guardianId: req.user.userId },
        include: {
          student: {
            select: { id: true, name: true, studentCode: true },
          },
        },
      });

      linkedChildren = links.map((l) => ({
        id: l.student.id,
        name: l.student.name,
        studentCode: l.student.studentCode,
      }));

      if (linkedChildren.length === 0) {
        return res.status(200).json({
          success: true,
          data: {
            periods: [],
            linkedChildren: [],
          },
        });
      }

      if (queryResult.data.studentId) {
        const isLinked = linkedChildren.some((c) => c.id === queryResult.data.studentId);
        if (!isLinked) {
          return res.status(403).json({
            success: false,
            message: 'Forbidden: Access denied to unlinked student',
          });
        }
        targetStudentId = queryResult.data.studentId;
      } else {
        targetStudentId = linkedChildren[0].id;
      }
    } else if (req.user.role !== Role.STUDENT) {
      return res.status(403).json({ success: false, message: 'Forbidden: Student or Guardian role required' });
    }

    // Find all batches where student is enrolled
    const enrollments = await prisma.enrollment.findMany({
      where: { studentId: targetStudentId },
      select: { batchId: true },
    });

    const batchIds = enrollments.map((e) => e.batchId);

    // Published report periods only
    const periods = await prisma.reportPeriod.findMany({
      where: {
        batchId: { in: batchIds },
        publishedAt: { not: null },
      },
      include: {
        batch: { select: { id: true, name: true } },
      },
      orderBy: { from: 'desc' },
    });

    const data = periods.map((p) => ({
      id: p.id,
      batchId: p.batchId,
      batchName: p.batch.name,
      label: p.label,
      from: p.from.toISOString().slice(0, 10),
      to: p.to.toISOString().slice(0, 10),
      publishedAt: p.publishedAt ? p.publishedAt.toISOString() : null,
    }));

    return res.status(200).json({
      success: true,
      data: {
        periods: data,
        linkedChildren: req.user.role === Role.GUARDIAN ? linkedChildren : undefined,
        currentStudentId: targetStudentId,
      },
    });
  } catch (error) {
    console.error('Get my report cards error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

/**
 * GET /api/my/report-cards/:periodId
 * Student & Guardian: Full report card for a published period.
 */
export async function getMyReportCardById(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const periodId = req.params.periodId as string;
    const period = await prisma.reportPeriod.findUnique({
      where: { id: periodId },
      select: { id: true, batchId: true, publishedAt: true },
    });

    if (!period || period.publishedAt === null) {
      return res.status(404).json({
        success: false,
        message: 'Report period not found or not published',
      });
    }

    let targetStudentId = req.user.userId;

    if (req.user.role === Role.GUARDIAN) {
      const studentId = req.query.studentId as string;
      if (!studentId) {
        return res.status(400).json({
          success: false,
          message: 'studentId query parameter is required for guardians',
        });
      }

      const link = await prisma.guardianLink.findUnique({
        where: {
          guardianId_studentId: {
            guardianId: req.user.userId,
            studentId,
          },
        },
      });

      if (!link) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: Access denied to unlinked student',
        });
      }
      targetStudentId = studentId;
    } else if (req.user.role !== Role.STUDENT) {
      return res.status(403).json({ success: false, message: 'Forbidden: Student or Guardian role required' });
    }

    const card = await computeStudentReportCard(period.batchId, periodId, targetStudentId);
    if (!card) {
      return res.status(404).json({
        success: false,
        message: 'No enrollment found for this student in this batch during the period',
      });
    }

    return res.status(200).json({ success: true, data: card });
  } catch (error) {
    console.error('Get my report card by id error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

