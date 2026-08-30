import { Request, Response } from 'express';
import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();

export async function getDashboardSummary(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const { userId, role, branchId } = req.user;
    const now = new Date();

    // Normalize today to UTC midnight (consistent with attendance marking logic)
    const todayNormalized = new Date(now.toISOString().split('T')[0] + 'T00:00:00.000Z');

    // Window for "upcoming" and "recent" queries
    const sevenDaysFromNow = new Date(todayNormalized.getTime() + 7 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(todayNormalized.getTime() - 7 * 24 * 60 * 60 * 1000);

    // ─── GUARDIAN path ────────────────────────────────────────────────────────
    if (role === Role.GUARDIAN) {
      const guardianLinks = await prisma.guardianLink.findMany({
        where: { guardianId: userId },
        select: {
          student: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              enrollments: {
                where: { status: 'ACTIVE' },
                select: {
                  batch: {
                    select: { id: true, name: true },
                  },
                },
              },
            },
          },
        },
      });

      const children = guardianLinks.map((link) => ({
        id: link.student.id,
        name: link.student.name,
        email: link.student.email,
        phone: link.student.phone,
        enrolledBatches: link.student.enrollments.map((e) => e.batch),
      }));

      return res.status(200).json({
        success: true,
        message: 'Guardian dashboard summary retrieved successfully',
        data: {
          role: 'GUARDIAN',
          childrenCount: children.length,
          children,
        },
      });
    }

    // ─── STUDENT path ─────────────────────────────────────────────────────────
    if (role === Role.STUDENT) {
      const [enrollments, upcomingTests, recentAttendance] = await Promise.all([
        // All active enrollments for this student (with batch info)
        prisma.enrollment.findMany({
          where: {
            studentId: userId,
            status: 'ACTIVE',
          },
          select: {
            batchId: true,
            batch: {
              select: { id: true, name: true },
            },
          },
        }),

        // Upcoming tests in enrolled batches over the next 7 days
        prisma.test.findMany({
          where: {
            batch: {
              enrollments: {
                some: { studentId: userId, status: 'ACTIVE' },
              },
            },
            testDate: {
              gte: todayNormalized,
              lte: sevenDaysFromNow,
            },
          },
          select: {
            id: true,
            title: true,
            testDate: true,
            type: true,
            batch: {
              select: { id: true, name: true },
            },
          },
          orderBy: { testDate: 'asc' },
          take: 5,
        }),

        // Attendance records for this student in the last 7 days
        prisma.attendance.findMany({
          where: {
            studentId: userId,
            date: { gte: sevenDaysAgo, lte: todayNormalized },
          },
          select: {
            date: true,
            status: true,
            batch: { select: { id: true, name: true } },
          },
          orderBy: { date: 'desc' },
          take: 10,
        }),
      ]);

      const enrolledBatchIds = enrollments.map((e) => e.batchId);

      return res.status(200).json({
        success: true,
        message: 'Student dashboard summary retrieved successfully',
        data: {
          role: 'STUDENT',
          enrolledBatchCount: enrollments.length,
          enrolledBatches: enrollments.map((e) => e.batch),
          upcomingTests,
          recentAttendance: {
            records: recentAttendance,
            presentCount: recentAttendance.filter((a) => a.status === 'PRESENT').length,
            absentCount: recentAttendance.filter((a) => a.status === 'ABSENT').length,
            lateCount: recentAttendance.filter((a) => a.status === 'LATE').length,
          },
        },
      });
    }

    // ─── ADMIN / TEACHER path ─────────────────────────────────────────────────
    const [
      totalActiveStudents,
      totalBatches,
      totalTeachers,
      allBatchesForAttendance,
      upcomingTests,
      recentResultCount,
    ] = await Promise.all([
      // Count active students in this branch
      prisma.user.count({
        where: {
          branchId,
          role: Role.STUDENT,
        },
      }),

      // Count batches in this branch
      prisma.batch.count({
        where: { branchId },
      }),

      // Count teachers in this branch
      prisma.user.count({
        where: {
          branchId,
          role: Role.TEACHER,
        },
      }),

      // All batches in branch with today's attendance data (reuse today-summary logic)
      prisma.batch.findMany({
        where: { branchId },
        select: {
          id: true,
          name: true,
          _count: {
            select: { enrollments: true },
          },
          attendances: {
            where: { date: todayNormalized },
            select: { id: true },
          },
        },
      }),

      // Upcoming tests in the next 7 days for this branch
      prisma.test.findMany({
        where: {
          batch: { branchId },
          testDate: {
            gte: todayNormalized,
            lte: sevenDaysFromNow,
          },
        },
        select: {
          id: true,
          title: true,
          testDate: true,
          type: true,
          batch: {
            select: { id: true, name: true },
          },
        },
        orderBy: { testDate: 'asc' },
        take: 5,
      }),

      // Count results submitted in the last 7 days (recent activity)
      prisma.result.count({
        where: {
          test: { batch: { branchId } },
          submittedAt: { gte: sevenDaysAgo },
        },
      }),
    ]);

    // Build attendance summary (reuse logic from getTodayAttendanceSummary)
    let markedBatches = 0;
    let partialBatches = 0;
    let unmarkedBatches = 0;

    for (const batch of allBatchesForAttendance) {
      const totalEnrolled = batch._count.enrollments;
      const markedCount = batch.attendances.length;

      if (markedCount === 0) {
        unmarkedBatches++;
      } else if (totalEnrolled > 0 && markedCount >= totalEnrolled) {
        markedBatches++;
      } else {
        partialBatches++;
      }
    }

    const totalBatchesForAttendance = allBatchesForAttendance.length;

    return res.status(200).json({
      success: true,
      message: 'Dashboard summary retrieved successfully',
      data: {
        role,
        stats: {
          totalActiveStudents,
          totalBatches,
          totalTeachers,
        },
        attendanceSummary: {
          totalBatches: totalBatchesForAttendance,
          markedBatches,
          partialBatches,
          unmarkedBatches,
        },
        upcomingTests,
        recentActivity: {
          testResultsThisWeek: recentResultCount,
        },
      },
    });
  } catch (error) {
    console.error('Get dashboard summary error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}
