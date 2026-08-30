import { Request, Response } from 'express';
import { PrismaClient, Role, EnrollmentStatus } from '@prisma/client';
import { createNoticeSchema } from '../validators/notice.validator';

const prisma = new PrismaClient();

export async function createNotice(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const parseResult = createNoticeSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { title, content, batchId } = parseResult.data;
    const branchId = req.user.branchId;

    if (batchId) {
      const batch = await prisma.batch.findUnique({
        where: { id: batchId },
      });
      if (!batch || batch.branchId !== branchId) {
        return res.status(404).json({
          success: false,
          message: 'Batch not found or access denied',
        });
      }
    }

    const notice = await prisma.notice.create({
      data: {
        title,
        content,
        branchId,
        batchId: batchId || null,
        createdById: req.user.userId,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            role: true,
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

    return res.status(201).json({
      success: true,
      message: 'Notice created successfully',
      data: notice,
    });
  } catch (error) {
    console.error('Create notice error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function getNotices(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const branchId = req.user.branchId;
    const { role, userId } = req.user;

    let noticeWhere: any = { branchId };

    if (role === Role.ADMIN || role === Role.TEACHER) {
      noticeWhere.branchId = branchId;
    } else if (role === Role.STUDENT) {
      const activeEnrollments = await prisma.enrollment.findMany({
        where: {
          studentId: userId,
          status: EnrollmentStatus.ACTIVE,
        },
        select: {
          batchId: true,
        },
      });

      const activeBatchIds = activeEnrollments.map((e) => e.batchId);

      noticeWhere = {
        branchId,
        OR: [
          { batchId: null },
          { batchId: { in: activeBatchIds } },
        ],
      };
    } else if (role === Role.GUARDIAN) {
      const guardianLinks = await prisma.guardianLink.findMany({
        where: {
          guardianId: userId,
        },
        select: {
          studentId: true,
        },
      });

      const linkedStudentIds = guardianLinks.map((link) => link.studentId);

      let activeBatchIds: string[] = [];
      if (linkedStudentIds.length > 0) {
        const studentEnrollments = await prisma.enrollment.findMany({
          where: {
            studentId: { in: linkedStudentIds },
            status: EnrollmentStatus.ACTIVE,
          },
          select: {
            batchId: true,
          },
        });
        activeBatchIds = Array.from(new Set(studentEnrollments.map((e) => e.batchId)));
      }

      noticeWhere = {
        branchId,
        OR: [
          { batchId: null },
          { batchId: { in: activeBatchIds } },
        ],
      };
    }

    const notices = await prisma.notice.findMany({
      where: noticeWhere,
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            role: true,
          },
        },
        batch: {
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
      message: 'Notices retrieved successfully',
      data: notices,
    });
  } catch (error) {
    console.error('Get notices error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function deleteNotice(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const branchId = req.user.branchId;

    const notice = await prisma.notice.findUnique({
      where: { id },
    });

    if (!notice || notice.branchId !== branchId) {
      return res.status(404).json({
        success: false,
        message: 'Notice not found or access denied',
      });
    }

    await prisma.notice.delete({
      where: { id },
    });

    return res.status(200).json({
      success: true,
      message: 'Notice deleted successfully',
    });
  } catch (error) {
    console.error('Delete notice error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}
