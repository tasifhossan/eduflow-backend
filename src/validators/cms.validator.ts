import { z } from 'zod';
import { safeText, slugSchema, imageUrlField } from '../utils/contentSanitize';

export const idParamSchema = z.object({ id: z.string().trim().min(1).max(64) });

const pageQuery = {
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

const q = z.string().trim().max(100).optional();

// ── Blog ────────────────────────────────────────────────────────────────────
export const BLOG_LIMITS = { title: 120, excerpt: 200, content: 20000, category: 40 } as const;

export const blogListQuerySchema = z.object({
  ...pageQuery,
  status: z.enum(['draft', 'scheduled', 'published']).optional(),
  q,
  category: z.string().trim().max(BLOG_LIMITS.category).optional(),
});

export const blogCreateSchema = z
  .object({
    title: safeText(BLOG_LIMITS.title, { min: 1 }),
    slug: slugSchema.optional(),
    excerpt: safeText(BLOG_LIMITS.excerpt, { multiline: true }).optional(),
    content: safeText(BLOG_LIMITS.content, { multiline: true }).optional(),
    category: safeText(BLOG_LIMITS.category).optional(),
    coverImage: imageUrlField.optional(),
  })
  .strict();

export const blogUpdateSchema = z
  .object({
    title: safeText(BLOG_LIMITS.title, { min: 1 }).optional(),
    slug: slugSchema.optional(),
    excerpt: safeText(BLOG_LIMITS.excerpt, { multiline: true }).optional(),
    content: safeText(BLOG_LIMITS.content, { multiline: true }).optional(),
    category: safeText(BLOG_LIMITS.category).optional(),
    coverImage: imageUrlField.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const blogPublishSchema = z
  .object({ publishedAt: z.iso.datetime({ offset: true }).optional() })
  .strict();

// ── FAQ ─────────────────────────────────────────────────────────────────────
export const FAQ_LIMITS = { question: 200, answer: 2000, category: 40 } as const;

export const faqListQuerySchema = z.object({
  ...pageQuery,
  limit: z.coerce.number().int().min(1).max(200).default(100),
  status: z.enum(['draft', 'published']).optional(),
  category: z.string().trim().max(FAQ_LIMITS.category).optional(),
  q,
});

export const faqCreateSchema = z
  .object({
    question: safeText(FAQ_LIMITS.question, { min: 1 }),
    answer: safeText(FAQ_LIMITS.answer, { multiline: true }).optional(),
    category: safeText(FAQ_LIMITS.category, { min: 1 }).optional(),
  })
  .strict();

export const faqUpdateSchema = z
  .object({
    question: safeText(FAQ_LIMITS.question, { min: 1 }).optional(),
    answer: safeText(FAQ_LIMITS.answer, { multiline: true }).optional(),
    category: safeText(FAQ_LIMITS.category, { min: 1 }).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const orderSchema = z
  .object({
    ids: z.array(z.string().trim().min(1).max(64)).min(1).max(500),
  })
  .strict()
  .refine((v) => new Set(v.ids).size === v.ids.length, { message: 'ids must be unique' });

export const emptyBodySchema = z.object({}).strict();

// ── Testimonials ────────────────────────────────────────────────────────────
export const TESTIMONIAL_LIMITS = { name: 80, roleTitle: 80, content: 500 } as const;

export const testimonialListQuerySchema = z.object({
  ...pageQuery,
  limit: z.coerce.number().int().min(1).max(200).default(100),
  status: z.enum(['draft', 'published']).optional(),
  q,
});

export const testimonialCreateSchema = z
  .object({
    name: safeText(TESTIMONIAL_LIMITS.name, { min: 1 }),
    roleTitle: safeText(TESTIMONIAL_LIMITS.roleTitle, { min: 1 }),
    content: safeText(TESTIMONIAL_LIMITS.content, { min: 1, multiline: true }),
    rating: z.number().int().min(1).max(5).optional(),
    avatarUrl: imageUrlField.optional(),
    hasConsent: z.boolean().optional(),
  })
  .strict();

export const testimonialUpdateSchema = z
  .object({
    name: safeText(TESTIMONIAL_LIMITS.name, { min: 1 }).optional(),
    roleTitle: safeText(TESTIMONIAL_LIMITS.roleTitle, { min: 1 }).optional(),
    content: safeText(TESTIMONIAL_LIMITS.content, { min: 1, multiline: true }).optional(),
    rating: z.number().int().min(1).max(5).optional(),
    avatarUrl: imageUrlField.optional(),
    hasConsent: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const featuredSchema = z.object({ isFeatured: z.boolean() }).strict();

// ── Teachers ────────────────────────────────────────────────────────────────
export const TEACHER_LIMITS = { headline: 120, bio: 1000, qualifications: 200 } as const;

export const teacherProfileFields = {
  headline: safeText(TEACHER_LIMITS.headline).nullable(),
  bio: safeText(TEACHER_LIMITS.bio, { multiline: true }).nullable(),
  avatarUrl: imageUrlField,
  qualifications: safeText(TEACHER_LIMITS.qualifications).nullable(),
  experienceYears: z.number().int().min(0).max(60).nullable(),
};

export const teacherListQuerySchema = z.object({
  ...pageQuery,
  q,
  isPublicProfile: z.enum(['true', 'false']).optional(),
  branchId: z.string().trim().min(1).max(64).optional(),
});

export const teacherPatchSchema = z
  .object({
    isPublicProfile: z.boolean().optional(),
    publicOrder: z.number().int().min(0).max(9999).optional(),
    headline: teacherProfileFields.headline.optional(),
    bio: teacherProfileFields.bio.optional(),
    avatarUrl: teacherProfileFields.avatarUrl.optional(),
    qualifications: teacherProfileFields.qualifications.optional(),
    experienceYears: teacherProfileFields.experienceYears.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

// ── Reviews ─────────────────────────────────────────────────────────────────
export const reviewListQuerySchema = z.object({
  ...pageQuery,
  hidden: z.enum(['true', 'false']).optional(),
  batchId: z.string().trim().min(1).max(64).optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
});

export const reviewVisibilitySchema = z
  .object({
    isHidden: z.boolean(),
    reason: safeText(200).optional(),
  })
  .strict();
