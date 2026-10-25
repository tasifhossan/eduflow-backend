import { z } from 'zod';

export function validateOnlineUrl(provider: 'MEET' | 'ZOOM' | 'OTHER' | null | undefined, url: string | null | undefined): boolean {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;

    const hostname = parsed.hostname.toLowerCase();
    if (provider === 'MEET') {
      return hostname === 'meet.google.com';
    }
    if (provider === 'ZOOM') {
      return hostname === 'zoom.us' || hostname.endsWith('.zoom.us');
    }
    if (provider === 'OTHER') {
      return true;
    }
    return true;
  } catch {
    return false;
  }
}

export const onlineClassSchema = z
  .object({
    onlineProvider: z.enum(['MEET', 'ZOOM', 'OTHER']).optional().nullable(),
    onlineUrl: z.string().trim().max(500).optional().nullable(),
    onlinePasscode: z.string().trim().max(40, 'Passcode cannot exceed 40 characters').optional().nullable(),
  })
  .refine(
    (data) => {
      if (data.onlineUrl) {
        return validateOnlineUrl(data.onlineProvider, data.onlineUrl);
      }
      return true;
    },
    {
      message: 'Invalid online class URL for provider (MEET requires meet.google.com, ZOOM requires zoom.us domain, OTHER requires HTTPS)',
      path: ['onlineUrl'],
    }
  );

export const createLectureSchema = z
  .object({
    batchId: z.string().cuid(),
    subjectId: z.string().cuid(),
    chapterId: z.string().cuid().optional().nullable(),
    teacherId: z.string().cuid(),
    routineSlotId: z.string().cuid().optional().nullable(),
    title: z.string().trim().max(200).optional().nullable(),
    plannedTopics: z.string().trim().min(1, 'Planned topics are required').max(5000),
    startsAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
    endsAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
    isPublished: z.boolean().optional().default(false),
    notify: z.boolean().optional().default(false),
    onlineProvider: z.enum(['MEET', 'ZOOM', 'OTHER']).optional().nullable(),
    onlineUrl: z.string().trim().max(500).optional().nullable(),
    onlinePasscode: z.string().trim().max(40).optional().nullable(),
  })
  .strict()
  .refine(
    (data) => new Date(data.endsAt).getTime() > new Date(data.startsAt).getTime(),
    {
      message: 'endsAt must be after startsAt',
      path: ['endsAt'],
    }
  )
  .refine(
    (data) => {
      if (data.onlineUrl) {
        return validateOnlineUrl(data.onlineProvider, data.onlineUrl);
      }
      return true;
    },
    {
      message: 'Invalid online class URL for provider (MEET requires meet.google.com, ZOOM requires zoom.us domain, OTHER requires HTTPS)',
      path: ['onlineUrl'],
    }
  );

export const updateLectureSchema = z
  .object({
    subjectId: z.string().cuid().optional(),
    chapterId: z.string().cuid().optional().nullable(),
    teacherId: z.string().cuid().optional(),
    title: z.string().trim().max(200).optional().nullable(),
    plannedTopics: z.string().trim().min(1).max(5000).optional(),
    coveredTopics: z.string().trim().max(5000).optional().nullable(),
    homeworkNote: z.string().trim().max(5000).optional().nullable(),
    startsAt: z.string().datetime({ offset: true }).or(z.string().datetime()).optional(),
    endsAt: z.string().datetime({ offset: true }).or(z.string().datetime()).optional(),
    isPublished: z.boolean().optional(),
    notify: z.boolean().optional(),
    onlineProvider: z.enum(['MEET', 'ZOOM', 'OTHER']).optional().nullable(),
    onlineUrl: z.string().trim().max(500).optional().nullable(),
    onlinePasscode: z.string().trim().max(40).optional().nullable(),
  })
  .strict()
  .refine(
    (data) => {
      if (data.startsAt && data.endsAt) {
        return new Date(data.endsAt).getTime() > new Date(data.startsAt).getTime();
      }
      return true;
    },
    {
      message: 'endsAt must be after startsAt',
      path: ['endsAt'],
    }
  )
  .refine(
    (data) => {
      if (data.onlineUrl) {
        return validateOnlineUrl(data.onlineProvider, data.onlineUrl);
      }
      return true;
    },
    {
      message: 'Invalid online class URL for provider (MEET requires meet.google.com, ZOOM requires zoom.us domain, OTHER requires HTTPS)',
      path: ['onlineUrl'],
    }
  );

export const completeLectureSchema = z
  .object({
    coveredTopics: z.string().trim().min(1, 'Covered topics are required').max(5000),
    homeworkNote: z.string().trim().max(5000).optional().nullable(),
  })
  .strict();

export const cancelLectureSchema = z
  .object({
    reason: z.string().trim().min(1, 'Cancellation reason is required').max(1000),
  })
  .strict();

export const generateLecturesSchema = z
  .object({
    from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}/, 'from date must be YYYY-MM-DD or ISO'),
    to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}/, 'to date must be YYYY-MM-DD or ISO'),
    dryRun: z.boolean().optional().default(false),
  })
  .strict()
  .refine(
    (data) => {
      const fromD = new Date(data.from.slice(0, 10));
      const toD = new Date(data.to.slice(0, 10));
      if (toD < fromD) return false;
      const diffDays = Math.ceil((toD.getTime() - fromD.getTime()) / (1000 * 60 * 60 * 24));
      return diffDays <= 92;
    },
    {
      message: 'Date range cannot exceed 92 days and to must be >= from',
      path: ['to'],
    }
  );
