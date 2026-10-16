import { Request, Response } from 'express';
import { z } from 'zod';
import { Prisma, Role, PaymentStatus, AttendanceStatus } from '@prisma/client';
import prisma from '../utils/prisma';

export const scoreDistributionQuerySchema = z.object({
  testId: z.string().optional(),
  batchId: z.string().optional(),
});

/**
 * GET /charts/revenue-monthly
 * Sum of amountPaid per month for the last 12 months, rounded to 2 decimals.
 * Scoped by branch for ADMIN/TEACHER; includes per-branch breakdown for SUPER_ADMIN.
 */
export async function getRevenueMonthlyChart(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const effectiveBranchId = req.effectiveBranchId;

    const where: Prisma.FeePaymentWhereInput = {
      amountPaid: { gt: 0 },
      OR: [
        { paidAt: { gte: twelveMonthsAgo } },
        { paidAt: null, createdAt: { gte: twelveMonthsAgo } },
      ],
    };

    if (effectiveBranchId) {
      where.batch = { branchId: effectiveBranchId };
    }

    const payments = await prisma.feePayment.findMany({
      where,
      select: {
        amountPaid: true,
        paidAt: true,
        createdAt: true,
        batch: {
          select: {
            branchId: true,
            branch: { select: { id: true, name: true } },
          },
        },
      },
    });

    // Generate 12 month keys (YYYY-MM)
    const monthKeys: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthKeys.push(mStr);
    }

    const monthlyTotals = new Map<string, number>();
    monthKeys.forEach((m) => monthlyTotals.set(m, 0));

    let totalSum = 0;

    // Per-branch tracking for SUPER_ADMIN when no branchId filter is applied
    const isSuperAdminAllBranches =
      req.user.role === Role.SUPER_ADMIN && !effectiveBranchId;
    const branchMap = new Map<
      string,
      { branchName: string; totals: Map<string, number>; totalRevenue: number }
    >();

    for (const p of payments) {
      const date = p.paidAt || p.createdAt;
      const mKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (monthlyTotals.has(mKey)) {
        monthlyTotals.set(mKey, (monthlyTotals.get(mKey) || 0) + p.amountPaid);
        totalSum += p.amountPaid;
      }

      if (isSuperAdminAllBranches && p.batch?.branch) {
        const bId = p.batch.branch.id;
        const bName = p.batch.branch.name;
        if (!branchMap.has(bId)) {
          const map = new Map<string, number>();
          monthKeys.forEach((m) => map.set(m, 0));
          branchMap.set(bId, { branchName: bName, totals: map, totalRevenue: 0 });
        }
        const bEntry = branchMap.get(bId)!;
        if (bEntry.totals.has(mKey)) {
          bEntry.totals.set(mKey, (bEntry.totals.get(mKey) || 0) + p.amountPaid);
          bEntry.totalRevenue += p.amountPaid;
        }
      }
    }

    const months = monthKeys.map((m) => ({
      month: m,
      revenue: Number((monthlyTotals.get(m) || 0).toFixed(2)),
    }));

    let branchBreakdown:
      | { branchId: string; branchName: string; totalRevenue: number; months: { month: string; revenue: number }[] }[]
      | undefined;

    if (isSuperAdminAllBranches) {
      branchBreakdown = Array.from(branchMap.entries()).map(([bId, entry]) => ({
        branchId: bId,
        branchName: entry.branchName,
        totalRevenue: Number(entry.totalRevenue.toFixed(2)),
        months: monthKeys.map((m) => ({
          month: m,
          revenue: Number((entry.totals.get(m) || 0).toFixed(2)),
        })),
      }));
    }

    return res.status(200).json({
      success: true,
      data: {
        months,
        totalRevenue: Number(totalSum.toFixed(2)),
        ...(branchBreakdown ? { branchBreakdown } : {}),
      },
    });
  } catch (error) {
    console.error('Error fetching monthly revenue chart:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve revenue chart' });
  }
}

/**
 * GET /charts/attendance-trend
 * Present rate over the last 30 days using real groupBy aggregation.
 */
export async function getAttendanceTrendChart(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const effectiveBranchId = req.effectiveBranchId;

    const groups = await prisma.attendance.groupBy({
      by: ['date', 'status'],
      where: {
        date: { gte: thirtyDaysAgo },
        ...(effectiveBranchId ? { batch: { branchId: effectiveBranchId } } : {}),
      },
      _count: { _all: true },
      orderBy: { date: 'asc' },
    });

    const dateMap = new Map<
      string,
      { date: string; present: number; absent: number; late: number; total: number }
    >();

    for (const g of groups) {
      const dStr = g.date.toISOString().split('T')[0];
      if (!dateMap.has(dStr)) {
        dateMap.set(dStr, { date: dStr, present: 0, absent: 0, late: 0, total: 0 });
      }
      const entry = dateMap.get(dStr)!;
      const count = g._count._all;
      entry.total += count;
      if (g.status === AttendanceStatus.PRESENT) entry.present += count;
      else if (g.status === AttendanceStatus.ABSENT) entry.absent += count;
      else if (g.status === AttendanceStatus.LATE) entry.late += count;
    }

    const trend = Array.from(dateMap.values()).map((item) => ({
      ...item,
      presentRate:
        item.total > 0 ? Number(((item.present / item.total) * 100).toFixed(1)) : 0,
    }));

    return res.status(200).json({
      success: true,
      data: {
        trend,
      },
    });
  } catch (error) {
    console.error('Error fetching attendance trend chart:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve attendance trend' });
  }
}

/**
 * GET /charts/enrollments-by-batch
 * Active enrollments count per batch. Includes branch breakdown for SUPER_ADMIN.
 */
export async function getEnrollmentsByBatchChart(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const effectiveBranchId = req.effectiveBranchId;

    const batches = await prisma.batch.findMany({
      where: effectiveBranchId ? { branchId: effectiveBranchId } : {},
      select: {
        id: true,
        name: true,
        branchId: true,
        branch: { select: { id: true, name: true } },
        _count: {
          select: {
            enrollments: { where: { status: 'ACTIVE' } },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const items = batches.map((b) => ({
      batchId: b.id,
      batchName: b.name,
      branchId: b.branchId,
      branchName: b.branch?.name,
      activeEnrollments: b._count.enrollments,
    }));

    let branchBreakdown: { branchId: string; branchName: string; totalActiveEnrollments: number }[] | undefined;

    if (req.user.role === Role.SUPER_ADMIN && !effectiveBranchId) {
      const bMap = new Map<string, { branchName: string; total: number }>();
      for (const item of items) {
        if (!bMap.has(item.branchId)) {
          bMap.set(item.branchId, { branchName: item.branchName || 'Unknown', total: 0 });
        }
        bMap.get(item.branchId)!.total += item.activeEnrollments;
      }
      branchBreakdown = Array.from(bMap.entries()).map(([bId, val]) => ({
        branchId: bId,
        branchName: val.branchName,
        totalActiveEnrollments: val.total,
      }));
    }

    return res.status(200).json({
      success: true,
      data: {
        batches: items,
        ...(branchBreakdown ? { branchBreakdown } : {}),
      },
    });
  } catch (error) {
    console.error('Error fetching enrollments by batch chart:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve enrollments by batch' });
  }
}

/**
 * GET /charts/score-distribution
 * Score distribution bucketed in 10% increments for an optional testId or batchId.
 */
export async function getScoreDistributionChart(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const parseResult = scoreDistributionQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        data: parseResult.error.flatten(),
      });
    }

    const { testId, batchId } = parseResult.data;
    const effectiveBranchId = req.effectiveBranchId;

    const where: Prisma.ResultWhereInput = {};

    const testWhere: Prisma.TestWhereInput = {};

    if (effectiveBranchId) {
      testWhere.batch = { branchId: effectiveBranchId };
    }

    if (batchId) {
      testWhere.batchId = batchId;
    }

    if (Object.keys(testWhere).length > 0) {
      where.test = testWhere;
    }

    if (testId) where.testId = testId;

    const results = await prisma.result.findMany({
      where,
      select: {
        totalMarksObtained: true,
        test: {
          select: {
            totalMarks: true,
          },
        },
      },
    });

    const buckets = [
      { label: '0-10%', min: 0, max: 10, count: 0 },
      { label: '10-20%', min: 10, max: 20, count: 0 },
      { label: '20-30%', min: 20, max: 30, count: 0 },
      { label: '30-40%', min: 30, max: 40, count: 0 },
      { label: '40-50%', min: 40, max: 50, count: 0 },
      { label: '50-60%', min: 50, max: 60, count: 0 },
      { label: '60-70%', min: 60, max: 70, count: 0 },
      { label: '70-80%', min: 70, max: 80, count: 0 },
      { label: '80-90%', min: 80, max: 90, count: 0 },
      { label: '90-100%', min: 90, max: 100, count: 0 },
    ];

    for (const r of results) {
      if (!r.test || r.test.totalMarks <= 0) continue;
      const percentage = Math.min(
        100,
        Math.max(0, (r.totalMarksObtained / r.test.totalMarks) * 100)
      );
      const bucketIdx = Math.min(9, Math.floor(percentage / 10));
      buckets[bucketIdx].count++;
    }

    return res.status(200).json({
      success: true,
      data: {
        totalResults: results.length,
        buckets,
      },
    });
  } catch (error) {
    console.error('Error fetching score distribution chart:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve score distribution' });
  }
}

/**
 * GET /charts/fee-status
 * Counts and sums per payment status via groupBy.
 */
export async function getFeeStatusChart(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const effectiveBranchId = req.effectiveBranchId;

    const groups = await prisma.feePayment.groupBy({
      by: ['status'],
      where: effectiveBranchId ? { batch: { branchId: effectiveBranchId } } : {},
      _count: { _all: true },
      _sum: { amountDue: true, amountPaid: true },
    });

    const statusSummary = {
      DUE: { count: 0, amountDue: 0, amountPaid: 0 },
      PARTIAL: { count: 0, amountDue: 0, amountPaid: 0 },
      PAID: { count: 0, amountDue: 0, amountPaid: 0 },
    };

    for (const g of groups) {
      if (g.status in statusSummary) {
        statusSummary[g.status] = {
          count: g._count._all,
          amountDue: Number((g._sum.amountDue || 0).toFixed(2)),
          amountPaid: Number((g._sum.amountPaid || 0).toFixed(2)),
        };
      }
    }

    let branchBreakdown:
      | { branchId: string; branchName: string; statusCounts: Record<string, number> }[]
      | undefined;

    if (req.user.role === Role.SUPER_ADMIN && !effectiveBranchId) {
      const branches = await prisma.branch.findMany({
        select: {
          id: true,
          name: true,
          batches: {
            select: {
              feePayments: {
                select: {
                  status: true,
                },
              },
            },
          },
        },
      });

      branchBreakdown = branches.map((b) => {
        const counts: Record<string, number> = { DUE: 0, PARTIAL: 0, PAID: 0 };
        for (const batch of b.batches) {
          for (const payment of batch.feePayments) {
            counts[payment.status] = (counts[payment.status] || 0) + 1;
          }
        }
        return {
          branchId: b.id,
          branchName: b.name,
          statusCounts: counts,
        };
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        statusSummary,
        ...(branchBreakdown ? { branchBreakdown } : {}),
      },
    });
  } catch (error) {
    console.error('Error fetching fee status chart:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve fee status chart' });
  }
}

/**
 * GET /charts/my-scores
 * STUDENT only: personal test score trend.
 */
export async function getMyScoresChart(req: Request, res: Response) {
  try {
    if (!req.user || req.user.role !== Role.STUDENT) {
      return res.status(403).json({ success: false, message: 'Forbidden: Students only' });
    }

    const results = await prisma.result.findMany({
      where: { studentId: req.user.userId },
      orderBy: { submittedAt: 'asc' },
      select: {
        id: true,
        totalMarksObtained: true,
        rank: true,
        submittedAt: true,
        test: {
          select: {
            id: true,
            title: true,
            totalMarks: true,
            testDate: true,
            batch: { select: { id: true, name: true } },
          },
        },
      },
    });

    const trend = results.map((r) => {
      const percentage =
        r.test.totalMarks > 0
          ? Number(((r.totalMarksObtained / r.test.totalMarks) * 100).toFixed(1))
          : 0;

      return {
        testId: r.test.id,
        testTitle: r.test.title,
        batchName: r.test.batch.name,
        testDate: r.test.testDate,
        submittedAt: r.submittedAt,
        marksObtained: r.totalMarksObtained,
        totalMarks: r.test.totalMarks,
        percentage,
        rank: r.rank,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        trend,
      },
    });
  } catch (error) {
    console.error('Error fetching student score trend:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve student score trend' });
  }
}

/**
 * GET /charts/my-attendance
 * STUDENT only: personal attendance stats and recent records.
 */
export async function getMyAttendanceChart(req: Request, res: Response) {
  try {
    if (!req.user || req.user.role !== Role.STUDENT) {
      return res.status(403).json({ success: false, message: 'Forbidden: Students only' });
    }

    const [statusGroups, recentRecords] = await Promise.all([
      prisma.attendance.groupBy({
        by: ['status'],
        where: { studentId: req.user.userId },
        _count: { _all: true },
      }),
      prisma.attendance.findMany({
        where: { studentId: req.user.userId },
        orderBy: { date: 'desc' },
        take: 30,
        select: {
          id: true,
          date: true,
          status: true,
          batch: { select: { id: true, name: true } },
        },
      }),
    ]);

    let total = 0;
    let present = 0;
    let absent = 0;
    let late = 0;

    for (const g of statusGroups) {
      const c = g._count._all;
      total += c;
      if (g.status === AttendanceStatus.PRESENT) present += c;
      else if (g.status === AttendanceStatus.ABSENT) absent += c;
      else if (g.status === AttendanceStatus.LATE) late += c;
    }

    const presentRate = total > 0 ? Number(((present / total) * 100).toFixed(1)) : 0;

    return res.status(200).json({
      success: true,
      data: {
        summary: {
          total,
          present,
          absent,
          late,
          presentRate,
        },
        recentRecords,
      },
    });
  } catch (error) {
    console.error('Error fetching student attendance chart:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve student attendance chart' });
  }
}

/**
 * GET /charts/overview
 * Role-appropriate overview counters using single aggregation/groupBy queries.
 */
export async function getOverviewChart(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { userId, role } = req.user;
    const now = new Date();

    // ─── STUDENT Overview ───────────────────────────────────────────────────
    if (role === Role.STUDENT) {
      const [enrolledBatchesCount, attendanceGroups, scoreAgg, feeAgg] = await Promise.all([
        prisma.enrollment.count({
          where: { studentId: userId, status: 'ACTIVE' },
        }),
        prisma.attendance.groupBy({
          by: ['status'],
          where: { studentId: userId },
          _count: { _all: true },
        }),
        prisma.result.aggregate({
          where: { studentId: userId },
          _avg: { totalMarksObtained: true },
          _count: { _all: true },
        }),
        prisma.feePayment.aggregate({
          where: {
            studentId: userId,
            status: { in: [PaymentStatus.DUE, PaymentStatus.PARTIAL] },
          },
          _count: { _all: true },
          _sum: { amountDue: true, amountPaid: true },
        }),
      ]);

      let totalAtt = 0;
      let presentAtt = 0;
      for (const g of attendanceGroups) {
        totalAtt += g._count._all;
        if (g.status === AttendanceStatus.PRESENT) presentAtt += g._count._all;
      }
      const attendanceRate =
        totalAtt > 0 ? Number(((presentAtt / totalAtt) * 100).toFixed(1)) : 0;

      const dues = feeAgg._count._all;
      const dueAmount = Number(
        ((feeAgg._sum.amountDue || 0) - (feeAgg._sum.amountPaid || 0)).toFixed(2)
      );

      return res.status(200).json({
        success: true,
        data: {
          role: 'STUDENT',
          enrolledBatches: enrolledBatchesCount,
          attendanceRate,
          averageScore: scoreAgg._avg.totalMarksObtained
            ? Number(scoreAgg._avg.totalMarksObtained.toFixed(1))
            : 0,
          duesCount: dues,
          dueAmount,
        },
      });
    }

    // ─── GUARDIAN Overview ──────────────────────────────────────────────────
    if (role === Role.GUARDIAN) {
      const links = await prisma.guardianLink.findMany({
        where: { guardianId: userId },
        select: { studentId: true },
      });
      const studentIds = links.map((l) => l.studentId);

      const [enrolledBatchesCount, feeAgg] = await Promise.all([
        prisma.enrollment.count({
          where: { studentId: { in: studentIds }, status: 'ACTIVE' },
        }),
        prisma.feePayment.aggregate({
          where: {
            studentId: { in: studentIds },
            status: { in: [PaymentStatus.DUE, PaymentStatus.PARTIAL] },
          },
          _count: { _all: true },
          _sum: { amountDue: true, amountPaid: true },
        }),
      ]);

      const dueAmount = Number(
        ((feeAgg._sum.amountDue || 0) - (feeAgg._sum.amountPaid || 0)).toFixed(2)
      );

      return res.status(200).json({
        success: true,
        data: {
          role: 'GUARDIAN',
          childrenCount: studentIds.length,
          enrolledBatches: enrolledBatchesCount,
          duesCount: feeAgg._count._all,
          dueAmount,
        },
      });
    }

    // ─── ADMIN / TEACHER / SUPER_ADMIN Overview ─────────────────────────────
    const effectiveBranchId = req.effectiveBranchId;
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const today = new Date(now.toISOString().split('T')[0] + 'T00:00:00.000Z');
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

    const [
      studentsCount,
      teachersCount,
      batchesCount,
      monthRevenueAgg,
      todayAttendanceGroups,
      duesAgg,
    ] = await Promise.all([
      prisma.user.count({
        where: {
          role: Role.STUDENT,
          ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
        },
      }),
      prisma.user.count({
        where: {
          role: Role.TEACHER,
          ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
        },
      }),
      prisma.batch.count({
        where: effectiveBranchId ? { branchId: effectiveBranchId } : {},
      }),
      prisma.feePayment.aggregate({
        where: {
          ...(effectiveBranchId ? { batch: { branchId: effectiveBranchId } } : {}),
          amountPaid: { gt: 0 },
          OR: [
            { paidAt: { gte: startOfMonth } },
            { paidAt: null, createdAt: { gte: startOfMonth } },
          ],
        },
        _sum: { amountPaid: true },
      }),
      prisma.attendance.groupBy({
        by: ['status'],
        where: {
          ...(effectiveBranchId ? { batch: { branchId: effectiveBranchId } } : {}),
          date: { gte: today, lt: tomorrow },
        },
        _count: { _all: true },
      }),
      prisma.feePayment.aggregate({
        where: {
          ...(effectiveBranchId ? { batch: { branchId: effectiveBranchId } } : {}),
          status: { in: [PaymentStatus.DUE, PaymentStatus.PARTIAL] },
        },
        _count: { _all: true },
        _sum: { amountDue: true, amountPaid: true },
      }),
    ]);

    let todayTotalAtt = 0;
    let todayPresentAtt = 0;
    for (const g of todayAttendanceGroups) {
      todayTotalAtt += g._count._all;
      if (g.status === AttendanceStatus.PRESENT) todayPresentAtt += g._count._all;
    }
    const todayAttendanceRate =
      todayTotalAtt > 0
        ? Number(((todayPresentAtt / todayTotalAtt) * 100).toFixed(1))
        : 0;

    const monthRevenue = Number((monthRevenueAgg._sum.amountPaid || 0).toFixed(2));
    const duesCount = duesAgg._count._all;
    const totalDueAmount = Number(
      ((duesAgg._sum.amountDue || 0) - (duesAgg._sum.amountPaid || 0)).toFixed(2)
    );

    return res.status(200).json({
      success: true,
      data: {
        role,
        students: studentsCount,
        teachers: teachersCount,
        batches: batchesCount,
        monthRevenue,
        todayAttendanceRate,
        duesCount,
        totalDueAmount,
      },
    });
  } catch (error) {
    console.error('Error fetching overview cards:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve overview metrics' });
  }
}
