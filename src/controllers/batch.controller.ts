import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { createBatchSchema, updateBatchSchema } from '../validators/batch.validator';

const prisma = new PrismaClient();

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

    const batches = await prisma.batch.findMany({
      where: { branchId: req.user.branchId },
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

    const batch = await prisma.batch.findFirst({
      where: {
        id,
        branchId: req.user.branchId,
      },
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
    const branchId = req.user.branchId;

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

    if (existingBatch.branchId !== branchId) {
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
    const branchId = req.user.branchId;

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

    if (existingBatch.branchId !== branchId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied to this batch',
      });
    }

    // Hard delete
    await prisma.batch.delete({
      where: { id },
    });

    return res.status(200).json({
      success: true,
      message: 'Batch deleted successfully',
    });
  } catch (error) {
    console.error('Delete batch error:', error);
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
      where: { id },
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
        message: 'Batch not found',
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

