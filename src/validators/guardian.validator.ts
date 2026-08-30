import { z } from 'zod';

export const createGuardianSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters long'),
  email: z.string().email('Invalid email address'),
  phone: z.string().optional(),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
});

export const linkGuardianSchema = z.object({
  guardianId: z.string().min(1, 'Guardian ID is required'),
  studentId: z.string().min(1, 'Student ID is required'),
});

export type CreateGuardianInput = z.infer<typeof createGuardianSchema>;
export type LinkGuardianInput = z.infer<typeof linkGuardianSchema>;
