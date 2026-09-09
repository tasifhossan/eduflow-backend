import { Request, Response } from 'express';
import { PrismaClient, Role } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();

const updateUserBranchSchema = z.object({
  branchId: z.string().min(1, 'Branch ID is required'),
});

export async function getUsers(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const effectiveBranchId = req.effectiveBranchId;
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

    const where: any = {
      role: roleFilter,
    };
    if (effectiveBranchId) {
      where.branchId = effectiveBranchId;
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        branchId: true,
        guardianLinks: {
          select: {
            student: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
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

export async function updateUserBranch(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const userId = req.params.userId as string;

    const parseResult = updateUserBranchSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { branchId } = parseResult.data;

    // Find target user
    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Reject attempts to set branchId on a SUPER_ADMIN account
    if (targetUser.role === Role.SUPER_ADMIN) {
      return res.status(400).json({
        success: false,
        message: 'Cannot assign a branch to a SUPER_ADMIN account',
      });
    }

    // Check if specified branch exists
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
    });

    if (!branch) {
      return res.status(400).json({
        success: false,
        message: 'The specified branch does not exist',
      });
    }

    // Reassign user branch in DB
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { branchId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        branchId: true,
        branch: { select: { id: true, name: true } },
      },
    });

    return res.status(200).json({
      success: true,
      message: 'User branch reassigned successfully. Note: The reassigned user must re-login for token-based session updates to take effect.',
      data: updatedUser,
    });
  } catch (error) {
    console.error('Update user branch error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

