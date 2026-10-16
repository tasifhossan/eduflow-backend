import { z } from 'zod';
import { Role } from '@prisma/client';

export const registerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
  phone: z.string().optional().nullable(),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
  role: z.enum([Role.TEACHER, Role.STUDENT, Role.GUARDIAN]),
  branchId: z.string().optional().nullable(),
});

export const superAdminRegisterSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
  phone: z.string().optional().nullable(),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
  role: z.enum([Role.ADMIN, Role.TEACHER, Role.STUDENT, Role.GUARDIAN]),
  branchId: z.string().min(1, 'Branch ID is required'),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});
