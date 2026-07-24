import { z } from 'zod';
import { DayOfWeek } from '@prisma/client';

export const createRoutineSlotSchema = z.object({
  batchId: z.string().min(1, 'Batch ID is required'),
  dayOfWeek: z.nativeEnum(DayOfWeek, {
    message: 'Invalid day of week',
  }),
  startTime: z.string().regex(/^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'Start time must be in HH:mm format (24-hour)',
  }),
  endTime: z.string().regex(/^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'End time must be in HH:mm format (24-hour)',
  }),
}).refine((data) => {
  const [startHour, startMin] = data.startTime.split(':').map(Number);
  const [endHour, endMin] = data.endTime.split(':').map(Number);
  const startTotal = startHour * 60 + startMin;
  const endTotal = endHour * 60 + endMin;
  return endTotal > startTotal;
}, {
  message: 'End time must be after start time',
  path: ['endTime'],
});
