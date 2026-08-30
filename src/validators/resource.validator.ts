import { z } from 'zod';

export const createResourceSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  fileUrl: z.string().url('Invalid file URL'),
  fileType: z.string().min(1, 'File type is required'),
  batchId: z.string().min(1, 'Batch ID is required'),
  chapterId: z.string().optional(),
});

export type CreateResourceInput = z.infer<typeof createResourceSchema>;
