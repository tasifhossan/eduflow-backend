import { z } from 'zod';

export const createPracticeSessionSchema = z.object({
  batchId: z.string().min(1, 'Batch ID is required'),
  chapterIds: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(20).optional().default(10),
});
