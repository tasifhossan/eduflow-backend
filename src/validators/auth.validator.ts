import { z } from 'zod';
import { Role } from '@prisma/client';

export const registerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address').optional().or(z.literal('')).transform(val => val === '' ? undefined : val),
  phone: z.string().optional().nullable(),
  password: z.string().min(6, 'Password must be at least 6 characters long').optional(),
  role: z.enum([Role.TEACHER, Role.STUDENT, Role.GUARDIAN]),
  branchId: z.string().optional().nullable(),
  batchIds: z.array(z.string()).optional(),
  guardianPhone: z.string().optional().nullable(),
  guardianName: z.string().optional().nullable(),
});

export const superAdminRegisterSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address').optional().or(z.literal('')).transform(val => val === '' ? undefined : val),
  phone: z.string().optional().nullable(),
  password: z.string().min(6, 'Password must be at least 6 characters long').optional(),
  role: z.enum([Role.ADMIN, Role.TEACHER, Role.STUDENT, Role.GUARDIAN]),
  branchId: z.string().min(1, 'Branch ID is required'),
  batchIds: z.array(z.string()).optional(),
  guardianPhone: z.string().optional().nullable(),
  guardianName: z.string().optional().nullable(),
});

export const loginSchema = z.object({
  identifier: z.string().min(1, 'Login identifier is required').optional(),
  email: z.string().optional(),
  password: z.string().min(1, 'Password is required'),
}).refine(data => !!(data.identifier || data.email), {
  message: 'Identifier or email is required',
  path: ['identifier'],
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(10, 'New password must be at least 10 characters long'),
});

export const forgotPasswordSchema = z.object({
  identifier: z.string().min(1, 'Identifier is required'),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  newPassword: z.string().min(10, 'New password must be at least 10 characters long'),
});
