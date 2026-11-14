import { Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { Prisma, Role } from '@prisma/client';
import prisma from '../utils/prisma';
import { createAuditLog } from '../utils/audit';
import { checkCloudinaryImageUrl, changedFields } from '../utils/contentSanitize';
import { teacherProfileFields } from '../validators/cms.validator';
import { invalidateContentCaches } from '../utils/contentCaches';

// Fields a TEACHER may edit about their own public profile (never isPublicProfile / publicOrder).
const teacherSelfSchema = z.object({
  headline: teacherProfileFields.headline.optional(),
  bio: teacherProfileFields.bio.optional(),
  avatarUrl: teacherProfileFields.avatarUrl.optional(),
  qualifications: teacherProfileFields.qualifications.optional(),
  experienceYears: teacherProfileFields.experienceYears.optional(),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, 'Name cannot be empty').optional(),
  phone: z.string().trim().nullable().optional(),
  avatarUrl: z.string().trim().url('Invalid avatar URL').nullable().optional().or(z.literal('')),
  bio: z.string().trim().max(1000, 'Bio cannot exceed 1000 characters').nullable().optional(),
  headline: z.string().trim().max(200, 'Headline cannot exceed 200 characters').nullable().optional(),
  notifyByEmail: z.boolean().optional(),
});

export const updatePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters long'),
});

/**
 * GET /me
 * Returns authenticated user's profile without sensitive secrets.
 */
export async function getProfile(req: Request, res: Response) {
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
        role: true,
        branchId: true,
        branch: { select: { id: true, name: true } },
        avatarUrl: true,
        bio: true,
        headline: true,
        qualifications: true,
        experienceYears: true,
        notifyByEmail: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error('Error retrieving profile:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve profile',
    });
  }
}

/**
 * PATCH /me
 * Updates self profile fields (name, phone, avatarUrl, bio, headline, notifyByEmail; never email, role, branchId).
 */
export async function updateProfile(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const parseResult = updateProfileSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { name, phone, avatarUrl, bio, headline, notifyByEmail } = parseResult.data;
    const updateData: Prisma.UserUpdateInput = {};

    if (name !== undefined) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl === '' ? null : avatarUrl;
    if (bio !== undefined) updateData.bio = bio;
    if (headline !== undefined) updateData.headline = headline;
    if (notifyByEmail !== undefined) updateData.notifyByEmail = notifyByEmail;

    // TEACHER public-profile fields: plain text only, Cloudinary avatar, never isPublicProfile/publicOrder.
    let teacherChangedFields: string[] = [];
    if (req.user.role === Role.TEACHER) {
      const publicInput: Record<string, unknown> = {};
      for (const key of ['headline', 'bio', 'avatarUrl', 'qualifications', 'experienceYears'] as const) {
        if (req.body && Object.prototype.hasOwnProperty.call(req.body, key)) {
          publicInput[key] = key === 'avatarUrl' && req.body[key] === '' ? null : req.body[key];
        }
      }
      const teacherParse = teacherSelfSchema.safeParse(publicInput);
      if (!teacherParse.success) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          data: teacherParse.error.flatten(),
        });
      }
      const current = await prisma.user.findUnique({
        where: { id: req.user.userId },
        select: {
          headline: true,
          bio: true,
          avatarUrl: true,
          qualifications: true,
          experienceYears: true,
        },
      });
      const t = teacherParse.data;
      if (t.avatarUrl && t.avatarUrl !== current?.avatarUrl) {
        const reason = checkCloudinaryImageUrl(t.avatarUrl);
        if (reason) {
          return res.status(400).json({
            success: false,
            message: 'Validation failed',
            data: { fieldErrors: { avatarUrl: [reason] } },
          });
        }
      }
      if (t.qualifications !== undefined) updateData.qualifications = t.qualifications;
      if (t.experienceYears !== undefined) updateData.experienceYears = t.experienceYears;
      teacherChangedFields = changedFields(current ?? {}, {
        headline: t.headline,
        bio: t.bio,
        avatarUrl: t.avatarUrl,
        qualifications: t.qualifications,
        experienceYears: t.experienceYears,
      });
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.user.userId },
      data: updateData,
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
        qualifications: true,
        experienceYears: true,
        notifyByEmail: true,
        createdAt: true,
      },
    });

    if (teacherChangedFields.length > 0) {
      await createAuditLog({
        actorId: req.user.userId,
        action: 'TEACHER_PROFILE_SELF_UPDATED',
        entityType: 'User',
        entityId: req.user.userId,
        branchId: req.user.branchId,
        metadata: { fields: teacherChangedFields },
        ip: req.ip,
      });
      invalidateContentCaches();
    }

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: updatedUser,
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update profile',
    });
  }
}

/**
 * PATCH /me/password
 * Compares currentPassword and updates to hashed newPassword.
 */
export async function changePassword(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const parseResult = updatePasswordSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed: New password must be at least 8 characters long',
        errors: parseResult.error.issues.map((i) => i.message),
      });
    }

    const { currentPassword, newPassword } = parseResult.data;

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, password: true },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Incorrect current password',
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    return res.status(200).json({
      success: true,
      message: 'Password updated successfully',
    });
  } catch (error) {
    console.error('Error changing password:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update password',
    });
  }
}
