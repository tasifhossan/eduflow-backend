import { z } from 'zod';
import { AttendanceStatus } from '@prisma/client';

export const markAttendanceSchema = z.object({
  batchId: z.string().min(1, 'Batch ID is required'),
  date: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: 'Invalid date string',
  }),
  records: z.array(
    z.object({
      studentId: z.string().min(1, 'Student ID is required'),
      status: z.nativeEnum(AttendanceStatus, {
        message: 'Invalid attendance status',
      }),
    })
  ).min(1, 'At least one student attendance record is required'),
});
export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>;

export const lowAttendanceQuerySchema = z.object({
  threshold: z.coerce.number().min(1).max(100).optional(),
  from: z
    .string()
    .refine((val) => !isNaN(Date.parse(val)), { message: 'Invalid from date format' })
    .optional(),
  to: z
    .string()
    .refine((val) => !isNaN(Date.parse(val)), { message: 'Invalid to date format' })
    .optional(),
  batchId: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  format: z.enum(['json', 'csv']).default('json'),
});

export const attendanceSheetQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Month must be in YYYY-MM format'),
  format: z.enum(['json', 'csv']).default('json'),
});

export const myAttendanceSummaryQuerySchema = z.object({
  studentId: z.string().trim().min(1).optional(),
});
