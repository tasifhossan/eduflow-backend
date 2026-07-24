import { z } from 'zod';

export const createStudentSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
  phone: z.string().optional().nullable(),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
  guardianName: z.string().optional().nullable(),
  guardianPhone: z.string().optional().nullable(),
});

export const enrollStudentSchema = z.object({
  studentId: z.string().min(1, 'Student ID is required'),
  batchId: z.string().min(1, 'Batch ID is required'),
});
