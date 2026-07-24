import { z } from 'zod';
import { BatchType } from '@prisma/client';

export const createBatchSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: z.nativeEnum(BatchType, { message: 'Type must be one of: ACADEMIC, ADMISSION' }),
  classLevel: z.string().optional().nullable(),
  subjectId: z.string().min(1, 'Subject ID is required'),
  teacherId: z.string().optional().nullable(),
});

export const updateBatchSchema = createBatchSchema.partial();
