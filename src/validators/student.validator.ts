import { z } from 'zod';

export const updateStudentSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters long').optional(),
  phone: z.string().nullable().optional(),
  guardianName: z.string().nullable().optional(),
  guardianPhone: z.string().nullable().optional(),
});
