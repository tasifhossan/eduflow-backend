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
