import { Request, Response } from 'express';
import { createBatchSchema, updateBatchSchema } from '../validators/batch.validator';
import prisma from '../utils/prisma';
import { createAuditLog } from '../utils/audit';

export async function createBatch(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const parseResult = createBatchSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { name, type, classLevel, subjectId, teacherId } = parseResult.data;
    const branchId = req.user.branchId;

    // Check if subject exists
    const subject = await prisma.subject.findUnique({
      where: { id: subjectId },
    });
    if (!subject) {
      return res.status(404).json({
        success: false,
        message: 'Subject not found',
      });
    }

    // Check if teacher exists and belongs to the same branch (if teacherId is provided)
    if (teacherId) {
      const teacher = await prisma.user.findUnique({
        where: { id: teacherId },
      });
      if (!teacher) {
        return res.status(404).json({
          success: false,
          message: 'Teacher not found',
        });
      }
      if (teacher.branchId !== branchId) {
        return res.status(403).json({
          success: false,
          message: 'Teacher does not belong to your branch',
        });
      }
    }

    // Create batch
    const batch = await prisma.batch.create({
      data: {
        name,
        type,
        classLevel: classLevel || null,
        subjectId,
        teacherId: teacherId || null,
        branchId,
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Batch created successfully',
      data: batch,
    });
  } catch (error) {
    console.error('Create batch error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function getBatches(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const whereClause: any = {
      archivedAt: null,
    };
    if (req.effectiveBranchId) {
      whereClause.branchId = req.effectiveBranchId;
    }

    const batches = await prisma.batch.findMany({
      where: whereClause,
      include: {
        subject: {
          select: { name: true },
        },
        teacher: {
          select: { name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({
      success: true,
      message: 'Batches retrieved successfully',
      data: batches,
    });
  } catch (error) {
    console.error('Get batches error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function getBatchById(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const whereClause: any = { id, archivedAt: null };
    if (req.effectiveBranchId) {
      whereClause.branchId = req.effectiveBranchId;
    }

    const batch = await prisma.batch.findFirst({
      where: whereClause,
      include: {
        subject: {
          select: { id: true, name: true },
        },
        teacher: {
          select: { id: true, name: true },
        },
        _count: {
          select: { enrollments: true },
        },
      },
    });

    if (!batch) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found or access denied',
      });
    }

    const { _count, ...batchData } = batch;
    const formattedBatch = {
      ...batchData,
      enrolledStudentsCount: _count.enrollments,
    };

    return res.status(200).json({
      success: true,
      message: 'Batch retrieved successfully',
      data: formattedBatch,
    });
  } catch (error) {
    console.error('Get batch by ID error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function updateBatch(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const branchId = req.effectiveBranchId || req.user.branchId;

    // Check if batch exists and belongs to user's branch
    const existingBatch = await prisma.batch.findUnique({
      where: { id },
    });

    if (!existingBatch || existingBatch.archivedAt !== null) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found or archived',
      });
    }

    if (req.effectiveBranchId && existingBatch.branchId !== req.effectiveBranchId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied to this batch',
      });
    }

    const parseResult = updateBatchSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { name, type, classLevel, subjectId, teacherId } = parseResult.data;

    // Check if subject exists if updated
    if (subjectId) {
      const subject = await prisma.subject.findUnique({
        where: { id: subjectId },
      });
      if (!subject) {
        return res.status(404).json({
          success: false,
          message: 'Subject not found',
        });
      }
    }

    // Check if teacher exists and belongs to the same branch if updated
    if (teacherId) {
      const teacher = await prisma.user.findUnique({
        where: { id: teacherId },
      });
      if (!teacher) {
        return res.status(404).json({
          success: false,
          message: 'Teacher not found',
        });
      }
      if (teacher.branchId !== branchId) {
        return res.status(403).json({
          success: false,
          message: 'Teacher does not belong to your branch',
        });
      }
    }

    // Update batch
    const updatedBatch = await prisma.batch.update({
      where: { id },
      data: {
        name,
        type,
        classLevel,
        subjectId,
        teacherId,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Batch updated successfully',
      data: updatedBatch,
    });
  } catch (error) {
    console.error('Update batch error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function deleteBatch(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const branchId = req.effectiveBranchId || req.user.branchId;

    // Check if batch exists and belongs to user's branch
    const existingBatch = await prisma.batch.findUnique({
      where: { id },
    });

    if (!existingBatch) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found',
      });
    }

    if (req.effectiveBranchId && existingBatch.branchId !== req.effectiveBranchId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied to this batch',
      });
    }

    // Check for activity / related records
    const [enrollmentCount, testCount, attendanceCount, lectureCount, assignmentCount] =
      await Promise.all([
        prisma.enrollment.count({ where: { batchId: id } }),
        prisma.test.count({ where: { batchId: id } }),
        prisma.attendance.count({ where: { batchId: id } }),
        prisma.lecture.count({ where: { batchId: id } }),
        prisma.assignment.count({ where: { batchId: id } }),
      ]);

    const hasActivity =
      enrollmentCount > 0 ||
      testCount > 0 ||
      attendanceCount > 0 ||
      lectureCount > 0 ||
      assignmentCount > 0;

    if (hasActivity) {
      // Soft archive
      await prisma.batch.update({
        where: { id },
        data: { archivedAt: new Date() },
      });

      await createAuditLog({
        actorId: req.user.userId,
        action: 'ARCHIVE_BATCH',
        entityType: 'Batch',
        entityId: id,
        branchId,
        metadata: {
          enrollmentCount,
          testCount,
          attendanceCount,
          lectureCount,
          assignmentCount,
        },
        ip: req.ip,
      });

      return res.status(200).json({
        success: true,
        message: 'Batch has existing activity and was archived instead of deleted',
        data: { archived: true },
      });
    }

    // Truly empty -> hard delete
    await prisma.batch.delete({
      where: { id },
    });

    await createAuditLog({
      actorId: req.user.userId,
      action: 'DELETE_BATCH',
      entityType: 'Batch',
      entityId: id,
      branchId,
      metadata: { hardDeleted: true },
      ip: req.ip,
    });

    return res.status(200).json({
      success: true,
      message: 'Batch deleted successfully',
      data: { deleted: true },
    });
  } catch (error) {
    console.error('Delete batch error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function restoreBatch(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const branchId = req.effectiveBranchId || req.user.branchId;

    const existingBatch = await prisma.batch.findUnique({
      where: { id },
    });

    if (!existingBatch) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found',
      });
    }

    if (req.effectiveBranchId && existingBatch.branchId !== req.effectiveBranchId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied to this batch',
      });
    }

    await prisma.batch.update({
      where: { id },
      data: { archivedAt: null },
    });

    await createAuditLog({
      actorId: req.user.userId,
      action: 'RESTORE_BATCH',
      entityType: 'Batch',
      entityId: id,
      branchId,
      metadata: { restored: true },
      ip: req.ip,
    });

    return res.status(200).json({
      success: true,
      message: 'Batch restored successfully',
      data: { restored: true },
    });
  } catch (error) {
    console.error('Restore batch error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function getBatchForStudent(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const studentId = req.user.userId;

    // Verify requesting student has an ACTIVE enrollment in this batch
    const enrollment = await prisma.enrollment.findUnique({
      where: {
        studentId_batchId: {
          studentId,
          batchId: id,
        },
      },
    });

    if (!enrollment || enrollment.status !== 'ACTIVE') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You are not actively enrolled in this batch',
      });
    }

    // Retrieve student-safe batch details (no feeAmount, no discount data, no student roster)
    const batch = await prisma.batch.findUnique({
      where: { id, archivedAt: null },
      select: {
        id: true,
        name: true,
        type: true,
        classLevel: true,
        feeType: true,
        createdAt: true,
        subject: {
          select: { id: true, name: true },
        },
        teacher: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!batch) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found or archived',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Batch details retrieved successfully',
      data: batch,
    });
  } catch (error) {
    console.error('Get batch for student error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}
