import { z } from 'zod';

export const httpsLinkSchema = z
  .string()
  .trim()
  .max(500, 'Link URL must not exceed 500 characters')
  .refine((val) => {
    try {
      const parsed = new URL(val);
      if (parsed.protocol !== 'https:') return false;
      if (parsed.username || parsed.password) return false;
      return true;
    } catch {
      return false;
    }
  }, {
    message: 'URL must be a secure HTTPS link with no embedded credentials or disallowed schemes',
  });

export const createAttachmentSchema = z
  .object({
    lectureId: z.string().cuid().optional(),
    assignmentId: z.string().cuid().optional(),
    submissionId: z.string().cuid().optional(),
    kind: z.enum(['FILE', 'LINK']),
    title: z.string().trim().min(1, 'Title is required').max(200, 'Title cannot exceed 200 characters'),
    url: httpsLinkSchema.optional().nullable(),
    publicId: z.string().trim().min(1).max(500).optional().nullable(),
    resourceType: z.string().trim().max(50).optional().nullable(),
    format: z.string().trim().max(20).optional().nullable(),
    bytes: z.number().int().positive().optional().nullable(),
    originalName: z.string().trim().max(255).optional().nullable(),
  })
  .refine(
    (data) => {
      const parentCount =
        (data.lectureId ? 1 : 0) +
        (data.assignmentId ? 1 : 0) +
        (data.submissionId ? 1 : 0);
      return parentCount === 1;
    },
    {
      message: 'Attachment must belong to exactly one of lectureId, assignmentId, or submissionId',
      path: ['lectureId'],
    }
  )
  .refine(
    (data) => {
      if (data.kind === 'LINK') {
        return !!data.url && !data.publicId;
      }
      if (data.kind === 'FILE') {
        return !!data.publicId && !data.url;
      }
      return false;
    },
    {
      message: 'LINK attachments require url without publicId; FILE attachments require publicId without url',
      path: ['kind'],
    }
  );
