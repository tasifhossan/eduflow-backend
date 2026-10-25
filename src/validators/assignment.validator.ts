import { z } from 'zod';

export const createAssignmentSchema = z
  .object({
    batchId: z.string().cuid(),
    subjectId: z.string().cuid().optional().nullable(),
    lectureId: z.string().cuid().optional().nullable(),
    title: z.string().trim().min(1, 'Title is required').max(200, 'Title cannot exceed 200 characters'),
    instructions: z.string().trim().min(1, 'Instructions are required').max(10000),
    dueAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
    maxMarks: z.number().positive('maxMarks must be positive').max(1000).or(z.string().regex(/^\d+(\.\d{1,2})?$/)),
    mode: z.enum(['ONLINE', 'OFFLINE']),
    allowLate: z.boolean().optional().default(false),
    publishNow: z.boolean().optional().default(false),
  })
  .strict();

export const updateAssignmentSchema = z
  .object({
    subjectId: z.string().cuid().optional().nullable(),
    lectureId: z.string().cuid().optional().nullable(),
    title: z.string().trim().min(1).max(200).optional(),
    instructions: z.string().trim().min(1).max(10000).optional(),
    dueAt: z.string().datetime({ offset: true }).or(z.string().datetime()).optional(),
    maxMarks: z.number().positive().max(1000).or(z.string().regex(/^\d+(\.\d{1,2})?$/)).optional(),
    mode: z.enum(['ONLINE', 'OFFLINE']).optional(),
    allowLate: z.boolean().optional(),
    published: z.boolean().optional(), // true = publish, false = unpublish
  })
  .strict();

export const submitAssignmentSchema = z
  .object({
    textAnswer: z.string().trim().max(5000, 'Text answer cannot exceed 5000 characters').optional().nullable(),
    attachments: z
      .array(
        z.object({
          publicId: z.string().trim().min(1),
          title: z.string().trim().min(1).max(200),
          resourceType: z.string().trim().optional(),
          format: z.string().trim().optional(),
          bytes: z.number().int().positive().optional(),
          originalName: z.string().trim().optional(),
        })
      )
      .max(5, 'Maximum 5 file attachments allowed per submission')
      .optional(),
  })
  .strict()
  .refine(
    (data) => (data.textAnswer && data.textAnswer.length > 0) || (data.attachments && data.attachments.length > 0),
    {
      message: 'Submission must include either textAnswer or at least one file attachment',
      path: ['textAnswer'],
    }
  );

export const gradeSubmissionSchema = z
  .object({
    marks: z.number().min(0).max(1000).or(z.string().regex(/^\d+(\.\d{1,2})?$/)),
    feedback: z.string().trim().max(5000).optional().nullable(),
  })
  .strict();

export const offlineMarksEntrySchema = z.object({
  studentId: z.string().cuid(),
  marks: z.number().min(0).max(1000).or(z.string().regex(/^\d+(\.\d{1,2})?$/)),
  feedback: z.string().trim().max(1000).optional().nullable(),
});

export const offlineBulkMarksSchema = z
  .object({
    entries: z.array(offlineMarksEntrySchema).min(1).max(300, 'Maximum 300 entries per bulk upload'),
  })
  .strict();
