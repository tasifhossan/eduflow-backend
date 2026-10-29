import { Request, Response } from 'express';
import { Role } from '@prisma/client';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import prisma from '../utils/prisma';
import env from '../config/env';
import { signToken } from '../utils/jwt';
import {
  registerSchema,
  superAdminRegisterSchema,
  loginSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../validators/auth.validator';
import { generateTemporaryPassword } from '../utils/temp-password';
import { generateStudentCode } from '../utils/student-code';
import { normalizePhone } from '../utils/phone';
import { createAuditLog } from '../utils/audit';
import { sendEmail } from '../utils/mailer';
import { escapeHtml } from '../utils/escapeHtml';

/**
 * Sets standard authentication JWT cookie.
 */
export function setAuthCookie(res: Response, token: string): void {
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
}

/**
 * POST /api/auth/register
 * Staff-only provisioning endpoint for creating user accounts.
 * Authenticated: ADMIN (own branch: TEACHER, STUDENT, GUARDIAN) or SUPER_ADMIN (any role, any branch).
 */
export async function register(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const isSuperAdmin = req.user.role === Role.SUPER_ADMIN;
    const schema = isSuperAdmin ? superAdminRegisterSchema : registerSchema;
    const parseResult = schema.safeParse(req.body);

    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { name, email, phone, role, batchIds, guardianPhone, guardianName } = parseResult.data;

    // SEC-03 branch scoping:
    let branchId: string;
    if (isSuperAdmin) {
      if (!parseResult.data.branchId) {
        return res.status(400).json({
          success: false,
          message: 'Branch ID is required',
        });
      }
      branchId = parseResult.data.branchId;
      const branchExists = await prisma.branch.findUnique({ where: { id: branchId } });
      if (!branchExists) {
        return res.status(400).json({
          success: false,
          message: 'The specified branch does not exist',
        });
      }
    } else {
      // Non-super-admin (ADMIN) callers: must use their own branch
      if (!req.user.branchId) {
        return res.status(400).json({
          success: false,
          message: 'Caller has no branch assigned',
        });
      }
      branchId = req.user.branchId;
    }

    // Phone normalization & uniqueness
    const normalizedPhone = normalizePhone(phone);
    if (normalizedPhone) {
      const existingPhone = await prisma.user.findUnique({
        where: { phone: normalizedPhone },
        select: { id: true },
      });
      if (existingPhone) {
        return res.status(409).json({
          success: false,
          message: 'A user with this phone number already exists',
        });
      }
    }

    // Email uniqueness check
    if (email) {
      const existingEmail = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (existingEmail) {
        return res.status(409).json({
          success: false,
          message: 'A user with this email already exists',
        });
      }
    }

    // Generate unambiguous temporary password
    const temporaryPassword = parseResult.data.password || generateTemporaryPassword(14);
    const hashedPassword = await bcrypt.hash(temporaryPassword, 10);

    // Run creation inside transaction
    const createdData = await prisma.$transaction(async (tx) => {
      let studentCode: string | null = null;
      if (role === Role.STUDENT) {
        studentCode = await generateStudentCode(tx, branchId);
      }

      const newUser = await tx.user.create({
        data: {
          name,
          email: email || null,
          phone: normalizedPhone,
          studentCode,
          guardianName: guardianName || null,
          guardianPhone: normalizePhone(guardianPhone),
          password: hashedPassword,
          role,
          branchId,
          mustChangePassword: true,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          studentCode: true,
          role: true,
          branchId: true,
          mustChangePassword: true,
          isActive: true,
          createdAt: true,
        },
      });

      // Handle batch enrollments if given
      if (batchIds && batchIds.length > 0 && role === Role.STUDENT) {
        for (const batchId of batchIds) {
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

      // Handle guardian linking if guardianPhone is provided
      if (guardianPhone && role === Role.STUDENT) {
        const normGPhone = normalizePhone(guardianPhone);
        if (normGPhone) {
          let guardianUser = await tx.user.findUnique({
            where: { phone: normGPhone },
          });
          if (!guardianUser) {
            const gTempPassword = generateTemporaryPassword(14);
            const gHashed = await bcrypt.hash(gTempPassword, 10);
            guardianUser = await tx.user.create({
              data: {
                name: guardianName || 'Guardian of ' + name,
                phone: normGPhone,
                role: Role.GUARDIAN,
                branchId,
                password: gHashed,
                mustChangePassword: true,
                isActive: true,
              },
            });
          }
          await tx.guardianLink.upsert({
            where: {
              guardianId_studentId: {
                guardianId: guardianUser.id,
                studentId: newUser.id,
              },
            },
            update: {},
            create: {
              guardianId: guardianUser.id,
              studentId: newUser.id,
            },
          });
        }
      }

      // Record audit log
      await createAuditLog(
        {
          actorId: req.user?.userId,
          action: 'ACCOUNT_PROVISIONED',
          entityType: 'User',
          entityId: newUser.id,
          branchId,
          metadata: {
            role: newUser.role,
            studentCode: newUser.studentCode,
            hasPhone: !!newUser.phone,
            hasEmail: !!newUser.email,
          },
          ip: req.ip || null,
        },
        tx
      );

      return { user: newUser, studentCode };
    });

    const primaryIdentifier =
      createdData.user.studentCode || createdData.user.phone || createdData.user.email;

    return res.status(201).json({
      success: true,
      message: 'User provisioned successfully',
      data: {
        user: createdData.user,
        temporaryPassword,
        identifier: primaryIdentifier,
      },
    });
  } catch (error) {
    console.error('Registration/provisioning error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

/**
 * POST /api/auth/login
 * Login by email, phone, or student code.
 * Rejects deactivated users with generic error; updates lastLoginAt;
 * informs client if temporary password change is required.
 */
export async function login(req: Request, res: Response) {
  try {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { identifier, email, password } = parseResult.data;
    const rawIdentifier = (identifier || email || '').trim();
    const normalizedPhone = normalizePhone(rawIdentifier);

    // Uniform generic rejection helper
    const rejectInvalid = () =>
      res.status(401).json({
        success: false,
        message: 'Invalid identifier or password',
      });

    // Query user by email (lowercase), normalized phone, or studentCode (case-insensitive)
    const orConditions: any[] = [
      { email: rawIdentifier.toLowerCase() },
      { studentCode: { equals: rawIdentifier, mode: 'insensitive' } },
    ];
    if (normalizedPhone) {
      orConditions.push({ phone: normalizedPhone });
    }
    // Also match raw phone just in case
    orConditions.push({ phone: rawIdentifier });

    const user = await prisma.user.findFirst({
      where: {
        OR: orConditions,
      },
    });

    if (!user) {
      return rejectInvalid();
    }

    // Reject deactivated user with the exact same generic message
    if (!user.isActive) {
      return rejectInvalid();
    }

    // Compare passwords
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return rejectInvalid();
    }

    // Update lastLoginAt
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Generate JWT
    const token = signToken({
      userId: user.id,
      role: user.role,
      branchId: user.branchId,
    });

    setAuthCookie(res, token);

    const userSafe = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      studentCode: user.studentCode,
      role: user.role,
      branchId: user.branchId,
      mustChangePassword: user.mustChangePassword,
      createdAt: user.createdAt,
    };

    return res.status(200).json({
      success: true,
      message: user.mustChangePassword
        ? 'Login successful. Password change required.'
        : 'Login successful',
      mustChangePassword: user.mustChangePassword,
      data: {
        user: userSafe,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

/**
 * POST /api/auth/change-password
 * Authenticated user password change (forced or voluntary).
 * Enforces min 10 chars, disallows identifier matching, clears mustChangePassword,
 * invalidates previous sessions via passwordChangedAt timestamp.
 */
export async function changePassword(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const parseResult = changePasswordSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed: New password must be at least 10 characters long',
        errors: parseResult.error.issues.map((i) => i.message),
      });
    }

    const { currentPassword, newPassword } = parseResult.data;

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        password: true,
        email: true,
        phone: true,
        studentCode: true,
        branchId: true,
      },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User no longer exists',
      });
    }

    // Verify current password
    const isCurrentValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentValid) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect',
      });
    }

    // Ensure new password differs from current password
    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      return res.status(400).json({
        success: false,
        message: 'New password must be different from your current password',
      });
    }

    // Ensure new password does not match identifier
    const lowerNew = newPassword.toLowerCase();
    if (
      (user.email && lowerNew === user.email.toLowerCase()) ||
      (user.phone && newPassword === user.phone) ||
      (user.studentCode && lowerNew === user.studentCode.toLowerCase())
    ) {
      return res.status(400).json({
        success: false,
        message: 'New password cannot equal your login identifier',
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const passwordChangedAt = new Date();

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        mustChangePassword: false,
        passwordChangedAt,
      },
    });

    // Re-issue fresh token for current session so user remains logged in
    const newToken = signToken({
      userId: user.id,
      role: req.user.role,
      branchId: user.branchId,
    });
    setAuthCookie(res, newToken);

    await createAuditLog({
      actorId: user.id,
      action: 'PASSWORD_CHANGED',
      entityType: 'User',
      entityId: user.id,
      branchId: user.branchId,
      ip: req.ip || null,
    });

    return res.status(200).json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

/**
 * POST /api/auth/forgot-password
 * Public self-service password reset request.
 * Uniform 200 message regardless of whether identifier exists.
 * Sends email reset link with single-use token if email is on record.
 */
export async function forgotPassword(req: Request, res: Response) {
  try {
    const parseResult = forgotPasswordSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed: Identifier is required',
      });
    }

    const { identifier } = parseResult.data;
    const rawIdentifier = identifier.trim();
    const normalizedPhone = normalizePhone(rawIdentifier);

    const uniformResponse = {
      success: true,
      message:
        'If an account with this identifier has a registered email, a password reset link has been sent.',
    };

    const orConditions: any[] = [
      { email: rawIdentifier.toLowerCase() },
      { studentCode: { equals: rawIdentifier, mode: 'insensitive' } },
    ];
    if (normalizedPhone) {
      orConditions.push({ phone: normalizedPhone });
    }

    const user = await prisma.user.findFirst({
      where: {
        OR: orConditions,
        isActive: true,
      },
      select: { id: true, name: true, email: true, branchId: true },
    });

    // If user exists and has email, create single-use token and email reset link
    if (user && user.email) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      });

      const resetUrl = `${env.FRONTEND_URL.replace(/\/$/, '')}/reset-password?token=${rawToken}`;
      const emailHtml = `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1e293b">
          <h2 style="color:#2563eb">Password Reset Request</h2>
          <p>Hello ${escapeHtml(user.name)},</p>
          <p>We received a request to reset your EduFlow account password. Click the link below to set a new password:</p>
          <p style="margin:24px 0">
            <a href="${escapeHtml(resetUrl)}" style="background:#2563eb;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block">
              Reset Password
            </a>
          </p>
          <p style="font-size:13px;color:#64748b">This link will expire in 30 minutes. If you did not request this, you can safely ignore this email.</p>
        </div>
      `;

      sendEmail([user.email], 'EduFlow Password Reset Request', emailHtml).catch((err: unknown) =>
        console.error('Failed to dispatch reset email:', err)
      );

      await createAuditLog({
        actorId: user.id,
        action: 'PASSWORD_RESET_REQUESTED',
        entityType: 'User',
        entityId: user.id,
        branchId: user.branchId,
        ip: req.ip || null,
      });
    }

    return res.status(200).json(uniformResponse);
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

/**
 * POST /api/auth/reset-password
 * Consumes single-use token and sets new password.
 */
export async function resetPassword(req: Request, res: Response) {
  try {
    const parseResult = resetPasswordSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed: Token and new password (min 10 characters) are required',
        data: parseResult.error.flatten(),
      });
    }

    const { token, newPassword } = parseResult.data;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const resetToken = await prisma.passwordResetToken.findFirst({
      where: {
        tokenHash,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: {
        user: {
          select: { id: true, email: true, phone: true, studentCode: true, branchId: true },
        },
      },
    });

    if (!resetToken || !resetToken.user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired password reset token',
      });
    }

    const lowerNew = newPassword.toLowerCase();
    const u = resetToken.user;
    if (
      (u.email && lowerNew === u.email.toLowerCase()) ||
      (u.phone && newPassword === u.phone) ||
      (u.studentCode && lowerNew === u.studentCode.toLowerCase())
    ) {
      return res.status(400).json({
        success: false,
        message: 'New password cannot equal your login identifier',
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const passwordChangedAt = new Date();

    await prisma.$transaction([
      prisma.user.update({
        where: { id: u.id },
        data: {
          password: hashedPassword,
          mustChangePassword: false,
          passwordChangedAt,
        },
      }),
      prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
    ]);

    await createAuditLog({
      actorId: u.id,
      action: 'PASSWORD_RESET_COMPLETED',
      entityType: 'User',
      entityId: u.id,
      branchId: u.branchId,
      ip: req.ip || null,
    });

    return res.status(200).json({
      success: true,
      message: 'Password has been reset successfully. Please sign in with your new password.',
    });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

/**
 * GET /api/auth/me
 */
export async function me(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        studentCode: true,
        role: true,
        branchId: true,
        mustChangePassword: true,
        isActive: true,
        createdAt: true,
      },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: User no longer exists or is inactive',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'User details retrieved successfully',
      data: user,
    });
  } catch (error) {
    console.error('Get profile error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

/**
 * POST /api/auth/logout
 */
export async function logout(req: Request, res: Response) {
  try {
    res.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    });

    return res.status(200).json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

/**
 * POST /api/auth/demo
 * Only works when DEMO_MODE=true AND NODE_ENV is NOT production.
 */
export async function demoLogin(req: Request, res: Response) {
  try {
    if (process.env.NODE_ENV === 'production' || env.DEMO_MODE !== 'true') {
      return res.status(404).json({
        success: false,
        message: 'Demo mode is not available',
      });
    }

    const { role } = req.body;
    if (!role || !['STUDENT', 'TEACHER', 'ADMIN', 'GUARDIAN', 'ACCOUNTANT'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed: Allowed roles are STUDENT, TEACHER, ADMIN, GUARDIAN, ACCOUNTANT',
      });
    }

    const user = await prisma.user.findFirst({
      where: {
        role,
        email: `${role.toLowerCase()}@demo.eduflow.local`,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        studentCode: true,
        role: true,
        branchId: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: `Demo user for role ${role} not found`,
      });
    }

    const token = signToken({
      userId: user.id,
      role: user.role,
      branchId: user.branchId,
    });

    setAuthCookie(res, token);

    return res.status(200).json({
      success: true,
      message: 'Demo login successful',
      data: {
        user,
      },
    });
  } catch (error) {
    console.error('Demo login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}
