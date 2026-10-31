import { Request, Response } from 'express';
import { Prisma, Role, EnquiryStage, EnquiryNoteKind, EnrollmentStatus, FeeChargeKind } from '@prisma/client';
import bcrypt from 'bcrypt';
import prisma from '../utils/prisma';
import { parsePagination, buildMeta } from '../utils/pagination';
import { normalizePhone } from '../utils/phone';
import { generateTemporaryPassword } from '../utils/temp-password';
import { generateStudentCode } from '../utils/student-code';
import { createAuditLog } from '../utils/audit';
import { roundMoney, formatMoney } from '../utils/money';
import {
  enquiryQuerySchema,
  createEnquirySchema,
  updateEnquirySchema,
  createEnquiryNoteSchema,
  duplicateQuerySchema,
  convertEnquirySchema,
  enquiryIdParamSchema,
} from '../validators/enquiry.validator';

function maskName(name: string): string {
  if (!name) return '***';
  return name
    .split(' ')
    .filter(Boolean)
    .map((part) => (part.length <= 1 ? part : part[0] + '*'.repeat(Math.min(part.length - 1, 4))))
    .join(' ');
}

function maskId(id: string): string {
  if (!id) return '***';
  if (id.length <= 6) return id.slice(0, 2) + '***';
  return id.slice(0, 4) + '***' + id.slice(-2);
}

function sanitizeCsvField(val: any): string {
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
 * GET /api/enquiries
 * Scoped to ADMIN's branch; SUPER_ADMIN can see all or filter by branch.
 * Supports filters: stage, source, branch, assignedTo, q (name or phone), followUp (today|overdue|none), date range.
 * Supports format=csv (capped at 5000, audit logged).
 */
export async function getEnquiries(req: Request, res: Response) {
  try {
    const userRole = req.user?.role;
    const userBranchId = req.user?.branchId;

    if (userRole !== Role.ADMIN && userRole !== Role.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Forbidden: Insufficient privileges' });
    }

    const parseResult = enquiryQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        data: parseResult.error.flatten(),
      });
    }

    const {
      page,
      limit,
      stage,
      source,
      branchId,
      assignedToId,
      q,
      followUp,
      dateFrom,
      dateTo,
      sort,
      format,
    } = parseResult.data;

    const where: Prisma.ContactMessageWhereInput = {};

    // Branch scoping
    if (userRole === Role.ADMIN) {
      if (!userBranchId) {
        return res.status(403).json({ success: false, message: 'Admin is not associated with any branch' });
      }
      where.branchId = userBranchId;
    } else if (userRole === Role.SUPER_ADMIN && branchId) {
      where.branchId = branchId;
    }

    if (stage) {
      where.stage = stage;
    }

    if (source) {
      where.source = source;
    }

    if (assignedToId) {
      where.assignedToId = assignedToId;
    }

    if (q && q.trim().length > 0) {
      const qTrim = q.trim();
      const normQPhone = normalizePhone(qTrim);
      where.OR = [
        { name: { contains: qTrim, mode: 'insensitive' } },
        { phone: { contains: normQPhone || qTrim } },
      ];
    }

    // Follow-up filtering
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    if (followUp === 'today') {
      where.followUpAt = {
        gte: startOfToday,
        lte: endOfToday,
      };
    } else if (followUp === 'overdue') {
      where.followUpAt = {
        lt: startOfToday,
      };
      where.stage = {
        notIn: [EnquiryStage.ADMITTED, EnquiryStage.LOST],
      };
    } else if (followUp === 'none') {
      where.followUpAt = null;
    }

    // Date range filtering (createdAt)
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) {
        where.createdAt.gte = new Date(dateFrom);
      }
      if (dateTo) {
        const dTo = new Date(dateTo);
        dTo.setHours(23, 59, 59, 999);
        where.createdAt.lte = dTo;
      }
    }

    // Ordering
    let orderBy: Prisma.ContactMessageOrderByWithRelationInput = { createdAt: 'desc' };
    if (sort === 'followUp') {
      orderBy = { followUpAt: 'asc' };
    }

    // CSV format handling
    if (format === 'csv') {
      const exportRows = await prisma.contactMessage.findMany({
        where,
        take: 5000,
        orderBy,
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          guardianName: true,
          source: true,
          stage: true,
          lostReason: true,
          followUpAt: true,
          createdAt: true,
          branch: { select: { name: true } },
          assignedTo: { select: { name: true } },
          interestedBatch: { select: { name: true } },
        },
      });

      // Audit log the CSV export
      await createAuditLog({
        actorId: req.user!.userId,
        action: 'ENQUIRIES_EXPORT_CSV',
        entityType: 'ContactMessage',
        branchId: userRole === Role.ADMIN ? userBranchId : (branchId || null),
        metadata: { rowCount: exportRows.length },
      });

      const headers = [
        'ID',
        'Name',
        'Phone',
        'Email',
        'Guardian Name',
        'Source',
        'Stage',
        'Branch',
        'Assigned To',
        'Interested Batch',
        'Follow Up Date',
        'Lost Reason',
        'Created At',
      ];

      const lines = exportRows.map((r) => [
        sanitizeCsvField(r.id),
        sanitizeCsvField(r.name),
        sanitizeCsvField(r.phone),
        sanitizeCsvField(r.email),
        sanitizeCsvField(r.guardianName),
        sanitizeCsvField(r.source),
        sanitizeCsvField(r.stage),
        sanitizeCsvField(r.branch?.name),
        sanitizeCsvField(r.assignedTo?.name),
        sanitizeCsvField(r.interestedBatch?.name),
        sanitizeCsvField(r.followUpAt ? r.followUpAt.toISOString() : ''),
        sanitizeCsvField(r.lostReason),
        sanitizeCsvField(r.createdAt.toISOString()),
      ].join(','));

      const csvContent = '\uFEFF' + [headers.join(','), ...lines].join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="enquiries.csv"');
      return res.status(200).send(csvContent);
    }

    // Paginated list
    const { skip, take } = parsePagination({ page, limit }, { defaultLimit: 15, maxLimit: 50 });
    const [total, items] = await Promise.all([
      prisma.contactMessage.count({ where }),
      prisma.contactMessage.findMany({
        where,
        skip,
        take,
        orderBy,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          guardianName: true,
          subject: true,
          message: true,
          source: true,
          stage: true,
          followUpAt: true,
          lostReason: true,
          branchId: true,
          branch: { select: { id: true, name: true } },
          preferredBranchId: true,
          preferredBranch: { select: { id: true, name: true } },
          assignedToId: true,
          assignedTo: { select: { id: true, name: true } },
          interestedBatchId: true,
          interestedBatch: { select: { id: true, name: true } },
          interestedGrade: true,
          convertedStudentId: true,
          createdAt: true,
          _count: { select: { notes: true } },
        },
      }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        items,
        pagination: buildMeta(total, page, take),
      },
    });
  } catch (error) {
    console.error('Error fetching enquiries:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve enquiries' });
  }
}

/**
 * POST /api/enquiries
 * Staff entry for walk-in or phone enquiries.
 */
export async function createEnquiry(req: Request, res: Response) {
  try {
    const userRole = req.user?.role;
    const userBranchId = req.user?.branchId;

    if (userRole !== Role.ADMIN && userRole !== Role.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Forbidden: Insufficient privileges' });
    }

    const parseResult = createEnquirySchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const data = parseResult.data;
    const normPhone = normalizePhone(data.phone);

    // Determine branch
    let targetBranchId: string | null = null;
    if (userRole === Role.SUPER_ADMIN) {
      targetBranchId = data.branchId && data.branchId.trim().length > 0 ? data.branchId.trim() : null;
    } else {
      targetBranchId = userBranchId || null;
    }

    // If batch provided, verify it belongs to the branch
    if (data.interestedBatchId && data.interestedBatchId.trim().length > 0) {
      const batch = await prisma.batch.findUnique({
        where: { id: data.interestedBatchId.trim() },
        select: { id: true, branchId: true },
      });
      if (batch && targetBranchId && batch.branchId !== targetBranchId) {
        return res.status(400).json({ success: false, message: 'Interested batch belongs to a different branch' });
      }
      if (batch && !targetBranchId) {
        targetBranchId = batch.branchId;
      }
    }

    // Auto branch if exactly 1 branch in system
    if (!targetBranchId) {
      const branchCount = await prisma.branch.count();
      if (branchCount === 1) {
        const singleBranch = await prisma.branch.findFirst({ select: { id: true } });
        if (singleBranch) targetBranchId = singleBranch.id;
      }
    }

    const assignedToIdToSet = data.assignedToId && data.assignedToId.trim().length > 0 ? data.assignedToId.trim() : null;
    if (assignedToIdToSet) {
      const staff = await prisma.user.findUnique({
        where: { id: assignedToIdToSet },
        select: { id: true, branchId: true, role: true },
      });
      if (!staff || (targetBranchId && staff.branchId !== targetBranchId && staff.role !== Role.SUPER_ADMIN)) {
        return res.status(400).json({ success: false, message: 'Assignee does not belong to the enquiry branch' });
      }
    }

    const enquiry = await prisma.contactMessage.create({
      data: {
        name: data.name.trim(),
        phone: normPhone,
        email: data.email && data.email.trim().length > 0 ? data.email.trim() : null,
        guardianName: data.guardianName && data.guardianName.trim().length > 0 ? data.guardianName.trim() : null,
        source: data.source || 'WALK_IN',
        stage: data.stage || EnquiryStage.NEW,
        interestedBatchId: data.interestedBatchId && data.interestedBatchId.trim().length > 0 ? data.interestedBatchId.trim() : null,
        interestedGrade: data.interestedGrade && data.interestedGrade.trim().length > 0 ? data.interestedGrade.trim() : null,
        message: data.message && data.message.trim().length > 0 ? data.message.trim() : null,
        assignedToId: assignedToIdToSet,
        followUpAt: data.followUpAt && data.followUpAt.trim().length > 0 ? new Date(data.followUpAt) : null,
        branchId: targetBranchId,
      },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        stage: true,
        source: true,
        branchId: true,
        assignedToId: true,
        followUpAt: true,
        createdAt: true,
      },
    });

    // Notify assignee if assigned
    if (assignedToIdToSet) {
      await prisma.notification.create({
        data: {
          userId: assignedToIdToSet,
          type: 'ENQUIRY_ASSIGNED',
          title: 'Enquiry Assigned',
          body: `You have been assigned to enquiry for ${enquiry.name}`,
          entityType: 'Enquiry',
          entityId: enquiry.id,
        },
      });
    }

    // Audit log
    await createAuditLog({
      actorId: req.user!.userId,
      action: 'ENQUIRY_CREATE',
      entityType: 'ContactMessage',
      entityId: enquiry.id,
      branchId: targetBranchId,
      metadata: { enquiryId: enquiry.id, stage: enquiry.stage, source: enquiry.source },
    });

    return res.status(201).json({
      success: true,
      message: 'Enquiry created successfully',
      data: enquiry,
    });
  } catch (error) {
    console.error('Error creating enquiry:', error);
    return res.status(500).json({ success: false, message: 'Failed to create enquiry' });
  }
}

/**
 * GET /api/enquiries/:id
 * Retrieves enquiry details, notes timeline, and converted student info.
 */
export async function getEnquiryById(req: Request, res: Response) {
  try {
    const userRole = req.user?.role;
    const userBranchId = req.user?.branchId;

    if (userRole !== Role.ADMIN && userRole !== Role.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Forbidden: Insufficient privileges' });
    }

    const paramResult = enquiryIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      return res.status(400).json({ success: false, message: 'Invalid enquiry ID' });
    }

    const { id } = paramResult.data;

    const enquiry = await prisma.contactMessage.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        guardianName: true,
        subject: true,
        message: true,
        source: true,
        stage: true,
        followUpAt: true,
        lostReason: true,
        branchId: true,
        branch: { select: { id: true, name: true } },
        preferredBranchId: true,
        preferredBranch: { select: { id: true, name: true } },
        assignedToId: true,
        assignedTo: { select: { id: true, name: true, role: true } },
        interestedBatchId: true,
        interestedBatch: { select: { id: true, name: true, branchId: true } },
        interestedGrade: true,
        convertedStudentId: true,
        convertedStudent: {
          select: {
            id: true,
            name: true,
            studentCode: true,
            phone: true,
            email: true,
          },
        },
        createdAt: true,
        notes: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            kind: true,
            body: true,
            createdAt: true,
            author: { select: { id: true, name: true, role: true } },
          },
        },
      },
    });

    if (!enquiry) {
      return res.status(404).json({ success: false, message: 'Enquiry not found' });
    }

    // Role scoping
    if (userRole === Role.ADMIN) {
      if (enquiry.branchId && enquiry.branchId !== userBranchId) {
        return res.status(403).json({ success: false, message: 'Forbidden: Enquiry belongs to another branch' });
      }
      if (!enquiry.branchId) {
        return res.status(403).json({ success: false, message: 'Forbidden: Unassigned enquiry visible to Super Admin only' });
      }
    }

    return res.status(200).json({
      success: true,
      data: enquiry,
    });
  } catch (error) {
    console.error('Error fetching enquiry by ID:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve enquiry' });
  }
}

/**
 * PATCH /api/enquiries/:id
 * Update enquiry stage, followUpAt, assignedToId, branchId (SUPER_ADMIN only), contact details.
 */
export async function updateEnquiry(req: Request, res: Response) {
  try {
    const userRole = req.user?.role;
    const userBranchId = req.user?.branchId;

    if (userRole !== Role.ADMIN && userRole !== Role.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Forbidden: Insufficient privileges' });
    }

    const paramResult = enquiryIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      return res.status(400).json({ success: false, message: 'Invalid enquiry ID' });
    }

    const bodyResult = updateEnquirySchema.safeParse(req.body);
    if (!bodyResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: bodyResult.error.flatten(),
      });
    }

    const { id } = paramResult.data;
    const existing = await prisma.contactMessage.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        branchId: true,
        assignedToId: true,
        stage: true,
      },
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Enquiry not found' });
    }

    if (userRole === Role.ADMIN) {
      if (existing.branchId && existing.branchId !== userBranchId) {
        return res.status(403).json({ success: false, message: 'Forbidden: Enquiry belongs to another branch' });
      }
      if (!existing.branchId) {
        return res.status(403).json({ success: false, message: 'Forbidden: Unassigned enquiry' });
      }
    }

    const data = bodyResult.data;
    const updateData: Prisma.ContactMessageUpdateInput = {};

    if (data.name !== undefined) updateData.name = data.name.trim();
    if (data.phone !== undefined) updateData.phone = normalizePhone(data.phone);
    if (data.email !== undefined) updateData.email = data.email && data.email.trim().length > 0 ? data.email.trim() : null;
    if (data.guardianName !== undefined) updateData.guardianName = data.guardianName && data.guardianName.trim().length > 0 ? data.guardianName.trim() : null;
    if (data.source !== undefined) updateData.source = data.source;
    if (data.message !== undefined) updateData.message = data.message && data.message.trim().length > 0 ? data.message.trim() : null;
    if (data.interestedGrade !== undefined) updateData.interestedGrade = data.interestedGrade && data.interestedGrade.trim().length > 0 ? data.interestedGrade.trim() : null;

    if (data.interestedBatchId !== undefined) {
      updateData.interestedBatch = data.interestedBatchId && data.interestedBatchId.trim().length > 0
        ? { connect: { id: data.interestedBatchId.trim() } }
        : { disconnect: true };
    }

    if (data.stage !== undefined) {
      updateData.stage = data.stage;
      if (data.stage === EnquiryStage.LOST) {
        updateData.lostReason = data.lostReason?.trim() || null;
      }
    }

    if (data.followUpAt !== undefined) {
      updateData.followUpAt = data.followUpAt && data.followUpAt.trim().length > 0 ? new Date(data.followUpAt) : null;
    }

    // Branch assignment: SUPER_ADMIN only
    let currentEffectiveBranchId = existing.branchId;
    if (userRole === Role.SUPER_ADMIN && data.branchId !== undefined) {
      const bId = data.branchId && data.branchId.trim().length > 0 ? data.branchId.trim() : null;
      if (bId) {
        const branchExists = await prisma.branch.findUnique({ where: { id: bId }, select: { id: true } });
        if (!branchExists) {
          return res.status(400).json({ success: false, message: 'Branch not found' });
        }
        updateData.branch = { connect: { id: bId } };
        currentEffectiveBranchId = bId;
      } else {
        updateData.branch = { disconnect: true };
        currentEffectiveBranchId = null;
      }
    }

    // Assignee update
    let newAssignedToId: string | null = null;
    if (data.assignedToId !== undefined) {
      const aId = data.assignedToId && data.assignedToId.trim().length > 0 ? data.assignedToId.trim() : null;
      if (aId) {
        const staff = await prisma.user.findUnique({
          where: { id: aId },
          select: { id: true, branchId: true, role: true },
        });
        if (!staff) {
          return res.status(400).json({ success: false, message: 'Assignee user not found' });
        }
        if (currentEffectiveBranchId && staff.branchId !== currentEffectiveBranchId && staff.role !== Role.SUPER_ADMIN) {
          return res.status(400).json({ success: false, message: 'Assignee does not belong to the enquiry branch' });
        }
        updateData.assignedTo = { connect: { id: aId } };
        newAssignedToId = aId;
      } else {
        updateData.assignedTo = { disconnect: true };
      }
    }

    const updated = await prisma.contactMessage.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        stage: true,
        branchId: true,
        assignedToId: true,
        followUpAt: true,
        lostReason: true,
      },
    });

    // Notify assignee if changed
    if (newAssignedToId && newAssignedToId !== existing.assignedToId) {
      await prisma.notification.create({
        data: {
          userId: newAssignedToId,
          type: 'ENQUIRY_ASSIGNED',
          title: 'Enquiry Assigned',
          body: `You have been assigned to enquiry for ${existing.name}`,
          entityType: 'Enquiry',
          entityId: existing.id,
        },
      });
    }

    // Audit log
    await createAuditLog({
      actorId: req.user!.userId,
      action: data.stage && data.stage !== existing.stage ? 'ENQUIRY_STAGE_CHANGE' : 'ENQUIRY_UPDATE',
      entityType: 'ContactMessage',
      entityId: existing.id,
      branchId: updated.branchId,
      metadata: {
        enquiryId: existing.id,
        stage: updated.stage,
        assignedToId: updated.assignedToId,
        fieldsUpdated: Object.keys(data),
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Enquiry updated successfully',
      data: updated,
    });
  } catch (error) {
    console.error('Error updating enquiry:', error);
    return res.status(500).json({ success: false, message: 'Failed to update enquiry' });
  }
}

/**
 * POST /api/enquiries/:id/notes
 * Add note/call log/visit log to an enquiry.
 */
export async function addEnquiryNote(req: Request, res: Response) {
  try {
    const userRole = req.user?.role;
    const userBranchId = req.user?.branchId;

    if (userRole !== Role.ADMIN && userRole !== Role.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Forbidden: Insufficient privileges' });
    }

    const paramResult = enquiryIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      return res.status(400).json({ success: false, message: 'Invalid enquiry ID' });
    }

    const bodyResult = createEnquiryNoteSchema.safeParse(req.body);
    if (!bodyResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: bodyResult.error.flatten(),
      });
    }

    const { id } = paramResult.data;
    const enquiry = await prisma.contactMessage.findUnique({
      where: { id },
      select: { id: true, branchId: true },
    });

    if (!enquiry) {
      return res.status(404).json({ success: false, message: 'Enquiry not found' });
    }

    if (userRole === Role.ADMIN && enquiry.branchId !== userBranchId) {
      return res.status(403).json({ success: false, message: 'Forbidden: Enquiry belongs to another branch' });
    }

    const { kind, body } = bodyResult.data;
    const note = await prisma.enquiryNote.create({
      data: {
        enquiryId: enquiry.id,
        authorId: req.user!.userId,
        kind,
        body,
      },
      select: {
        id: true,
        kind: true,
        body: true,
        createdAt: true,
        author: { select: { id: true, name: true, role: true } },
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Note added successfully',
      data: note,
    });
  } catch (error) {
    console.error('Error adding enquiry note:', error);
    return res.status(500).json({ success: false, message: 'Failed to add note' });
  }
}

/**
 * GET /api/enquiries/duplicates?phone=
 * Checks for existing users and enquiries with matching normalized phone number. Names are masked.
 */
export async function getDuplicateEnquiries(req: Request, res: Response) {
  try {
    const userRole = req.user?.role;
    if (userRole !== Role.ADMIN && userRole !== Role.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Forbidden: Insufficient privileges' });
    }

    const parseResult = duplicateQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required',
        data: parseResult.error.flatten(),
      });
    }

    const normPhone = normalizePhone(parseResult.data.phone);
    if (!normPhone) {
      return res.status(400).json({ success: false, message: 'Invalid phone number format' });
    }

    const [matchingUsers, matchingEnquiries] = await Promise.all([
      prisma.user.findMany({
        where: { phone: normPhone },
        select: {
          id: true,
          name: true,
          role: true,
          studentCode: true,
          branch: { select: { id: true, name: true } },
        },
      }),
      prisma.contactMessage.findMany({
        where: { phone: normPhone },
        select: {
          id: true,
          name: true,
          stage: true,
          createdAt: true,
          branch: { select: { id: true, name: true } },
        },
      }),
    ]);

    const maskedUsers = matchingUsers.map((u) => ({
      id: maskId(u.id),
      name: maskName(u.name),
      role: u.role,
      studentCode: u.studentCode,
      branchName: u.branch?.name,
    }));

    const maskedEnquiries = matchingEnquiries.map((e) => ({
      id: e.id,
      name: maskName(e.name),
      stage: e.stage,
      branchName: e.branch?.name,
      createdAt: e.createdAt,
    }));

    return res.status(200).json({
      success: true,
      data: {
        users: maskedUsers,
        enquiries: maskedEnquiries,
      },
    });
  } catch (error) {
    console.error('Error checking duplicate phone:', error);
    return res.status(500).json({ success: false, message: 'Failed to check duplicates' });
  }
}

/**
 * GET /api/enquiries/summary
 * Counts by stage, new in last 7 days, follow-ups due today and overdue, conversion rate and counts by source for last 90 days.
 */
export async function getEnquiriesSummary(req: Request, res: Response) {
  try {
    const userRole = req.user?.role;
    const userBranchId = req.user?.branchId;

    if (userRole !== Role.ADMIN && userRole !== Role.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Forbidden: Insufficient privileges' });
    }

    const branchFilter = req.query.branchId as string | undefined;
    const baseWhere: Prisma.ContactMessageWhereInput = {};
    if (userRole === Role.ADMIN) {
      if (!userBranchId) {
        return res.status(403).json({ success: false, message: 'Admin is not associated with any branch' });
      }
      baseWhere.branchId = userBranchId;
    } else if (userRole === Role.SUPER_ADMIN && branchFilter) {
      baseWhere.branchId = branchFilter;
    }

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const [
      stageGroups,
      newLast7Days,
      followUpsToday,
      followUpsOverdue,
      last90DaysEnquiries,
    ] = await Promise.all([
      prisma.contactMessage.groupBy({
        by: ['stage'],
        where: baseWhere,
        _count: { stage: true },
      }),
      prisma.contactMessage.count({
        where: {
          ...baseWhere,
          createdAt: { gte: sevenDaysAgo },
        },
      }),
      prisma.contactMessage.count({
        where: {
          ...baseWhere,
          followUpAt: { gte: startOfToday, lte: endOfToday },
        },
      }),
      prisma.contactMessage.count({
        where: {
          ...baseWhere,
          followUpAt: { lt: startOfToday },
          stage: { notIn: [EnquiryStage.ADMITTED, EnquiryStage.LOST] },
        },
      }),
      prisma.contactMessage.findMany({
        where: {
          ...baseWhere,
          createdAt: { gte: ninetyDaysAgo },
        },
        select: {
          stage: true,
          source: true,
        },
      }),
    ]);

    // Build stage counts object
    const stages: Record<string, number> = {
      NEW: 0,
      CONTACTED: 0,
      VISIT_SCHEDULED: 0,
      TRIAL: 0,
      ADMITTED: 0,
      LOST: 0,
    };
    for (const g of stageGroups) {
      stages[g.stage] = g._count.stage;
    }

    // 90-day conversion rate and source distribution
    const totalLast90 = last90DaysEnquiries.length;
    const admittedLast90 = last90DaysEnquiries.filter((e) => e.stage === EnquiryStage.ADMITTED).length;
    const conversionRatePct = totalLast90 > 0 ? Math.round((admittedLast90 / totalLast90) * 1000) / 10 : 0;

    const sourceCounts: Record<string, number> = {};
    for (const e of last90DaysEnquiries) {
      const src = e.source || 'WEBSITE';
      sourceCounts[src] = (sourceCounts[src] || 0) + 1;
    }

    return res.status(200).json({
      success: true,
      data: {
        stages,
        newLast7Days,
        followUpsToday,
        followUpsOverdue,
        last90Days: {
          total: totalLast90,
          admitted: admittedLast90,
          conversionRate: `${conversionRatePct}%`,
          conversionRatePct,
          sourceCounts,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching enquiries summary:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve enquiries summary' });
  }
}

/**
 * POST /api/enquiries/:id/convert
 * Atomic transaction to convert enquiry to enrolled student:
 * - Create student user with studentCode & temporary password
 * - Find/create guardian & link
 * - Create active enrollment in batch
 * - Optionally create ADMISSION fee charge
 * - Update enquiry to ADMITTED with convertedStudentId
 */
export async function convertEnquiry(req: Request, res: Response) {
  try {
    const userRole = req.user?.role;
    const userBranchId = req.user?.branchId;

    if (userRole !== Role.ADMIN && userRole !== Role.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Forbidden: Insufficient privileges' });
    }

    const paramResult = enquiryIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      return res.status(400).json({ success: false, message: 'Invalid enquiry ID' });
    }

    const bodyResult = convertEnquirySchema.safeParse(req.body);
    if (!bodyResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: bodyResult.error.flatten(),
      });
    }

    const { id } = paramResult.data;
    const { name, phone, email, batchId, guardian, admissionFee } = bodyResult.data;

    const normPhone = normalizePhone(phone);
    if (!normPhone) {
      return res.status(400).json({ success: false, message: 'Invalid student phone number' });
    }

    // Pre-check outside transaction to fast-fail on existing user phone
    const existingUserPhone = await prisma.user.findUnique({
      where: { phone: normPhone },
      select: { id: true },
    });
    if (existingUserPhone) {
      return res.status(409).json({
        success: false,
        message: 'A user with this phone number already exists',
        data: { existingUserId: maskId(existingUserPhone.id) },
      });
    }

    if (email && email.trim().length > 0) {
      const existingUserEmail = await prisma.user.findUnique({
        where: { email: email.trim().toLowerCase() },
        select: { id: true },
      });
      if (existingUserEmail) {
        return res.status(409).json({
          success: false,
          message: 'A user with this email address already exists',
        });
      }
    }

    // Verify enquiry
    const enquiry = await prisma.contactMessage.findUnique({
      where: { id },
      select: {
        id: true,
        branchId: true,
        stage: true,
        convertedStudentId: true,
      },
    });

    if (!enquiry) {
      return res.status(404).json({ success: false, message: 'Enquiry not found' });
    }

    if (enquiry.stage === EnquiryStage.ADMITTED || enquiry.convertedStudentId) {
      return res.status(409).json({
        success: false,
        message: 'Enquiry has already been converted to a student',
      });
    }

    if (userRole === Role.ADMIN) {
      if (enquiry.branchId && enquiry.branchId !== userBranchId) {
        return res.status(403).json({ success: false, message: 'Forbidden: Enquiry belongs to another branch' });
      }
    }

    // Verify batch
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      select: { id: true, name: true, branchId: true, archivedAt: true, isPublished: true },
    });

    if (!batch) {
      return res.status(404).json({ success: false, message: 'Batch not found' });
    }

    if (batch.archivedAt !== null) {
      return res.status(400).json({ success: false, message: 'Cannot enroll into an archived batch' });
    }

    const branchIdToUse = batch.branchId;
    if (userRole === Role.ADMIN && branchIdToUse !== userBranchId) {
      return res.status(403).json({ success: false, message: 'Forbidden: Batch belongs to another branch' });
    }

    // Execute atomic conversion transaction
    const studentTempPassword = generateTemporaryPassword(14);
    const hashedStudentPassword = await bcrypt.hash(studentTempPassword, 10);

    let guardianTempPassword: string | undefined;

    const result = await prisma.$transaction(async (tx) => {
      // Re-check inside transaction
      const doubleCheckEnquiry = await tx.contactMessage.findUnique({
        where: { id: enquiry.id },
        select: { stage: true, convertedStudentId: true },
      });
      if (doubleCheckEnquiry?.stage === EnquiryStage.ADMITTED || doubleCheckEnquiry?.convertedStudentId) {
        throw new Error('ALREADY_ADMITTED');
      }

      const duplicatePhoneCheck = await tx.user.findUnique({
        where: { phone: normPhone },
        select: { id: true },
      });
      if (duplicatePhoneCheck) {
        throw new Error('DUPLICATE_PHONE');
      }

      // Generate student code
      const studentCode = await generateStudentCode(tx, branchIdToUse);

      // Create student user
      const student = await tx.user.create({
        data: {
          name: name.trim(),
          phone: normPhone,
          email: email && email.trim().length > 0 ? email.trim().toLowerCase() : null,
          studentCode,
          password: hashedStudentPassword,
          role: Role.STUDENT,
          branchId: branchIdToUse,
          mustChangePassword: true,
          isActive: true,
          guardianName: guardian?.name?.trim() || null,
          guardianPhone: guardian?.phone ? normalizePhone(guardian.phone) : null,
        },
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          studentCode: true,
          branchId: true,
        },
      });

      // Guardian find or create
      let guardianInfo: { id: string; name: string; phone: string | null; isNew: boolean } | null = null;
      const normGuardianPhone = guardian?.phone ? normalizePhone(guardian.phone) : null;
      if (normGuardianPhone) {
        let guardianUser = await tx.user.findUnique({
          where: { phone: normGuardianPhone },
          select: { id: true, name: true, phone: true },
        });

        let isNewGuardian = false;
        if (!guardianUser) {
          isNewGuardian = true;
          guardianTempPassword = generateTemporaryPassword(14);
          const hashedGuardianPassword = await bcrypt.hash(guardianTempPassword, 10);
          guardianUser = await tx.user.create({
            data: {
              name: guardian?.name?.trim() || `Guardian of ${student.name}`,
              phone: normGuardianPhone,
              password: hashedGuardianPassword,
              role: Role.GUARDIAN,
              branchId: branchIdToUse,
              mustChangePassword: true,
              isActive: true,
            },
            select: { id: true, name: true, phone: true },
          });
        }

        // Link guardian
        await tx.guardianLink.upsert({
          where: {
            guardianId_studentId: {
              guardianId: guardianUser.id,
              studentId: student.id,
            },
          },
          update: {},
          create: {
            guardianId: guardianUser.id,
            studentId: student.id,
          },
        });

        guardianInfo = {
          id: guardianUser.id,
          name: guardianUser.name,
          phone: guardianUser.phone,
          isNew: isNewGuardian,
        };
      }

      // Create enrollment
      const enrollment = await tx.enrollment.upsert({
        where: {
          studentId_batchId: {
            studentId: student.id,
            batchId: batch.id,
          },
        },
        update: { status: EnrollmentStatus.ACTIVE },
        create: {
          studentId: student.id,
          batchId: batch.id,
          status: EnrollmentStatus.ACTIVE,
        },
        select: { id: true, batchId: true, status: true },
      });

      // Optional admission fee charge
      let feeChargeInfo: { id: string; amount: string } | null = null;
      if (admissionFee && parseFloat(admissionFee) > 0) {
        const roundedAmount = roundMoney(admissionFee);
        const charge = await tx.feeCharge.create({
          data: {
            branchId: branchIdToUse,
            studentId: student.id,
            batchId: batch.id,
            enrollmentId: enrollment.id,
            kind: FeeChargeKind.ADMISSION,
            description: `Admission fee for ${batch.name}`,
            amount: roundedAmount,
            dueDate: new Date(),
            source: 'MANUAL',
            status: 'ACTIVE',
            createdById: req.user!.userId,
          },
          select: { id: true, amount: true },
        });
        feeChargeInfo = { id: charge.id, amount: formatMoney(charge.amount) };
      }

      // Update enquiry status
      await tx.contactMessage.update({
        where: { id: enquiry.id },
        data: {
          stage: EnquiryStage.ADMITTED,
          convertedStudentId: student.id,
          branchId: branchIdToUse,
        },
      });

      return {
        student,
        guardian: guardianInfo,
        enrollment,
        feeCharge: feeChargeInfo,
      };
    });

    // Audit log (never log sensitive passwords or phone numbers)
    await createAuditLog({
      actorId: req.user!.userId,
      action: 'ENQUIRY_CONVERT',
      entityType: 'ContactMessage',
      entityId: enquiry.id,
      branchId: branchIdToUse,
      metadata: {
        enquiryId: enquiry.id,
        studentId: result.student.id,
        studentCode: result.student.studentCode,
        batchId: batch.id,
        hasAdmissionCharge: Boolean(result.feeCharge),
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Student admitted and enrolled successfully',
      data: {
        student: {
          id: result.student.id,
          name: result.student.name,
          studentCode: result.student.studentCode,
          phone: result.student.phone,
          temporaryPassword: studentTempPassword,
        },
        guardian: result.guardian
          ? {
              ...result.guardian,
              temporaryPassword: guardianTempPassword,
            }
          : null,
        enrollment: result.enrollment,
        feeCharge: result.feeCharge,
      },
    });
  } catch (error: any) {
    if (error.message === 'ALREADY_ADMITTED') {
      return res.status(409).json({ success: false, message: 'Enquiry has already been converted to a student' });
    }
    if (error.message === 'DUPLICATE_PHONE') {
      return res.status(409).json({ success: false, message: 'A user with this phone number already exists' });
    }
    console.error('Error converting enquiry:', error);
    return res.status(500).json({ success: false, message: 'Failed to convert enquiry' });
  }
}
