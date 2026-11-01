import { z } from 'zod';

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const createReportPeriodSchema = z
  .object({
    batchId: z.string().min(1, 'batchId is required'),
    label: z.string().trim().min(1, 'Label cannot be empty').max(60, 'Label cannot exceed 60 characters'),
    from: z.string().regex(dateRegex, 'from date must be in YYYY-MM-DD format'),
    to: z.string().regex(dateRegex, 'to date must be in YYYY-MM-DD format'),
  })
  .strict()
  .refine(
    (data) => new Date(data.from) <= new Date(data.to),
    {
      message: 'from date must be before or equal to to date',
      path: ['to'],
    }
  );

export const updateReportPeriodSchema = z
  .object({
    label: z.string().trim().min(1, 'Label cannot be empty').max(60, 'Label cannot exceed 60 characters').optional(),
    from: z.string().regex(dateRegex, 'from date must be in YYYY-MM-DD format').optional(),
    to: z.string().regex(dateRegex, 'to date must be in YYYY-MM-DD format').optional(),
  })
  .strict()
  .refine(
    (data) => {
      if (data.from && data.to) {
        return new Date(data.from) <= new Date(data.to);
      }
      return true;
    },
    {
      message: 'from date must be before or equal to to date',
      path: ['to'],
    }
  );

export const updateReportRemarkSchema = z
  .object({
    remark: z.string().trim().max(600, 'Remark cannot exceed 600 characters'),
  })
  .strict();

export const reportPeriodCardsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const myReportCardsQuerySchema = z.object({
  studentId: z.string().optional(),
});

export const exportStudentsQuerySchema = z.object({
  format: z.enum(['csv']).default('csv'),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ALL']).optional().default('ALL'),
});

export const exportBatchResultsQuerySchema = z.object({
  batchId: z.string().min(1, 'batchId is required'),
  periodId: z.string().min(1, 'periodId is required'),
  format: z.enum(['csv']).default('csv'),
});

