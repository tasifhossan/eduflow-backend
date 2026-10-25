import { z } from 'zod';

export const markNotificationsReadSchema = z
  .object({
    ids: z.array(z.string().cuid()).optional(),
    all: z.boolean().optional(),
  })
  .refine((data) => data.all === true || (Array.isArray(data.ids) && data.ids.length > 0), {
    message: "Either 'all: true' or an array of 'ids' must be provided",
  });
