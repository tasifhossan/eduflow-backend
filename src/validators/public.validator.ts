import { z } from 'zod';
import { BatchType } from '@prisma/client';

export const publicBatchesQuerySchema = z.object({
  q: z.string().trim().optional(),
  subjectId: z.string().trim().optional(),
  branchId: z.string().trim().optional(),
  type: z.nativeEnum(BatchType, { message: 'Invalid batch type' }).optional(),
  minFee: z.coerce.number().min(0, 'minFee must be non-negative').optional(),
  maxFee: z.coerce.number().min(0, 'maxFee must be non-negative').optional(),
  minRating: z.coerce.number().min(1, 'minRating must be between 1 and 5').max(5, 'minRating must be between 1 and 5').optional(),
  sort: z
    .enum(['newest', 'fee_asc', 'fee_desc', 'fee-asc', 'fee-desc', 'rating', 'rating-desc', 'popular'], {
      message: 'sort must be one of: newest, fee_asc, fee_desc, rating, popular',
    })
    .optional()
    .default('newest'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).optional().default(12),
});

export const publicPaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(12),
});

export const batchSlugParamSchema = z.object({
  slug: z.string().min(1, 'Slug is required'),
});
