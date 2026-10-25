import { Request, Response } from 'express';
import { Role, EnrollmentStatus, AssignmentMode, AssignmentSubmissionStatus, Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import {
  createAssignmentSchema,
  updateAssignmentSchema,
  submitAssignmentSchema,
  gradeSubmissionSchema,
  offlineBulkMarksSchema,
} from '../validators/assignment.validator';
import { parsePagination, buildMeta } from '../utils/pagination';
import { createAuditLog } from '../utils/audit';
import { sendAcademicNotification } from '../services/notification.service';
import { ATTACHMENT_CONFIG } from '../config/academics.config';

export async function createAssignment(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const parseResult = createAssignmentSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const {
      batchId,
      subjectId,
      lectureId,
      title,
      instructions,
      dueAt,
      maxMarks,
      mode,
      allowLate,
      publishNow,
    } = parseResult.data;

    // Check batch and scoping
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      include: { branch: true },
    });

    if (!batch) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found',
      });
    }

    if (req.user.role === Role.ADMIN && batch.branchId !== req.user.branchId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Batch belongs to another branch',
      });
    }

    if (req.user.role === Role.TEACHER && batch.teacherId !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only create assignments for batches you teach',
      });
    }

    if (req.user.role === Role.STUDENT || req.user.role === Role.GUARDIAN) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Students and guardians cannot create assignments',
      });
    }

    // Verify lecture if provided
    if (lectureId) {
      const lecture = await prisma.lecture.findUnique({
        where: { id: lectureId },
      });
      if (!lecture || lecture.batchId !== batchId) {
        return res.status(400).json({
          success: false,
          message: 'Lecture not found or does not belong to this batch',
        });
      }
    }

    const dueAtDate = new Date(dueAt);
    const publishedAt = publishNow ? new Date() : null;

    const assignment = await prisma.assignment.create({
      data: {
        batchId,
        subjectId: subjectId || batch.subjectId,
        lectureId: lectureId || null,
        title,
        instructions,
        dueAt: dueAtDate,
        maxMarks: new Prisma.Decimal(maxMarks),
        mode,
        allowLate: allowLate || false,
        publishedAt,
        createdById: req.user.userId,
      },
      select: {
        id: true,
        batchId: true,
        subjectId: true,
        lectureId: true,
        title: true,
        instructions: true,
        dueAt: true,
        maxMarks: true,
        mode: true,
        allowLate: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await createAuditLog({
      actorId: req.user.userId,
      action: 'ASSIGNMENT_CREATE',
      entityType: 'Assignment',
      entityId: assignment.id,
      branchId: batch.branchId,
      metadata: {
        id: assignment.id,
        batchId,
        mode,
        isPublished: !!publishedAt,
      },
    });

    if (publishedAt) {
      sendAcademicNotification({
        type: 'ASSIGNMENT_PUBLISHED',
        title: `New Assignment Published: ${title}`,
        body: `A new ${mode} assignment has been posted for your batch. Due date: ${dueAtDate.toLocaleDateString()}.`,
        batchId,
        entityType: 'Assignment',
        entityId: assignment.id,
        emailSubject: `New Assignment: ${title}`,
        emailBodyHtml: `A new assignment <strong>${title}</strong> has been published.<br/>Due date: <strong>${dueAtDate.toUTCString()}</strong>.`,
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Assignment created successfully',
      data: assignment,
    });
  } catch (error) {
    console.error('Create assignment error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error creating assignment',
    });
  }
}

export async function updateAssignment(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const assignment = await prisma.assignment.findUnique({
      where: { id },
      include: {
        batch: { select: { id: true, name: true, branchId: true, teacherId: true } },
      },
    });

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found',
      });
    }

    if (req.user.role === Role.ADMIN && assignment.batch.branchId !== req.user.branchId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Assignment belongs to another branch',
      });
    }

    if (req.user.role === Role.TEACHER && assignment.batch.teacherId !== req.user.userId && assignment.createdById !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only update assignments you teach or created',
      });
    }

    if (req.user.role === Role.STUDENT || req.user.role === Role.GUARDIAN) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied',
      });
    }

    const parseResult = updateAssignmentSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const data = parseResult.data;
    const updateData: Prisma.AssignmentUpdateInput = {};
    const changedFields: string[] = [];

    if (data.title !== undefined) {
      updateData.title = data.title;
      changedFields.push('title');
    }
    if (data.instructions !== undefined) {
      updateData.instructions = data.instructions;
      changedFields.push('instructions');
    }
    if (data.dueAt !== undefined) {
      updateData.dueAt = new Date(data.dueAt);
      changedFields.push('dueAt');
    }
    if (data.maxMarks !== undefined) {
      updateData.maxMarks = new Prisma.Decimal(data.maxMarks);
      changedFields.push('maxMarks');
    }
    if (data.mode !== undefined) {
      updateData.mode = data.mode;
      changedFields.push('mode');
    }
    if (data.allowLate !== undefined) {
      updateData.allowLate = data.allowLate;
      changedFields.push('allowLate');
    }
    if (data.subjectId !== undefined) {
      updateData.subject = data.subjectId ? { connect: { id: data.subjectId } } : { disconnect: true };
      changedFields.push('subjectId');
    }
    if (data.lectureId !== undefined) {
      updateData.lecture = data.lectureId ? { connect: { id: data.lectureId } } : { disconnect: true };
      changedFields.push('lectureId');
    }

    let isNewlyPublished = false;
    if (data.published !== undefined) {
      if (data.published) {
        if (!assignment.publishedAt) {
          isNewlyPublished = true;
          updateData.publishedAt = new Date();
          changedFields.push('publishedAt');
        }
      } else {
        updateData.publishedAt = null;
        changedFields.push('publishedAt');
      }
    }

    const updated = await prisma.assignment.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        batchId: true,
        subjectId: true,
        lectureId: true,
        title: true,
        instructions: true,
        dueAt: true,
        maxMarks: true,
        mode: true,
        allowLate: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await createAuditLog({
      actorId: req.user.userId,
      action: isNewlyPublished ? 'ASSIGNMENT_PUBLISH' : 'ASSIGNMENT_UPDATE',
      entityType: 'Assignment',
      entityId: assignment.id,
      branchId: assignment.batch.branchId,
      metadata: {
        id: assignment.id,
        changedFields,
        isPublished: !!updated.publishedAt,
      },
    });

    if (isNewlyPublished) {
      sendAcademicNotification({
        type: 'ASSIGNMENT_PUBLISHED',
        title: `Assignment Published: ${updated.title}`,
        body: `An assignment has been published for your batch. Due date: ${updated.dueAt.toLocaleDateString()}.`,
        batchId: assignment.batchId,
        entityType: 'Assignment',
        entityId: assignment.id,
        emailSubject: `Assignment Published: ${updated.title}`,
        emailBodyHtml: `An assignment <strong>${updated.title}</strong> has been published for your batch.<br/>Due date: <strong>${updated.dueAt.toUTCString()}</strong>.`,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Assignment updated successfully',
      data: updated,
    });
  } catch (error) {
    console.error('Update assignment error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error updating assignment',
    });
  }
}

export async function deleteAssignment(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const assignment = await prisma.assignment.findUnique({
      where: { id },
      include: {
        batch: { select: { branchId: true } },
        _count: { select: { submissions: true } },
      },
    });

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found',
      });
    }

    if (req.user.role === Role.ADMIN && assignment.batch.branchId !== req.user.branchId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied to another branch assignment',
      });
    }

    if (req.user.role === Role.TEACHER && assignment.createdById !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only delete assignments you created',
      });
    }

    if (req.user.role === Role.STUDENT || req.user.role === Role.GUARDIAN) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied',
      });
    }

    if (assignment._count.submissions > 0) {
      return res.status(409).json({
        success: false,
        message:
          'Submissions already exist for this assignment. Cannot delete. Please unpublish the assignment instead.',
      });
    }

    await prisma.assignment.delete({
      where: { id },
    });

    await createAuditLog({
      actorId: req.user.userId,
      action: 'ASSIGNMENT_DELETE',
      entityType: 'Assignment',
      entityId: assignment.id,
      branchId: assignment.batch.branchId,
      metadata: {
        id: assignment.id,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Assignment deleted successfully',
    });
  } catch (error) {
    console.error('Delete assignment error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error deleting assignment',
    });
  }
}

export async function getAssignments(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const { page, limit, skip, take } = parsePagination(req.query, {
      defaultLimit: 20,
      maxLimit: 100,
    });

    const where: Prisma.AssignmentWhereInput = {};
    const now = new Date();

    // Scoping
    if (req.user.role === Role.ADMIN) {
      where.batch = { branchId: req.user.branchId };
    } else if (req.user.role === Role.TEACHER) {
      where.batch = { teacherId: req.user.userId };
    } else if (req.user.role === Role.STUDENT) {
      // Must be published and have active enrollment
      where.publishedAt = { not: null, lte: now };
      where.batch = {
        enrollments: {
          some: {
            studentId: req.user.userId,
            status: EnrollmentStatus.ACTIVE,
          },
        },
      };
    } else if (req.user.role === Role.GUARDIAN) {
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
          message: 'Forbidden: You are not linked to this student',
        });
      }

      where.publishedAt = { not: null, lte: now };
      where.batch = {
        enrollments: {
          some: {
            studentId,
            status: EnrollmentStatus.ACTIVE,
          },
        },
      };
    }

    if (req.query.batchId) {
      where.batchId = req.query.batchId as string;
    }

    // Status filter
    const statusFilter = (req.query.status as string)?.toLowerCase();
    if (statusFilter === 'upcoming') {
      where.dueAt = { gt: now };
      if (req.user.role !== Role.STUDENT && req.user.role !== Role.GUARDIAN) {
        where.publishedAt = { not: null, lte: now };
      }
    } else if (statusFilter === 'overdue') {
      where.dueAt = { lte: now };
      if (req.user.role !== Role.STUDENT && req.user.role !== Role.GUARDIAN) {
        where.publishedAt = { not: null, lte: now };
      }
    } else if (statusFilter === 'draft') {
      if (req.user.role === Role.STUDENT || req.user.role === Role.GUARDIAN) {
        // Students/guardians cannot view drafts
        return res.status(200).json({
          success: true,
          data: {
            items: [],
            pagination: buildMeta(0, page, limit),
          },
        });
      }
      where.publishedAt = null;
    }

    const [assignments, total] = await Promise.all([
      prisma.assignment.findMany({
        where,
        include: {
          batch: { select: { id: true, name: true, branchId: true } },
          subject: { select: { id: true, name: true } },
          lecture: { select: { id: true, title: true, startsAt: true } },
        },
        orderBy: { dueAt: 'asc' },
        skip,
        take,
      }),
      prisma.assignment.count({ where }),
    ]);

    const isStaff =
      req.user.role === Role.SUPER_ADMIN ||
      req.user.role === Role.ADMIN ||
      req.user.role === Role.TEACHER;

    let responseItems: any[] = [];

    if (req.user.role === Role.STUDENT) {
      const assignmentIds = assignments.map((a) => a.id);
      const submissions = await prisma.assignmentSubmission.findMany({
        where: {
          assignmentId: { in: assignmentIds },
          studentId: req.user.userId,
        },
      });

      const submissionMap = new Map(submissions.map((s) => [s.assignmentId, s]));

      responseItems = assignments.map((a) => {
        const sub = submissionMap.get(a.id);
        return {
          ...a,
          mySubmission: sub
            ? {
                id: sub.id,
                status: sub.status,
                isLate: sub.isLate,
                marks: sub.marks,
                feedback: sub.feedback,
                submittedAt: sub.submittedAt,
                gradedAt: sub.gradedAt,
              }
            : null,
        };
      });
    } else if (isStaff) {
      // Fetch stats for each assignment
      const batchIds = [...new Set(assignments.map((a) => a.batchId))];
      const enrollmentCounts = await prisma.enrollment.groupBy({
        by: ['batchId'],
        where: {
          batchId: { in: batchIds },
          status: EnrollmentStatus.ACTIVE,
        },
        _count: { studentId: true },
      });
      const enrollmentMap = new Map(enrollmentCounts.map((e) => [e.batchId, e._count.studentId]));

      const assignmentIds = assignments.map((a) => a.id);
      const submissionCounts = await prisma.assignmentSubmission.groupBy({
        by: ['assignmentId', 'status'],
        where: {
          assignmentId: { in: assignmentIds },
        },
        _count: { id: true },
      });

      const submissionStatsMap = new Map<string, { submitted: number; graded: number }>();
      for (const row of submissionCounts) {
        const curr = submissionStatsMap.get(row.assignmentId) || { submitted: 0, graded: 0 };
        if (row.status === AssignmentSubmissionStatus.SUBMITTED) {
          curr.submitted += row._count.id;
        } else if (row.status === AssignmentSubmissionStatus.GRADED) {
          curr.graded += row._count.id;
        }
        submissionStatsMap.set(row.assignmentId, curr);
      }

      responseItems = assignments.map((a) => {
        const enrolled = enrollmentMap.get(a.batchId) || 0;
        const stats = submissionStatsMap.get(a.id) || { submitted: 0, graded: 0 };
        const missing = Math.max(0, enrolled - (stats.submitted + stats.graded));

        return {
          ...a,
          counts: {
            enrolled,
            submitted: stats.submitted,
            graded: stats.graded,
            missing,
          },
        };
      });
    } else {
      // Guardian
      const studentId = req.query.studentId as string;
      const assignmentIds = assignments.map((a) => a.id);
      const submissions = await prisma.assignmentSubmission.findMany({
        where: {
          assignmentId: { in: assignmentIds },
          studentId,
        },
      });

      const submissionMap = new Map(submissions.map((s) => [s.assignmentId, s]));

      responseItems = assignments.map((a) => {
        const sub = submissionMap.get(a.id);
        return {
          ...a,
          mySubmission: sub
            ? {
                id: sub.id,
                status: sub.status,
                isLate: sub.isLate,
                marks: sub.marks,
                feedback: sub.feedback,
                submittedAt: sub.submittedAt,
                gradedAt: sub.gradedAt,
              }
            : null,
        };
      });
    }

    const meta = buildMeta(total, page, limit);

    return res.status(200).json({
      success: true,
      data: {
        items: responseItems,
        pagination: meta,
      },
    });
  } catch (error) {
    console.error('Get assignments error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error retrieving assignments',
    });
  }
}

export async function getAssignmentById(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const assignment = await prisma.assignment.findUnique({
      where: { id },
      include: {
        batch: { select: { id: true, name: true, branchId: true, teacherId: true } },
        subject: { select: { id: true, name: true } },
        lecture: { select: { id: true, title: true, startsAt: true } },
        attachments: {
          select: {
            id: true,
            title: true,
            kind: true,
            url: true,
            format: true,
            bytes: true,
            originalName: true,
            createdAt: true,
          },
        },
      },
    });

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found',
      });
    }

    const user = req.user;

    // Scoping
    if (user.role === Role.ADMIN && assignment.batch.branchId !== user.branchId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied to another branch assignment',
      });
    }

    if (user.role === Role.TEACHER && assignment.batch.teacherId !== user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only view assignments for batches you teach',
      });
    }

    if (user.role === Role.STUDENT) {
      if (!assignment.publishedAt || assignment.publishedAt > new Date()) {
        return res.status(404).json({
          success: false,
          message: 'Assignment not found or access denied',
        });
      }
      const enrollment = await prisma.enrollment.findUnique({
        where: {
          studentId_batchId: {
            studentId: user.userId,
            batchId: assignment.batchId,
          },
        },
      });
      if (enrollment?.status !== EnrollmentStatus.ACTIVE) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: Active enrollment required',
        });
      }
    }

    if (user.role === Role.GUARDIAN) {
      if (!assignment.publishedAt || assignment.publishedAt > new Date()) {
        return res.status(404).json({
          success: false,
          message: 'Assignment not found or access denied',
        });
      }
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
            guardianId: user.userId,
            studentId,
          },
        },
      });
      if (!link) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: Guardian is not linked to this student',
        });
      }
      const enrollment = await prisma.enrollment.findUnique({
        where: {
          studentId_batchId: {
            studentId,
            batchId: assignment.batchId,
          },
        },
      });
      if (enrollment?.status !== EnrollmentStatus.ACTIVE) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: Student has no active enrollment in this batch',
        });
      }
    }

    // Attachments: omit url for FILE
    const safeAttachments = assignment.attachments.map((a) => ({
      id: a.id,
      title: a.title,
      kind: a.kind,
      url: a.kind === 'LINK' ? a.url : null,
      format: a.format,
      bytes: a.bytes,
      originalName: a.originalName,
      createdAt: a.createdAt,
    }));

    let mySubmission = null;
    if (user.role === Role.STUDENT) {
      mySubmission = await prisma.assignmentSubmission.findUnique({
        where: {
          assignmentId_studentId: {
            assignmentId: assignment.id,
            studentId: user.userId,
          },
        },
        include: {
          attachments: {
            select: {
              id: true,
              title: true,
              kind: true,
              format: true,
              bytes: true,
              originalName: true,
              createdAt: true,
            },
          },
        },
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        ...assignment,
        attachments: safeAttachments,
        mySubmission,
      },
    });
  } catch (error) {
    console.error('Get assignment by ID error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error retrieving assignment',
    });
  }
}

export async function submitAssignment(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    if (req.user.role !== Role.STUDENT) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only students can submit assignments',
      });
    }

    const assignmentId = req.params.id as string;
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        batch: { select: { branchId: true } },
      },
    });

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found',
      });
    }

    if (assignment.mode !== AssignmentMode.ONLINE) {
      return res.status(400).json({
        success: false,
        message: 'This assignment does not accept online submissions',
      });
    }

    // Active enrollment check
    const enrollment = await prisma.enrollment.findUnique({
      where: {
        studentId_batchId: {
          studentId: req.user.userId,
          batchId: assignment.batchId,
        },
      },
    });

    if (!enrollment || enrollment.status !== EnrollmentStatus.ACTIVE) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Active enrollment required to submit assignments',
      });
    }

    // Must be published
    const now = new Date();
    if (!assignment.publishedAt || assignment.publishedAt > now) {
      return res.status(400).json({
        success: false,
        message: 'Assignment is not open for submission',
      });
    }

    // Late check from server time
    const isLate = now > assignment.dueAt;
    if (isLate && !assignment.allowLate) {
      return res.status(400).json({
        success: false,
        code: 'SUBMISSION_CLOSED',
        message: 'Assignment deadline has passed and late submissions are not allowed',
      });
    }

    const parseResult = submitAssignmentSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { textAnswer, attachments } = parseResult.data;

    // Check if previous submission exists
    const existing = await prisma.assignmentSubmission.findUnique({
      where: {
        assignmentId_studentId: {
          assignmentId,
          studentId: req.user.userId,
        },
      },
    });

    if (existing && existing.status === AssignmentSubmissionStatus.GRADED) {
      return res.status(409).json({
        success: false,
        message: 'Cannot resubmit: Your submission has already been graded',
      });
    }

    // Validate attachment publicId prefix
    const expectedPrefix = `eduflow/submission/${req.user.branchId}`;
    if (attachments && attachments.length > 0) {
      for (const att of attachments) {
        if (!att.publicId.startsWith(expectedPrefix)) {
          return res.status(400).json({
            success: false,
            message: `Attachment file '${att.title}' has invalid publicId outside expected branch folder`,
          });
        }
      }
    }

    // Execute submission in transaction
    const submission = await prisma.$transaction(async (tx) => {
      let sub;
      if (existing) {
        // Resubmission: delete previous attachments
        await tx.attachment.deleteMany({
          where: { submissionId: existing.id },
        });

        sub = await tx.assignmentSubmission.update({
          where: { id: existing.id },
          data: {
            textAnswer: textAnswer || null,
            submittedAt: now,
            isLate,
            status: AssignmentSubmissionStatus.SUBMITTED,
          },
        });
      } else {
        sub = await tx.assignmentSubmission.create({
          data: {
            assignmentId,
            studentId: req.user!.userId,
            textAnswer: textAnswer || null,
            submittedAt: now,
            isLate,
            status: AssignmentSubmissionStatus.SUBMITTED,
          },
        });
      }

      // Create new attachments
      if (attachments && attachments.length > 0) {
        for (const att of attachments) {
          await tx.attachment.create({
            data: {
              branchId: req.user!.branchId,
              submissionId: sub.id,
              kind: 'FILE',
              title: att.title,
              publicId: att.publicId,
              resourceType: att.resourceType || 'raw',
              format: att.format || null,
              bytes: att.bytes || null,
              originalName: att.originalName || null,
              uploadedById: req.user!.userId,
            },
          });
        }
      }

      return sub;
    });

    return res.status(200).json({
      success: true,
      message: 'Assignment submitted successfully',
      data: submission,
    });
  } catch (error) {
    console.error('Submit assignment error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error processing assignment submission',
    });
  }
}

export async function getAssignmentSubmissions(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const assignmentId = req.params.id as string;
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        batch: { select: { id: true, branchId: true, teacherId: true } },
      },
    });

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found',
      });
    }

    // Scoping: Staff only
    if (req.user.role === Role.ADMIN && assignment.batch.branchId !== req.user.branchId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied to another branch assignment',
      });
    }

    if (req.user.role === Role.TEACHER && assignment.batch.teacherId !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only view submissions for batches you teach',
      });
    }

    if (req.user.role === Role.STUDENT || req.user.role === Role.GUARDIAN) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied to submissions roster',
      });
    }

    const statusFilter = (req.query.status as string)?.toUpperCase();
    const { page, limit, skip, take } = parsePagination(req.query, {
      defaultLimit: 20,
      maxLimit: 100,
    });

    if (statusFilter === 'MISSING') {
      // Find active enrolled students who have no submission
      const activeEnrollments = await prisma.enrollment.findMany({
        where: {
          batchId: assignment.batchId,
          status: EnrollmentStatus.ACTIVE,
        },
        select: {
          student: {
            select: {
              id: true,
              name: true,
              studentCode: true,
              email: true,
              phone: true,
            },
          },
        },
      });

      const existingSubmissions = await prisma.assignmentSubmission.findMany({
        where: { assignmentId },
        select: { studentId: true },
      });
      const submittedStudentIds = new Set(existingSubmissions.map((s) => s.studentId));

      const missingStudents = activeEnrollments
        .filter((e) => !submittedStudentIds.has(e.student.id))
        .map((e) => ({
          status: 'MISSING',
          student: e.student,
        }));

      const total = missingStudents.length;
      const paginatedItems = missingStudents.slice(skip, skip + take);

      return res.status(200).json({
        success: true,
        data: {
          items: paginatedItems,
          pagination: buildMeta(total, page, limit),
        },
      });
    }

    const where: Prisma.AssignmentSubmissionWhereInput = {
      assignmentId,
    };
    if (statusFilter === 'SUBMITTED' || statusFilter === 'GRADED') {
      where.status = statusFilter as AssignmentSubmissionStatus;
    }

    const [items, total] = await Promise.all([
      prisma.assignmentSubmission.findMany({
        where,
        include: {
          student: {
            select: {
              id: true,
              name: true,
              studentCode: true,
              email: true,
              phone: true,
            },
          },
          gradedBy: {
            select: {
              id: true,
              name: true,
            },
          },
          attachments: {
            select: {
              id: true,
              title: true,
              kind: true,
              format: true,
              bytes: true,
              originalName: true,
              createdAt: true,
            },
          },
        },
        orderBy: { submittedAt: 'desc' },
        skip,
        take,
      }),
      prisma.assignmentSubmission.count({ where }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        items,
        pagination: buildMeta(total, page, limit),
      },
    });
  } catch (error) {
    console.error('Get assignment submissions error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error retrieving submissions',
    });
  }
}

export async function getSubmissionById(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const submission = await prisma.assignmentSubmission.findUnique({
      where: { id },
      include: {
        assignment: {
          include: {
            batch: { select: { id: true, name: true, branchId: true, teacherId: true } },
          },
        },
        student: {
          select: {
            id: true,
            name: true,
            studentCode: true,
            email: true,
            phone: true,
          },
        },
        gradedBy: {
          select: {
            id: true,
            name: true,
          },
        },
        attachments: {
          select: {
            id: true,
            title: true,
            kind: true,
            format: true,
            bytes: true,
            originalName: true,
            createdAt: true,
          },
        },
      },
    });

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found',
      });
    }

    const user = req.user;

    // Scoping
    if (user.role === Role.STUDENT && submission.studentId !== user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only read your own submission',
      });
    }

    if (user.role === Role.GUARDIAN) {
      const link = await prisma.guardianLink.findUnique({
        where: {
          guardianId_studentId: {
            guardianId: user.userId,
            studentId: submission.studentId,
          },
        },
      });
      if (!link) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: Guardian is not linked to this student',
        });
      }
    }

    if (user.role === Role.ADMIN && submission.assignment.batch.branchId !== user.branchId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Submission belongs to another branch',
      });
    }

    if (user.role === Role.TEACHER && submission.assignment.batch.teacherId !== user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only view submissions for batches you teach',
      });
    }

    return res.status(200).json({
      success: true,
      data: submission,
    });
  } catch (error) {
    console.error('Get submission by ID error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error retrieving submission',
    });
  }
}

export async function gradeSubmission(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const submission = await prisma.assignmentSubmission.findUnique({
      where: { id },
      include: {
        assignment: {
          include: {
            batch: { select: { id: true, name: true, branchId: true, teacherId: true } },
          },
        },
      },
    });

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found',
      });
    }

    if (req.user.role === Role.ADMIN && submission.assignment.batch.branchId !== req.user.branchId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied to another branch submission',
      });
    }

    if (req.user.role === Role.TEACHER && submission.assignment.batch.teacherId !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only grade submissions for batches you teach',
      });
    }

    if (req.user.role === Role.STUDENT || req.user.role === Role.GUARDIAN) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied',
      });
    }

    const parseResult = gradeSubmissionSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { marks, feedback } = parseResult.data;
    const numMarks = Number(marks);
    const maxMarks = Number(submission.assignment.maxMarks);

    if (numMarks < 0 || numMarks > maxMarks) {
      return res.status(400).json({
        success: false,
        message: `Marks must be between 0 and maximum marks (${maxMarks})`,
      });
    }

    const updated = await prisma.assignmentSubmission.update({
      where: { id },
      data: {
        marks: new Prisma.Decimal(marks),
        feedback: feedback || null,
        status: AssignmentSubmissionStatus.GRADED,
        gradedById: req.user.userId,
        gradedAt: new Date(),
      },
      select: {
        id: true,
        assignmentId: true,
        studentId: true,
        status: true,
        marks: true,
        feedback: true,
        gradedAt: true,
        gradedById: true,
      },
    });

    await createAuditLog({
      actorId: req.user.userId,
      action: 'ASSIGNMENT_GRADE',
      entityType: 'AssignmentSubmission',
      entityId: submission.id,
      branchId: submission.assignment.batch.branchId,
      metadata: {
        submissionId: submission.id,
        assignmentId: submission.assignmentId,
        studentId: submission.studentId,
        marks: numMarks,
      },
    });

    sendAcademicNotification({
      type: 'SUBMISSION_GRADED',
      title: `Assignment Graded: ${submission.assignment.title}`,
      body: `Your submission for '${submission.assignment.title}' has been graded. Marks: ${numMarks}/${maxMarks}`,
      batchId: submission.assignment.batchId,
      studentId: submission.studentId,
      entityType: 'AssignmentSubmission',
      entityId: submission.id,
      emailSubject: `Assignment Graded: ${submission.assignment.title}`,
      emailBodyHtml: `Your submission for <strong>${submission.assignment.title}</strong> has been graded.<br/>Marks: <strong>${numMarks} / ${maxMarks}</strong>${feedback ? `<br/>Feedback: ${feedback}` : ''}`,
    });

    return res.status(200).json({
      success: true,
      message: 'Submission graded successfully',
      data: updated,
    });
  } catch (error) {
    console.error('Grade submission error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error grading submission',
    });
  }
}

export async function submitOfflineBulkMarks(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const assignmentId = req.params.id as string;
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        batch: { select: { id: true, branchId: true, teacherId: true } },
      },
    });

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found',
      });
    }

    if (req.user.role === Role.ADMIN && assignment.batch.branchId !== req.user.branchId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied to another branch assignment',
      });
    }

    if (req.user.role === Role.TEACHER && assignment.batch.teacherId !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only record marks for batches you teach',
      });
    }

    if (req.user.role === Role.STUDENT || req.user.role === Role.GUARDIAN) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied',
      });
    }

    const parseResult = offlineBulkMarksSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { entries } = parseResult.data;
    const maxMarks = Number(assignment.maxMarks);

    // Validate active enrollments for batch
    const studentIds = entries.map((e) => e.studentId);
    const activeEnrollments = await prisma.enrollment.findMany({
      where: {
        batchId: assignment.batchId,
        studentId: { in: studentIds },
        status: EnrollmentStatus.ACTIVE,
      },
      select: { studentId: true },
    });

    const activeSet = new Set(activeEnrollments.map((e) => e.studentId));

    const results: Array<{ studentId: string; success: boolean; marks?: number; error?: string }> = [];
    const validToUpsert: Array<{ studentId: string; marks: number; feedback?: string | null }> = [];

    for (const entry of entries) {
      const numMarks = Number(entry.marks);
      if (!activeSet.has(entry.studentId)) {
        results.push({
          studentId: entry.studentId,
          success: false,
          error: 'Student is not actively enrolled in this batch',
        });
        continue;
      }

      if (numMarks < 0 || numMarks > maxMarks) {
        results.push({
          studentId: entry.studentId,
          success: false,
          error: `Marks must be between 0 and ${maxMarks}`,
        });
        continue;
      }

      validToUpsert.push({
        studentId: entry.studentId,
        marks: numMarks,
        feedback: entry.feedback || null,
      });
    }

    const now = new Date();
    for (const valid of validToUpsert) {
      await prisma.assignmentSubmission.upsert({
        where: {
          assignmentId_studentId: {
            assignmentId,
            studentId: valid.studentId,
          },
        },
        create: {
          assignmentId,
          studentId: valid.studentId,
          marks: new Prisma.Decimal(valid.marks),
          feedback: valid.feedback,
          status: AssignmentSubmissionStatus.GRADED,
          gradedById: req.user.userId,
          gradedAt: now,
          submittedAt: now,
        },
        update: {
          marks: new Prisma.Decimal(valid.marks),
          feedback: valid.feedback,
          status: AssignmentSubmissionStatus.GRADED,
          gradedById: req.user.userId,
          gradedAt: now,
        },
      });

      results.push({
        studentId: valid.studentId,
        success: true,
        marks: valid.marks,
      });
    }

    await createAuditLog({
      actorId: req.user.userId,
      action: 'ASSIGNMENT_OFFLINE_MARKS',
      entityType: 'Assignment',
      entityId: assignment.id,
      branchId: assignment.batch.branchId,
      metadata: {
        assignmentId,
        totalEntries: entries.length,
        successfulEntries: validToUpsert.length,
      },
    });

    return res.status(200).json({
      success: true,
      message: `Processed ${validToUpsert.length} of ${entries.length} marks entries`,
      data: {
        results,
      },
    });
  } catch (error) {
    console.error('Submit offline marks error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error recording offline marks',
    });
  }
}
