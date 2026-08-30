import { Request, Response } from 'express';
import { PrismaClient, Role, EnrollmentStatus } from '@prisma/client';
import { createResourceSchema } from '../validators/resource.validator';

const prisma = new PrismaClient();

export async function createResource(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const parseResult = createResourceSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { title, fileUrl, fileType, batchId, chapterId } = parseResult.data;
    const branchId = req.user.branchId;

    // Verify batch exists and belongs to user's branch
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
    });

    if (!batch || batch.branchId !== branchId) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found or access denied',
      });
    }

    if (chapterId) {
      const chapter = await prisma.chapter.findUnique({
        where: { id: chapterId },
      });
      if (!chapter) {
        return res.status(404).json({
          success: false,
          message: 'Chapter not found',
        });
      }
    }

    const resource = await prisma.resource.create({
      data: {
        title,
        fileUrl,
        fileType,
        batchId,
        chapterId: chapterId || null,
        uploadedById: req.user.userId,
      },
      include: {
        chapter: {
          select: {
            id: true,
            name: true,
          },
        },
        uploadedBy: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Resource created successfully',
      data: resource,
    });
  } catch (error) {
    console.error('Create resource error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function getResourcesByBatch(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const batchId = req.params.batchId as string;
    const branchId = req.user.branchId;

    // Verify batch exists and belongs to user's branch
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
    });

    if (!batch || batch.branchId !== branchId) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found or access denied',
      });
    }

    // If user is STUDENT, check enrollment
    if (req.user.role === Role.STUDENT) {
      const enrollment = await prisma.enrollment.findUnique({
        where: {
          studentId_batchId: {
            studentId: req.user.userId,
            batchId,
          },
        },
      });

      if (!enrollment || enrollment.status !== EnrollmentStatus.ACTIVE) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You are not active in this batch',
        });
      }
    }

    const resources = await prisma.resource.findMany({
      where: { batchId },
      include: {
        chapter: {
          select: {
            id: true,
            name: true,
          },
        },
        uploadedBy: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Resources retrieved successfully',
      data: resources,
    });
  } catch (error) {
    console.error('Get resources by batch error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function deleteResource(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const branchId = req.user.branchId;

    const resource = await prisma.resource.findUnique({
      where: { id },
      include: {
        batch: {
          select: {
            branchId: true,
          },
        },
      },
    });

    if (!resource || resource.batch.branchId !== branchId) {
      return res.status(404).json({
        success: false,
        message: 'Resource not found or access denied',
      });
    }

    await prisma.resource.delete({
      where: { id },
    });

    return res.status(200).json({
      success: true,
      message: 'Resource deleted successfully',
    });
  } catch (error) {
    console.error('Delete resource error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}
