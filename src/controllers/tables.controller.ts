import { Request, Response } from 'express';
import { z } from 'zod';
import {
  Prisma,
  Role,
  PaymentStatus,
  AttendanceStatus,
  EnrollmentStatus,
} from '@prisma/client';
import prisma from '../utils/prisma';
import { parsePagination, buildMeta } from '../utils/pagination';
import { moneyToNumber } from '../utils/money';

// Helper to fetch linked student IDs for a guardian
async function getGuardianStudentIds(guardianId: string): Promise<string[]> {
  const links = await prisma.guardianLink.findMany({
    where: { guardianId },
    select: { studentId: true },
  });
  return links.map((l) => l.studentId);
}

// Helper to build date range filters
function parseDateRange(start?: string, end?: string): { gte?: Date; lte?: Date } | undefined {
  if (!start && !end) return undefined;
  const range: { gte?: Date; lte?: Date } = {};
  if (start) {
    const s = new Date(start);
    if (!isNaN(s.getTime())) range.gte = s;
  }
  if (end) {
    const e = new Date(end);
    if (!isNaN(e.getTime())) {
      if (end.length <= 10) {
        e.setUTCHours(23, 59, 59, 999);
      }
      range.lte = e;
    }
  }
  return Object.keys(range).length > 0 ? range : undefined;
}

// ─── Query Schemas ──────────────────────────────────────────────────────────

export const userTableQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(12),
  role: z.nativeEnum(Role).optional(),
  branch: z.string().optional(),
  branchId: z.string().optional(),
  q: z.string().trim().optional(),
  sortBy: z.enum(['name', 'email', 'role', 'createdAt']).optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

export const studentTableQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(12),
  batch: z.string().optional(),
  batchId: z.string().optional(),
  branch: z.string().optional(),
  branchId: z.string().optional(),
  q: z.string().trim().optional(),
  sortBy: z.enum(['name', 'email', 'createdAt']).optional().default('name'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
});

export const paymentTableQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(12),
  status: z.string().optional(),
  batch: z.string().optional(),
  batchId: z.string().optional(),
  branchId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  q: z.string().trim().optional(),
  sortBy: z
    .enum(['createdAt', 'amount', 'amountPaid', 'amountDue', 'paidAt', 'receiptNumber'])
    .optional()
    .default('paidAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

export const attendanceTableQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(12),
  status: z.nativeEnum(AttendanceStatus).optional(),
  batch: z.string().optional(),
  batchId: z.string().optional(),
  branchId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  q: z.string().trim().optional(),
  sortBy: z.enum(['date', 'status', 'createdAt']).optional().default('date'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

export const resultTableQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(12),
  test: z.string().optional(),
  testId: z.string().optional(),
  batch: z.string().optional(),
  batchId: z.string().optional(),
  branchId: z.string().optional(),
  q: z.string().trim().optional(),
  sortBy: z.enum(['submittedAt', 'totalMarksObtained', 'rank']).optional().default('submittedAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

export const enrollmentTableQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(12),
  status: z.nativeEnum(EnrollmentStatus).optional(),
  batch: z.string().optional(),
  batchId: z.string().optional(),
  branchId: z.string().optional(),
  q: z.string().trim().optional(),
  sortBy: z.enum(['enrolledAt', 'status']).optional().default('enrolledAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

// ─── Table Endpoints ────────────────────────────────────────────────────────

/**
 * GET /tables/users
 * ADMIN and SUPER_ADMIN only.
 * Paginated list of users with search, role, and branch filtering.
 */
export async function getTableUsers(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const parseResult = userTableQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        data: parseResult.error.flatten(),
      });
    }

    const { page, limit, role, branch, branchId, q, sortBy, sortOrder } = parseResult.data;
    const { skip, take } = parsePagination({ page, limit }, { defaultLimit: 12, maxLimit: 100 });

    const where: Prisma.UserWhereInput = {};

    // Branch scoping
    if (req.user.role === Role.SUPER_ADMIN) {
      const targetBranch = branch || branchId || req.effectiveBranchId;
      if (targetBranch) where.branchId = targetBranch;
    } else {
      where.branchId = req.user.branchId;
    }

    if (role) where.role = role;

    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { [sortBy]: sortOrder },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          branchId: true,
          branch: { select: { id: true, name: true } },
          avatarUrl: true,
          bio: true,
          headline: true,
          isPublicProfile: true,
          createdAt: true,
        },
      }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        items,
        pagination: buildMeta(total, page, take),
      },
    });
  } catch (error) {
    console.error('Error fetching table users:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve users table' });
  }
}

/**
 * GET /tables/students
 * ADMIN, TEACHER, SUPER_ADMIN.
 * Paginated list of students filtered by batch, branch, and search text.
 */
export async function getTableStudents(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const parseResult = studentTableQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        data: parseResult.error.flatten(),
      });
    }

    const { page, limit, batch, batchId, branch, branchId, q, sortBy, sortOrder } =
      parseResult.data;
    const { skip, take } = parsePagination({ page, limit }, { defaultLimit: 12, maxLimit: 100 });

    const where: Prisma.UserWhereInput = {
      role: Role.STUDENT,
    };

    // Branch scoping
    if (req.user.role === Role.SUPER_ADMIN) {
      const targetBranch = branch || branchId || req.effectiveBranchId;
      if (targetBranch) where.branchId = targetBranch;
    } else {
      where.branchId = req.user.branchId;
    }

    const targetBatch = batch || batchId;
    if (targetBatch) {
      where.enrollments = { some: { batchId: targetBatch } };
    }

    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
        { guardianName: { contains: q, mode: 'insensitive' } },
        { guardianPhone: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { [sortBy]: sortOrder },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          guardianName: true,
          guardianPhone: true,
          branchId: true,
          branch: { select: { id: true, name: true } },
          avatarUrl: true,
          createdAt: true,
          enrollments: {
            select: {
              id: true,
              batchId: true,
              batch: { select: { id: true, name: true } },
              status: true,
            },
          },
        },
      }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        items,
        pagination: buildMeta(total, page, take),
      },
    });
  } catch (error) {
    console.error('Error fetching table students:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve students table' });
  }
}

/**
 * GET /tables/payments
 * Scoped payments table with status, batch, date range, and text search.
 */
export async function getTablePayments(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const parseResult = paymentTableQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        data: parseResult.error.flatten(),
      });
    }

    const { page, limit, status, batch, batchId, branchId, startDate, endDate, q, sortBy, sortOrder } =
      parseResult.data;
    const { skip, take } = parsePagination({ page, limit }, { defaultLimit: 12, maxLimit: 100 });

    const where: Prisma.PaymentWhereInput = {};

    // Scoping rule
    if (req.user.role === Role.STUDENT) {
      where.studentId = req.user.userId;
    } else if (req.user.role === Role.GUARDIAN) {
      const studentIds = await getGuardianStudentIds(req.user.userId);
      if (studentIds.length === 0) {
        return res.status(200).json({
          success: true,
          data: { items: [], pagination: buildMeta(0, page, take) },
        });
      }
      where.studentId = { in: studentIds };
    } else if (req.user.role === Role.SUPER_ADMIN) {
      const targetBranch = branchId || req.effectiveBranchId;
      if (targetBranch) where.branchId = targetBranch;
    } else {
      // TEACHER, ADMIN, ACCOUNTANT
      where.branchId = req.user.branchId;
    }

    if (status === 'REVERSED') {
      where.reversal = { isNot: null };
    } else if (status === 'PAID') {
      where.reversal = null;
    }

    const targetBatch = batch || batchId;
    if (targetBatch) {
      where.allocations = { some: { charge: { batchId: targetBatch } } };
    }

    const dateFilter = parseDateRange(startDate, endDate);
    if (dateFilter) where.receivedAt = dateFilter;

    if (q) {
      where.OR = [
        { student: { name: { contains: q, mode: 'insensitive' } } },
        { student: { email: { contains: q, mode: 'insensitive' } } },
        { receiptNumber: { contains: q, mode: 'insensitive' } },
      ];
    }

    const mappedSortBy =
      sortBy === 'amountPaid' || sortBy === 'amountDue'
        ? 'amount'
        : sortBy === 'paidAt'
        ? 'receivedAt'
        : sortBy;

    const [total, rawItems] = await Promise.all([
      prisma.payment.count({ where }),
      prisma.payment.findMany({
        where,
        skip,
        take,
        orderBy: { [mappedSortBy]: sortOrder },
        select: {
          id: true,
          receiptNumber: true,
          studentId: true,
          student: { select: { id: true, name: true, email: true } },
          amount: true,
          method: true,
          reference: true,
          receivedAt: true,
          note: true,
          createdAt: true,
          reversal: { select: { id: true, reason: true, reversedAt: true } },
          allocations: {
            select: {
              id: true,
              amount: true,
              charge: {
                select: {
                  id: true,
                  description: true,
                  period: true,
                  batchId: true,
                  batch: { select: { id: true, name: true, branchId: true } },
                },
              },
            },
          },
        },
      }),
    ]);

    const items = rawItems.map((p) => {
      const firstBatch = p.allocations[0]?.charge.batch;
      const numAmount = moneyToNumber(p.amount);
      return {
        id: p.id,
        receiptNumber: p.receiptNumber,
        studentId: p.studentId,
        student: p.student,
        batchId: firstBatch?.id || null,
        batch: firstBatch || null,
        period: p.allocations[0]?.charge.period || null,
        amount: numAmount,
        amountPaid: numAmount,
        amountDue: 0,
        status: p.reversal ? 'REVERSED' : 'PAID',
        isReversed: !!p.reversal,
        reversal: p.reversal,
        method: p.method,
        reference: p.reference,
        dueDate: null,
        paidAt: p.receivedAt,
        receivedAt: p.receivedAt,
        notes: p.note,
        note: p.note,
        allocations: p.allocations.map((a) => ({
          id: a.id,
          amount: moneyToNumber(a.amount),
          chargeId: a.charge.id,
          chargeTitle: a.charge.description,
          description: a.charge.description,
          period: a.charge.period,
          batch: a.charge.batch,
        })),
        createdAt: p.createdAt,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        items,
        pagination: buildMeta(total, page, take),
      },
    });
  } catch (error) {
    console.error('Error fetching table payments:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve payments table' });
  }
}

/**
 * GET /tables/attendance
 * Scoped attendance table with batch, status, date range, and student search.
 */
export async function getTableAttendance(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const parseResult = attendanceTableQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        data: parseResult.error.flatten(),
      });
    }

    const { page, limit, status, batch, batchId, branchId, startDate, endDate, q, sortBy, sortOrder } =
      parseResult.data;
    const { skip, take } = parsePagination({ page, limit }, { defaultLimit: 12, maxLimit: 100 });

    const where: Prisma.AttendanceWhereInput = {};

    // Scoping rule
    if (req.user.role === Role.STUDENT) {
      where.studentId = req.user.userId;
    } else if (req.user.role === Role.GUARDIAN) {
      const studentIds = await getGuardianStudentIds(req.user.userId);
      if (studentIds.length === 0) {
        return res.status(200).json({
          success: true,
          data: { items: [], pagination: buildMeta(0, page, take) },
        });
      }
      where.studentId = { in: studentIds };
    } else if (req.user.role === Role.SUPER_ADMIN) {
      const targetBranch = branchId || req.effectiveBranchId;
      if (targetBranch) where.batch = { branchId: targetBranch };
    } else {
      where.batch = { branchId: req.user.branchId };
    }

    if (status) where.status = status;

    const targetBatch = batch || batchId;
    if (targetBatch) where.batchId = targetBatch;

    const dateFilter = parseDateRange(startDate, endDate);
    if (dateFilter) where.date = dateFilter;

    if (q) {
      where.student = {
        name: { contains: q, mode: 'insensitive' },
      };
    }

    const [total, items] = await Promise.all([
      prisma.attendance.count({ where }),
      prisma.attendance.findMany({
        where,
        skip,
        take,
        orderBy: { [sortBy]: sortOrder },
        select: {
          id: true,
          studentId: true,
          student: { select: { id: true, name: true, email: true } },
          batchId: true,
          batch: { select: { id: true, name: true, branchId: true } },
          date: true,
          status: true,
          markedById: true,
          markedBy: { select: { id: true, name: true } },
          createdAt: true,
        },
      }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        items,
        pagination: buildMeta(total, page, take),
      },
    });
  } catch (error) {
    console.error('Error fetching table attendance:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve attendance table' });
  }
}

/**
 * GET /tables/results
 * Scoped test results table with test and batch filters.
 */
export async function getTableResults(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const parseResult = resultTableQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        data: parseResult.error.flatten(),
      });
    }

    const { page, limit, test, testId, batch, batchId, branchId, q, sortBy, sortOrder } =
      parseResult.data;
    const { skip, take } = parsePagination({ page, limit }, { defaultLimit: 12, maxLimit: 100 });

    const where: Prisma.ResultWhereInput = {};

    // Scoping rule
    if (req.user.role === Role.STUDENT) {
      where.studentId = req.user.userId;
    } else if (req.user.role === Role.GUARDIAN) {
      const studentIds = await getGuardianStudentIds(req.user.userId);
      if (studentIds.length === 0) {
        return res.status(200).json({
          success: true,
          data: { items: [], pagination: buildMeta(0, page, take) },
        });
      }
      where.studentId = { in: studentIds };
    }

    const testWhere: Prisma.TestWhereInput = {};
    if (req.user.role === Role.SUPER_ADMIN) {
      const targetBranch = branchId || req.effectiveBranchId;
      if (targetBranch) testWhere.batch = { branchId: targetBranch };
    } else if (req.user.role === Role.ADMIN || req.user.role === Role.TEACHER) {
      testWhere.batch = { branchId: req.user.branchId };
    }

    const targetBatch = batch || batchId;
    if (targetBatch) {
      testWhere.batchId = targetBatch;
    }

    if (Object.keys(testWhere).length > 0) {
      where.test = testWhere;
    }

    const targetTest = test || testId;
    if (targetTest) where.testId = targetTest;

    if (q) {
      where.OR = [
        { student: { name: { contains: q, mode: 'insensitive' } } },
        { test: { title: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.result.count({ where }),
      prisma.result.findMany({
        where,
        skip,
        take,
        orderBy: { [sortBy]: sortOrder },
        select: {
          id: true,
          studentId: true,
          student: { select: { id: true, name: true, email: true } },
          testId: true,
          test: {
            select: {
              id: true,
              title: true,
              totalMarks: true,
              testDate: true,
              batch: { select: { id: true, name: true, branchId: true } },
            },
          },
          totalMarksObtained: true,
          rank: true,
          submittedAt: true,
        },
      }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        items,
        pagination: buildMeta(total, page, take),
      },
    });
  } catch (error) {
    console.error('Error fetching table results:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve results table' });
  }
}

/**
 * GET /tables/enrollments
 * Scoped enrollments table with batch and status filters.
 */
export async function getTableEnrollments(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const parseResult = enrollmentTableQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        data: parseResult.error.flatten(),
      });
    }

    const { page, limit, status, batch, batchId, branchId, q, sortBy, sortOrder } =
      parseResult.data;
    const { skip, take } = parsePagination({ page, limit }, { defaultLimit: 12, maxLimit: 100 });

    const where: Prisma.EnrollmentWhereInput = {};

    // Scoping rule
    if (req.user.role === Role.STUDENT) {
      where.studentId = req.user.userId;
    } else if (req.user.role === Role.GUARDIAN) {
      const studentIds = await getGuardianStudentIds(req.user.userId);
      if (studentIds.length === 0) {
        return res.status(200).json({
          success: true,
          data: { items: [], pagination: buildMeta(0, page, take) },
        });
      }
      where.studentId = { in: studentIds };
    } else if (req.user.role === Role.SUPER_ADMIN) {
      const targetBranch = branchId || req.effectiveBranchId;
      if (targetBranch) where.batch = { branchId: targetBranch };
    } else {
      where.batch = { branchId: req.user.branchId };
    }

    if (status) where.status = status;

    const targetBatch = batch || batchId;
    if (targetBatch) where.batchId = targetBatch;

    if (q) {
      where.OR = [
        { student: { name: { contains: q, mode: 'insensitive' } } },
        { batch: { name: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.enrollment.count({ where }),
      prisma.enrollment.findMany({
        where,
        skip,
        take,
        orderBy: { [sortBy]: sortOrder },
        select: {
          id: true,
          studentId: true,
          student: { select: { id: true, name: true, email: true } },
          batchId: true,
          batch: { select: { id: true, name: true, branchId: true } },
          status: true,
          enrolledAt: true,
          customFeeAmount: true,
          discountType: true,
          discountValue: true,
        },
      }),
    ]);

    const mappedItems = items.map((item) => ({
      ...item,
      customFeeAmount: item.customFeeAmount != null ? moneyToNumber(item.customFeeAmount) : null,
      discountValue: item.discountValue != null ? moneyToNumber(item.discountValue) : null,
    }));

    return res.status(200).json({
      success: true,
      data: {
        items: mappedItems,
        pagination: buildMeta(total, page, take),
      },
    });
  } catch (error) {
    console.error('Error fetching table enrollments:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve enrollments table' });
  }
}
