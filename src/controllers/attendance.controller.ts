import { Request, Response } from 'express';
import { PrismaClient, Role } from '@prisma/client';
import { markAttendanceSchema } from '../validators/attendance.validator';

const prisma = new PrismaClient();

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

    // Verify batch exists and belongs to the user's branch
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
    });
    if (!batch || batch.branchId !== branchId) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found or access denied',
      });
    }

    // Normalize date to UTC midnight
    const parsedDate = new Date(date);
    const normalizedDate = new Date(parsedDate.toISOString().split('T')[0] + 'T00:00:00.000Z');

    // Verify all students exist and belong to the same branch
    const studentIds = records.map((r) => r.studentId);
    const students = await prisma.user.findMany({
      where: {
        id: { in: studentIds },
        role: Role.STUDENT,
        branchId,
      },
    });

    if (students.length !== new Set(studentIds).size) {
      return res.status(400).json({
        success: false,
        message: 'One or more student IDs are invalid or belong to a different branch',
      });
    }

    // Upsert attendance records in a transaction
    const upserts = records.map((record) => {
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
        },
        create: {
          studentId: record.studentId,
          batchId,
          date: normalizedDate,
          status: record.status,
          markedById: req.user!.userId,
        },
      });
    });

    await prisma.$transaction(upserts);

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

    // Verify batch exists and belongs to branch
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
    });
    if (!batch || batch.branchId !== branchId) {
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
    if (!student || student.branchId !== branchId || student.role !== Role.STUDENT) {
      return res.status(404).json({
        success: false,
        message: 'Student not found or access denied',
      });
    }

    const batchId = req.query.batchId as string | undefined;

    if (batchId) {
      // Verify batch exists and belongs to the same branch
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

    const whereClause: any = {
      studentId,
    };
    if (batchId) {
      whereClause.batchId = batchId;
    }

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
        branchId,
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
      message: 'Today\'s attendance summary retrieved successfully',
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
