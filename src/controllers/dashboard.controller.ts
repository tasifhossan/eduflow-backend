import { Request, Response } from 'express';
import { Role, EnrollmentStatus, LectureStatus, AssignmentSubmissionStatus } from '@prisma/client';
import prisma from '../utils/prisma';
import { getCenterSettings } from '../services/settings.service';
import { getAcademicDateRanges } from '../utils/timezone';

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

    // ─── ADMIN / TEACHER / SUPER_ADMIN path ──────────────────────────────────
    const effectiveBranchId = req.effectiveBranchId;

    const [
      totalActiveStudents,
      totalBatches,
      totalTeachers,
      allBatchesForAttendance,
      upcomingTests,
      recentResultCount,
    ] = await Promise.all([
      // Count active students
      prisma.user.count({
        where: {
          ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
          role: Role.STUDENT,
        },
      }),

      // Count batches
      prisma.batch.count({
        where: effectiveBranchId ? { branchId: effectiveBranchId } : {},
      }),

      // Count teachers
      prisma.user.count({
        where: {
          ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
          role: Role.TEACHER,
        },
      }),

      // All batches with today's attendance data (reuse today-summary logic)
      prisma.batch.findMany({
        where: effectiveBranchId ? { branchId: effectiveBranchId } : {},
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

      // Upcoming tests in the next 7 days
      prisma.test.findMany({
        where: {
          ...(effectiveBranchId ? { batch: { branchId: effectiveBranchId } } : {}),
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
          ...(effectiveBranchId ? { test: { batch: { branchId: effectiveBranchId } } } : {}),
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

export async function getSuperAdminDashboard(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const [
      branches,
      totalStudents,
      totalTeachers,
      paymentsAggregate,
      attendances,
    ] = await Promise.all([
      // All branches with counts
      prisma.branch.findMany({
        select: {
          id: true,
          name: true,
          address: true,
          _count: {
            select: {
              users: { where: { role: Role.STUDENT } },
              batches: true,
            },
          },
          batches: {
            select: {
              feePayments: {
                select: { amountPaid: true },
              },
            },
          },
        },
        orderBy: { name: 'asc' },
      }),

      // Count active students overall
      prisma.user.count({
        where: { role: Role.STUDENT },
      }),

      // Count teachers overall
      prisma.user.count({
        where: { role: Role.TEACHER },
      }),

      // Total revenue across all payments
      prisma.feePayment.aggregate({
        _sum: { amountPaid: true },
      }),

      // Attendance records for overall attendance rate calculation
      prisma.attendance.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
    ]);

    const totalBranches = branches.length;
    const totalRevenue = paymentsAggregate._sum.amountPaid || 0;

    // Overall attendance rate computation
    let totalAttendanceRecords = 0;
    let presentAttendanceRecords = 0;
    for (const group of attendances) {
      const count = group._count._all;
      totalAttendanceRecords += count;
      if (group.status === 'PRESENT') {
        presentAttendanceRecords += count;
      }
    }
    const overallAttendanceRate =
      totalAttendanceRecords > 0
        ? parseFloat(((presentAttendanceRecords / totalAttendanceRecords) * 100).toFixed(1))
        : 0;

    // Build branch breakdown array
    const branchBreakdown = branches.map((b) => {
      const studentCount = b._count.users;
      const batchCount = b._count.batches;
      const branchRevenue = b.batches.reduce((sum, batch) => {
        const batchPayments = batch.feePayments.reduce((pSum, p) => pSum + (p.amountPaid || 0), 0);
        return sum + batchPayments;
      }, 0);

      return {
        branchId: b.id,
        branchName: b.name,
        address: b.address,
        studentCount,
        batchCount,
        totalRevenue: branchRevenue,
      };
    });

    return res.status(200).json({
      success: true,
      message: 'Super admin dashboard summary retrieved successfully',
      data: {
        totalBranches,
        totalStudents,
        totalTeachers,
        totalRevenue,
        overallAttendanceRate,
        branchBreakdown,
      },
    });
  } catch (error) {
    console.error('Get super admin dashboard error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function getAcademicSummary(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const { userId, role, branchId: userBranchId } = req.user;
    const branchIdQuery = req.query.branchId as string | undefined;
    const studentIdQuery = req.query.studentId as string | undefined;

    const settings = await getCenterSettings();
    const timeZone = settings.timezone || 'Asia/Dhaka';
    const weekStartsOn = settings.weekStartsOn ?? 6;

    const now = new Date();
    const { todayStart, todayEnd, weekStart, weekEnd } = getAcademicDateRanges(now, timeZone, weekStartsOn);
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Build role-scoped filters
    let lectureBaseWhere: any = {};
    let assignmentBaseWhere: any = {};
    let submissionBaseWhere: any = {};

    if (role === Role.SUPER_ADMIN) {
      const targetBranchId = branchIdQuery || undefined;
      if (targetBranchId) {
        lectureBaseWhere = { batch: { branchId: targetBranchId } };
        assignmentBaseWhere = { batch: { branchId: targetBranchId } };
        submissionBaseWhere = { assignment: { batch: { branchId: targetBranchId } } };
      }
    } else if (role === Role.ADMIN) {
      lectureBaseWhere = { batch: { branchId: userBranchId } };
      assignmentBaseWhere = { batch: { branchId: userBranchId } };
      submissionBaseWhere = { assignment: { batch: { branchId: userBranchId } } };
    } else if (role === Role.TEACHER) {
      lectureBaseWhere = { teacherId: userId };
      assignmentBaseWhere = { batch: { teacherId: userId } };
      submissionBaseWhere = { assignment: { batch: { teacherId: userId } } };
    } else if (role === Role.STUDENT) {
      lectureBaseWhere = {
        isPublished: true,
        batch: { enrollments: { some: { studentId: userId, status: EnrollmentStatus.ACTIVE } } },
      };
      assignmentBaseWhere = {
        publishedAt: { lte: now },
        batch: { enrollments: { some: { studentId: userId, status: EnrollmentStatus.ACTIVE } } },
      };
      submissionBaseWhere = null;
    } else if (role === Role.GUARDIAN) {
      let targetStudentIds: string[] = [];
      if (studentIdQuery) {
        const link = await prisma.guardianLink.findUnique({
          where: {
            guardianId_studentId: {
              guardianId: userId,
              studentId: studentIdQuery,
            },
          },
        });
        if (!link) {
          return res.status(403).json({
            success: false,
            message: 'Forbidden: Student not linked to this guardian',
          });
        }
        targetStudentIds = [studentIdQuery];
      } else {
        const links = await prisma.guardianLink.findMany({
          where: { guardianId: userId },
          select: { studentId: true },
        });
        targetStudentIds = links.map((l) => l.studentId);
      }

      lectureBaseWhere = {
        isPublished: true,
        batch: { enrollments: { some: { studentId: { in: targetStudentIds }, status: EnrollmentStatus.ACTIVE } } },
      };
      assignmentBaseWhere = {
        publishedAt: { lte: now },
        batch: { enrollments: { some: { studentId: { in: targetStudentIds }, status: EnrollmentStatus.ACTIVE } } },
      };
      submissionBaseWhere = null;
    }

    // 1. lecturesToday (single count query)
    const lecturesTodayPromise = prisma.lecture.count({
      where: {
        ...lectureBaseWhere,
        startsAt: { gte: todayStart, lte: todayEnd },
        status: { not: LectureStatus.CANCELLED },
      },
    });

    // 2. lecturesThisWeek (single count query)
    const lecturesThisWeekPromise = prisma.lecture.count({
      where: {
        ...lectureBaseWhere,
        startsAt: { gte: weekStart, lte: weekEnd },
        status: { not: LectureStatus.CANCELLED },
      },
    });

    // 3. overdueAssignments (single count query)
    let overdueAssignmentsPromise: Promise<number>;
    if (role === Role.STUDENT) {
      overdueAssignmentsPromise = prisma.assignment.count({
        where: {
          ...assignmentBaseWhere,
          dueAt: { lt: now },
          submissions: { none: { studentId: userId } },
        },
      });
    } else if (role === Role.GUARDIAN) {
      const targetIds = lectureBaseWhere?.batch?.enrollments?.some?.studentId?.in || [];
      overdueAssignmentsPromise = prisma.assignment.count({
        where: {
          ...assignmentBaseWhere,
          dueAt: { lt: now },
          submissions: { none: { studentId: { in: targetIds } } },
        },
      });
    } else {
      overdueAssignmentsPromise = prisma.assignment.count({
        where: {
          ...assignmentBaseWhere,
          dueAt: { lt: now },
        },
      });
    }

    // 4. needsGrading (single count query)
    let needsGradingPromise: Promise<number>;
    if (submissionBaseWhere === null) {
      needsGradingPromise = Promise.resolve(0);
    } else {
      needsGradingPromise = prisma.assignmentSubmission.count({
        where: {
          ...submissionBaseWhere,
          status: AssignmentSubmissionStatus.SUBMITTED,
        },
      });
    }

    // 5. upcomingAssignments (next 7 days, single count query)
    const upcomingAssignmentsPromise = prisma.assignment.count({
      where: {
        ...assignmentBaseWhere,
        dueAt: { gte: now, lte: in7Days },
      },
    });

    // 6. unreadNotifications (single count query)
    const unreadNotificationsPromise = prisma.notification.count({
      where: {
        userId,
        readAt: null,
      },
    });

    const [
      lecturesToday,
      lecturesThisWeek,
      overdueAssignments,
      needsGrading,
      upcomingAssignments,
      unreadNotifications,
    ] = await Promise.all([
      lecturesTodayPromise,
      lecturesThisWeekPromise,
      overdueAssignmentsPromise,
      needsGradingPromise,
      upcomingAssignmentsPromise,
      unreadNotificationsPromise,
    ]);

    return res.status(200).json({
      success: true,
      data: {
        lecturesToday,
        lecturesThisWeek,
        overdueAssignments,
        needsGrading,
        upcomingAssignments,
        unreadNotifications,
      },
    });
  } catch (error) {
    console.error('Get academic summary error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error calculating academic summary',
    });
  }
}


