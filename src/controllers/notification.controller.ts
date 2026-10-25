import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { parsePagination, buildMeta } from '../utils/pagination';
import { markNotificationsReadSchema } from '../validators/notification.validator';

export async function getNotifications(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const { page, limit, skip, take } = parsePagination(req.query, {
      defaultLimit: 20,
      maxLimit: 100,
    });

    const [items, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: req.user.userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.notification.count({
        where: { userId: req.user.userId },
      }),
      prisma.notification.count({
        where: {
          userId: req.user.userId,
          readAt: null,
        },
      }),
    ]);

    const meta = buildMeta(total, page, limit);

    return res.status(200).json({
      success: true,
      data: {
        items,
        unreadCount,
        pagination: meta,
      },
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error retrieving notifications',
    });
  }
}

export async function markNotificationsRead(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const parseResult = markNotificationsReadSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { ids, all } = parseResult.data;
    const now = new Date();

    if (all) {
      await prisma.notification.updateMany({
        where: {
          userId: req.user.userId,
          readAt: null,
        },
        data: {
          readAt: now,
        },
      });
    } else if (ids && ids.length > 0) {
      await prisma.notification.updateMany({
        where: {
          userId: req.user.userId,
          id: { in: ids },
          readAt: null,
        },
        data: {
          readAt: now,
        },
      });
    }

    const remainingUnread = await prisma.notification.count({
      where: {
        userId: req.user.userId,
        readAt: null,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Notifications marked as read',
      data: {
        unreadCount: remainingUnread,
      },
    });
  } catch (error) {
    console.error('Mark notifications read error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error updating notifications',
    });
  }
}
