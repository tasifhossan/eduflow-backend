import { Request, Response } from 'express';
import { Role } from '@prisma/client';
import prisma from '../utils/prisma';

/**
 * GET /api/audit-logs
 * Paginated and filterable by action, entityType, actorId, branchId, and date range.
 * Scoped: ADMIN sees own branch; SUPER_ADMIN sees all branches.
 */
export async function getAuditLogs(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const isSuperAdmin = req.user.role === Role.SUPER_ADMIN;
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const skip = (page - 1) * limit;

    const { action, entityType, actorId, branchId, startDate, endDate } = req.query;

    const where: any = {};

    // Branch scoping
    if (!isSuperAdmin) {
      where.branchId = req.user.branchId;
    } else if (branchId && typeof branchId === 'string') {
      where.branchId = branchId;
    }

    if (action && typeof action === 'string') {
      where.action = action;
    }

    if (entityType && typeof entityType === 'string') {
      where.entityType = entityType;
    }

    if (actorId && typeof actorId === 'string') {
      where.actorId = actorId;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate && typeof startDate === 'string') {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate && typeof endDate === 'string') {
        where.createdAt.lte = new Date(endDate);
      }
    }

    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return res.status(200).json({
      success: true,
      message: 'Audit logs retrieved successfully',
      data: {
        logs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error('Get audit logs error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}
