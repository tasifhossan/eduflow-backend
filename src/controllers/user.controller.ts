import { Request, Response } from 'express';
import { Role } from '@prisma/client';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { generateTemporaryPassword } from '../utils/temp-password';
import { generateStudentCode } from '../utils/student-code';
import { normalizePhone } from '../utils/phone';
import { createAuditLog } from '../utils/audit';

const updateUserBranchSchema = z.object({
  branchId: z.string().min(1, 'Branch ID is required'),
});

const updateUserStatusSchema = z.object({
  isActive: z.boolean(),
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
        studentCode: true,
        role: true,
        branchId: true,
        isActive: true,
        mustChangePassword: true,
        lastLoginAt: true,
        createdAt: true,
        guardianLinks: {
          select: {
            student: {
              select: {
                id: true,
                name: true,
                email: true,
                studentCode: true,
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

    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
    });

    if (!branch) {
      return res.status(404).json({
        success: false,
        message: 'Target branch does not exist',
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, branchId: true },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { branchId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        branchId: true,
      },
    });

    await createAuditLog({
      actorId: req.user.userId,
      action: 'USER_BRANCH_CHANGED',
      entityType: 'User',
      entityId: userId,
      branchId,
      metadata: { previousBranchId: user.branchId, newBranchId: branchId },
      ip: req.ip || null,
    });

    return res.status(200).json({
      success: true,
      message: 'User branch updated successfully',
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

/**
 * POST /api/users/:id/reset-password
 * Admin reset of user password with temporary password generation.
 */
export async function adminResetPassword(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const targetUserId = req.params.id as string;
    const isSuperAdmin = req.user.role === Role.SUPER_ADMIN;

    // Caller cannot reset themselves via staff reset
    if (targetUserId === req.user.userId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot reset your own password via admin reset. Use the change-password endpoint.',
      });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, role: true, branchId: true, email: true, phone: true, studentCode: true },
    });

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // SEC-03 privilege scoping:
    if (!isSuperAdmin) {
      if (targetUser.branchId !== req.user.branchId) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: Cannot manage users belonging to another branch',
        });
      }
      if (targetUser.role === Role.ADMIN || targetUser.role === Role.SUPER_ADMIN) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: Admins cannot reset passwords for other administrators',
        });
      }
    }

    const temporaryPassword = generateTemporaryPassword(14);
    const hashedPassword = await bcrypt.hash(temporaryPassword, 10);
    const passwordChangedAt = new Date();

    await prisma.user.update({
      where: { id: targetUser.id },
      data: {
        password: hashedPassword,
        mustChangePassword: true,
        passwordChangedAt,
      },
    });

    await createAuditLog({
      actorId: req.user.userId,
      action: 'PASSWORD_RESET_BY_STAFF',
      entityType: 'User',
      entityId: targetUser.id,
      branchId: targetUser.branchId,
      metadata: { targetRole: targetUser.role },
      ip: req.ip || null,
    });

    return res.status(200).json({
      success: true,
      message: 'Password reset successfully',
      data: {
        temporaryPassword,
        identifier: targetUser.studentCode || targetUser.phone || targetUser.email,
      },
    });
  } catch (error) {
    console.error('Admin reset password error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

/**
 * PATCH /api/users/:id/status
 * Deactivate or reactivate a user account.
 */
export async function updateUserStatus(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const targetUserId = req.params.id as string;
    const isSuperAdmin = req.user.role === Role.SUPER_ADMIN;

    const parseResult = updateUserStatusSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed: isActive boolean is required',
        data: parseResult.error.flatten(),
      });
    }

    const { isActive } = parseResult.data;

    // A user cannot deactivate themselves
    if (targetUserId === req.user.userId && !isActive) {
      return res.status(400).json({
        success: false,
        message: 'Cannot deactivate your own account',
      });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, role: true, branchId: true, isActive: true },
    });

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Guard: cannot deactivate the last active SUPER_ADMIN
    if (targetUser.role === Role.SUPER_ADMIN && !isActive) {
      const activeSuperAdminCount = await prisma.user.count({
        where: { role: Role.SUPER_ADMIN, isActive: true },
      });
      if (activeSuperAdminCount <= 1) {
        return res.status(400).json({
          success: false,
          message: 'Cannot deactivate the last active SUPER_ADMIN',
        });
      }
    }

    // Scoping check for non-superadmin:
    if (!isSuperAdmin) {
      if (targetUser.branchId !== req.user.branchId) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: Cannot modify users in other branches',
        });
      }
      if (targetUser.role === Role.ADMIN || targetUser.role === Role.SUPER_ADMIN) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: Admins cannot deactivate other administrators',
        });
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: targetUser.id },
      data: {
        isActive,
        deactivatedAt: isActive ? null : new Date(),
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        studentCode: true,
        role: true,
        branchId: true,
        isActive: true,
        deactivatedAt: true,
      },
    });

    await createAuditLog({
      actorId: req.user.userId,
      action: isActive ? 'USER_REACTIVATED' : 'USER_DEACTIVATED',
      entityType: 'User',
      entityId: targetUser.id,
      branchId: targetUser.branchId,
      metadata: { targetRole: targetUser.role },
      ip: req.ip || null,
    });

    return res.status(200).json({
      success: true,
      message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
      data: updatedUser,
    });
  } catch (error) {
    console.error('Update user status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

/**
 * DELETE /api/users/:id
 * Blocks hard deletion if related records exist; advises deactivation instead.
 */
export async function deleteUser(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const targetUserId = req.params.id as string;
    const isSuperAdmin = req.user.role === Role.SUPER_ADMIN;

    if (targetUserId === req.user.userId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your own account',
      });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      include: {
        _count: {
          select: {
            teachingBatches: true,
            enrollments: true,
            attendances: true,
            markedAttendances: true,
            createdTests: true,
            studentAnswers: true,
            results: true,
            feePayments: true,
            recordedPayments: true,
            studentFeeCharges: true,
            studentPayments: true,
            receivedPayments: true,
            createdNotices: true,
            uploadedResources: true,
            practiceSessions: true,
            reviews: true,
          },
        },
      },
    });

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Scoping check
    if (!isSuperAdmin) {
      if (targetUser.branchId !== req.user.branchId) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: Cannot delete users in other branches',
        });
      }
      if (targetUser.role === Role.ADMIN || targetUser.role === Role.SUPER_ADMIN) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: Admins cannot delete other administrators',
        });
      }
    }

    const relatedRowCount = Object.values(targetUser._count).reduce((sum, c) => sum + c, 0);
    if (relatedRowCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete user with ${relatedRowCount} associated historical records. Please deactivate the user instead.`,
      });
    }

    await prisma.user.delete({ where: { id: targetUserId } });

    await createAuditLog({
      actorId: req.user.userId,
      action: 'USER_HARD_DELETED',
      entityType: 'User',
      entityId: targetUserId,
      branchId: targetUser.branchId,
      metadata: { deletedRole: targetUser.role },
      ip: req.ip || null,
    });

    return res.status(200).json({
      success: true,
      message: 'User deleted successfully',
    });
  } catch (error) {
    console.error('Delete user error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

/**
 * POST /api/users/import
 * Bulk import up to 500 users from JSON rows (parsed from CSV).
 */
export async function importUsers(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'rows array is required and must not be empty',
      });
    }

    if (rows.length > 500) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 500 rows allowed per import request',
      });
    }

    const isSuperAdmin = req.user.role === Role.SUPER_ADMIN;
    const callerBranchId = req.user.branchId;

    const results: Array<{
      row: number;
      status: 'CREATED' | 'SKIPPED';
      identifier?: string;
      temporaryPassword?: string;
      error?: string;
    }> = [];

    let createdCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 1;
      const row = rows[i];

      try {
        if (!row.name || typeof row.name !== 'string' || !row.name.trim()) {
          results.push({ row: rowNum, status: 'SKIPPED', error: 'Name is required' });
          skippedCount++;
          continue;
        }

        const role = row.role?.toUpperCase() as Role;
        if (!Object.values(Role).includes(role)) {
          results.push({ row: rowNum, status: 'SKIPPED', error: `Invalid role: ${row.role}` });
          skippedCount++;
          continue;
        }

        // Branch scoping
        let branchId = row.branchId || callerBranchId;
        if (!isSuperAdmin) {
          branchId = callerBranchId;
          if (role === Role.ADMIN || role === Role.SUPER_ADMIN) {
            results.push({
              row: rowNum,
              status: 'SKIPPED',
              error: 'Admins cannot import administrator roles',
            });
            skippedCount++;
            continue;
          }
        }

        const normPhone = normalizePhone(row.phone);
        const email = row.email ? String(row.email).trim().toLowerCase() : null;

        // Check duplicates
        if (normPhone) {
          const existingPhone = await prisma.user.findUnique({
            where: { phone: normPhone },
            select: { id: true },
          });
          if (existingPhone) {
            results.push({
              row: rowNum,
              status: 'SKIPPED',
              error: `Phone number ${normPhone} already in use`,
            });
            skippedCount++;
            continue;
          }
        }

        if (email) {
          const existingEmail = await prisma.user.findUnique({
            where: { email },
            select: { id: true },
          });
          if (existingEmail) {
            results.push({
              row: rowNum,
              status: 'SKIPPED',
              error: `Email ${email} already in use`,
            });
            skippedCount++;
            continue;
          }
        }

        const tempPassword = generateTemporaryPassword(14);
        const hashedPassword = await bcrypt.hash(tempPassword, 10);

        const created = await prisma.$transaction(async (tx) => {
          let studentCode: string | null = null;
          if (role === Role.STUDENT) {
            studentCode = await generateStudentCode(tx, branchId);
          }

          const newUser = await tx.user.create({
            data: {
              name: row.name.trim(),
              email,
              phone: normPhone,
              studentCode,
              guardianName: row.guardianName || null,
              guardianPhone: normalizePhone(row.guardianPhone),
              password: hashedPassword,
              role,
              branchId,
              mustChangePassword: true,
              isActive: true,
            },
            select: {
              id: true,
              studentCode: true,
              phone: true,
              email: true,
              role: true,
            },
          });

          // Handle guardian linking if guardianPhone provided
          if (row.guardianPhone && role === Role.STUDENT) {
            const normGPhone = normalizePhone(row.guardianPhone);
            if (normGPhone) {
              let guardian = await tx.user.findUnique({ where: { phone: normGPhone } });
              if (!guardian) {
                const gPass = generateTemporaryPassword(14);
                const gHash = await bcrypt.hash(gPass, 10);
                guardian = await tx.user.create({
                  data: {
                    name: row.guardianName || 'Guardian of ' + row.name,
                    phone: normGPhone,
                    role: Role.GUARDIAN,
                    branchId,
                    password: gHash,
                    mustChangePassword: true,
                    isActive: true,
                  },
                });
              }
              await tx.guardianLink.upsert({
                where: {
                  guardianId_studentId: {
                    guardianId: guardian.id,
                    studentId: newUser.id,
                  },
                },
                update: {},
                create: {
                  guardianId: guardian.id,
                  studentId: newUser.id,
                },
              });
            }
          }

          // Handle batch enrollments if given
          if (Array.isArray(row.batchIds) && row.batchIds.length > 0 && role === Role.STUDENT) {
            for (const batchId of row.batchIds) {
              const batch = await tx.batch.findUnique({
                where: { id: batchId },
                select: { id: true, branchId: true },
              });
              if (batch && (isSuperAdmin || batch.branchId === branchId)) {
                await tx.enrollment.create({
                  data: {
                    studentId: newUser.id,
                    batchId: batch.id,
                    status: 'ACTIVE',
                  },
                });
              }
            }
          }

          await createAuditLog(
            {
              actorId: req.user?.userId,
              action: 'USER_IMPORTED',
              entityType: 'User',
              entityId: newUser.id,
              branchId,
              metadata: { role: newUser.role, row: rowNum },
              ip: req.ip || null,
            },
            tx
          );

          return newUser;
        });

        const identifier = created.studentCode || created.phone || created.email || created.id;
        results.push({
          row: rowNum,
          status: 'CREATED',
          identifier,
          temporaryPassword: tempPassword,
        });
        createdCount++;
      } catch (rowErr: any) {
        results.push({
          row: rowNum,
          status: 'SKIPPED',
          error: rowErr.message || 'Failed to process row',
        });
        skippedCount++;
      }
    }

    // Summary audit log
    await createAuditLog({
      actorId: req.user.userId,
      action: 'USERS_BULK_IMPORTED',
      entityType: 'User',
      branchId: callerBranchId,
      metadata: { totalRows: rows.length, createdCount, skippedCount },
      ip: req.ip || null,
    });

    return res.status(200).json({
      success: true,
      message: `Import processed: ${createdCount} created, ${skippedCount} skipped`,
      data: {
        total: rows.length,
        createdCount,
        skippedCount,
        results,
      },
    });
  } catch (error) {
    console.error('Import users error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}
