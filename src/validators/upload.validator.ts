import { z } from 'zod';

export const uploadSignatureSchema = z.object({
  purpose: z.enum(['material', 'submission', 'branding']).optional(),
  folder: z.string().trim().optional(),
  type: z.string().trim().optional(),
});
