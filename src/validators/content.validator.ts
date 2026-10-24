import { z } from 'zod';
import { ContactMessageStatus } from '@prisma/client';

export const blogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(9),
  category: z.string().trim().optional(),
  q: z.string().trim().optional(),
});

export const blogSlugParamSchema = z.object({
  slug: z.string().min(1, 'Slug is required'),
});

export const faqQuerySchema = z.object({
  category: z.string().trim().optional(),
});

export const batchIdParamSchema = z.object({
  batchId: z.string().min(1, 'Batch ID is required'),
});

export const reviewIdParamSchema = z.object({
  id: z.string().min(1, 'Review ID is required'),
});

export const reviewPaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});

export const createReviewSchema = z.object({
  rating: z.coerce.number().int().min(1, 'Rating must be at least 1').max(5, 'Rating cannot exceed 5'),
  comment: z.string().max(1000, 'Comment cannot exceed 1000 characters').optional().nullable(),
});

export const updateReviewSchema = z.object({
  rating: z.coerce.number().int().min(1, 'Rating must be at least 1').max(5, 'Rating cannot exceed 5').optional(),
  comment: z.string().max(1000, 'Comment cannot exceed 1000 characters').optional().nullable(),
}).refine((data) => data.rating !== undefined || data.comment !== undefined, {
  message: 'At least one field (rating or comment) must be provided for update',
});

import { isValidBangladeshiPhone } from '../utils/phone';

export const createContactMessageSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(100, 'Name cannot exceed 100 characters'),
    email: z
      .string()
      .trim()
      .email('Invalid email address')
      .optional()
      .nullable()
      .or(z.literal('')),
    phone: z.string().trim().optional().nullable().or(z.literal('')),
    subject: z.string().trim().max(200).optional().nullable(),
    message: z.string().trim().max(1000, 'Message cannot exceed 1000 characters').optional().nullable(),
    interestedBatchId: z.string().trim().optional().nullable().or(z.literal('')),
    interestedGrade: z.string().trim().max(40, 'Grade cannot exceed 40 characters').optional().nullable().or(z.literal('')),
    source: z.string().trim().max(50).optional().default('WEBSITE'),
    website: z.string().optional(), // Honeypot field
  })
  .refine(
    (data) => {
      const hasEmail = Boolean(data.email && data.email.trim().length > 0);
      const hasPhone = Boolean(data.phone && data.phone.trim().length > 0);
      return hasEmail || hasPhone;
    },
    {
      message: 'At least one contact method (phone or email) is required',
      path: ['phone'],
    }
  )
  .refine(
    (data) => {
      if (!data.phone || data.phone.trim().length === 0) return true;
      return isValidBangladeshiPhone(data.phone);
    },
    {
      message: 'Please provide a valid 11-digit Bangladeshi phone number (e.g., 017XXXXXXXX)',
      path: ['phone'],
    }
  );

export const contactQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(15),
  status: z.nativeEnum(ContactMessageStatus).optional(),
});

export const contactIdParamSchema = z.object({
  id: z.string().min(1, 'Contact message ID is required'),
});

export const updateContactStatusSchema = z.object({
  status: z.nativeEnum(ContactMessageStatus, { message: 'Invalid contact status' }),
});

export const newsletterSubscribeSchema = z.object({
  email: z.string().trim().email('Invalid email address'),
});
