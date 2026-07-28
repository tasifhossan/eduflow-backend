import { Request, Response } from 'express';
import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();

export async function getStudentsWithSummary(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const branchId = req.user.branchId;

    const students = await prisma.user.findMany({
      where: {
        role: Role.STUDENT,
        branchId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        guardianName: true,
        guardianPhone: true,
        createdAt: true,
        _count: {
          select: {
            enrollments: true,
          },
        },
        attendances: {
          select: {
            status: true,
            date: true,
            batch: {
              select: {
                name: true,
              },
            },
          },
          orderBy: {
            date: 'desc',
          },
          take: 1,
        },
      },
      orderBy: {
        name: 'asc',
      },
    });

    const formattedStudents = students.map((student) => {
      const { _count, attendances, ...rest } = student;
      return {
        ...rest,
        enrolledBatchesCount: _count.enrollments,
        recentAttendance: attendances.length > 0 ? {
          status: attendances[0].status,
          date: attendances[0].date,
          batchName: attendances[0].batch.name,
        } : null,
      };
    });

    return res.status(200).json({
      success: true,
      message: 'Students summary retrieved successfully',
      data: formattedStudents,
    });
  } catch (error) {
    console.error('Get students with summary error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}
