import { z } from 'zod';

export const createNoticeSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  content: z.string().min(1, 'Content is required'),
  batchId: z.string().optional(),
});

export type CreateNoticeInput = z.infer<typeof createNoticeSchema>;
