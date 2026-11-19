import { z } from 'zod';
import { httpsLinkSchema } from './attachment.validator';

export const materialAttachmentInputSchema = z
  .object({
    id: z.string().optional(),
    kind: z.enum(['FILE', 'LINK']),
    title: z.string().trim().min(1, 'Attachment title is required').max(120, 'Attachment title cannot exceed 120 characters'),
    url: httpsLinkSchema.optional().nullable(),
    publicId: z.string().trim().min(1).max(500).optional().nullable(),
    resourceType: z.string().trim().max(50).optional().nullable(),
    format: z.string().trim().max(20).optional().nullable(),
    bytes: z.number().int().positive().optional().nullable(),
    originalName: z.string().trim().max(255).optional().nullable(),
  })
  .strict()
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
      message: 'LINK attachments require a valid HTTPS url without publicId; FILE attachments require publicId without url',
      path: ['kind'],
    }
  );

export const studyMaterialTypeEnum = z.enum([
  'PREPARATION',
  'NOTES',
  'SLIDES',
  'PRACTICE',
  'QUESTIONS',
  'REFERENCE',
  'RECORDING',
  'OTHER',
]);

export const createMaterialSchema = z
  .object({
    batchId: z.string().min(1, 'Batch ID is required'),
    chapterId: z.string().min(1).optional().nullable(),
    lectureId: z.string().min(1).optional().nullable(),
    title: z.string().trim().min(1, 'Title is required').max(120, 'Title cannot exceed 120 characters'),
    description: z.string().trim().max(500, 'Description cannot exceed 500 characters').optional().nullable(),
    type: studyMaterialTypeEnum,
    availableFrom: z.string().datetime().optional().nullable(),
    attachments: z.array(materialAttachmentInputSchema).max(10, 'At most 10 attachments per material').optional(),
    publish: z.boolean().optional(),
    notify: z.boolean().optional(),
  })
  .strict();

export const updateMaterialSchema = z
  .object({
    chapterId: z.string().min(1).optional().nullable(),
    lectureId: z.string().min(1).optional().nullable(),
    title: z.string().trim().min(1, 'Title is required').max(120, 'Title cannot exceed 120 characters').optional(),
    description: z.string().trim().max(500, 'Description cannot exceed 500 characters').optional().nullable(),
    type: studyMaterialTypeEnum.optional(),
    availableFrom: z.string().datetime().optional().nullable(),
    attachments: z.array(materialAttachmentInputSchema).max(10, 'At most 10 attachments per material').optional(),
    isPublished: z.boolean().optional(),
    notify: z.boolean().optional(),
  })
  .strict();

export const publishMaterialSchema = z
  .object({
    notify: z.boolean().optional(),
  })
  .strict();

export const reorderMaterialsSchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1, 'At least one material ID is required'),
  })
  .strict();

export const copyMaterialSchema = z
  .object({
    batchIds: z.array(z.string().min(1)).min(1, 'At least one target batch ID is required'),
  })
  .strict();

export const materialQuerySchema = z.object({
  chapterId: z.string().optional(),
  type: studyMaterialTypeEnum.optional(),
  q: z.string().trim().max(100).optional(),
  status: z.enum(['all', 'published', 'draft']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
});
