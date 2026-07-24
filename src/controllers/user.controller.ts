import { Request, Response } from 'express';
import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();

export async function getUsers(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const branchId = req.user.branchId;
    const roleQuery = req.query.role;
    let roleFilter: Role | undefined = undefined;

    if (roleQuery && typeof roleQuery === 'string') {
      const upperRole = roleQuery.toUpperCase();
      if (Object.values(Role).includes(upperRole as Role)) {
        roleFilter = upperRole as Role;
      } else {
        return res.status(400).json({
          success: false,
          message: `Invalid role query parameter. Must be one of: ${Object.values(Role).join(', ')}`,
        });
      }
    }

    const users = await prisma.user.findMany({
      where: {
        branchId,
        role: roleFilter,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Users retrieved successfully',
      data: users,
    });
  } catch (error) {
    console.error('Get users error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}
