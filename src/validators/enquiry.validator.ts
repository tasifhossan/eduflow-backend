import { z } from 'zod';
import { EnquiryStage, EnquiryNoteKind } from '@prisma/client';
import { isValidBangladeshiPhone } from '../utils/phone';

export const enquirySourceEnum = z.enum([
  'WEBSITE',
  'WALK_IN',
  'PHONE',
  'FACEBOOK',
  'REFERRAL',
  'OTHER',
]);

export const enquiryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(15),
  stage: z.nativeEnum(EnquiryStage).optional(),
  source: enquirySourceEnum.optional(),
  branchId: z.string().trim().optional(),
  assignedToId: z.string().trim().optional(),
  q: z.string().trim().max(100).optional(),
  followUp: z.enum(['today', 'overdue', 'none']).optional(),
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional(),
  sort: z.enum(['newest', 'followUp']).optional().default('newest'),
  format: z.literal('csv').optional(),
});

export const createEnquirySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name cannot exceed 100 characters'),
  phone: z
    .string()
    .trim()
    .refine((val) => isValidBangladeshiPhone(val), {
      message: 'Please provide a valid 11-digit Bangladeshi phone number (e.g., 017XXXXXXXX)',
    }),
  email: z
    .string()
    .trim()
    .email('Invalid email address')
    .optional()
    .nullable()
    .or(z.literal('')),
  guardianName: z.string().trim().max(100, 'Guardian name cannot exceed 100 characters').optional().nullable(),
  source: enquirySourceEnum.default('WALK_IN'),
  stage: z.nativeEnum(EnquiryStage).optional().default(EnquiryStage.NEW),
  interestedBatchId: z.string().trim().optional().nullable().or(z.literal('')),
  interestedGrade: z.string().trim().max(40, 'Grade cannot exceed 40 characters').optional().nullable(),
  message: z.string().trim().max(1000, 'Message cannot exceed 1000 characters').optional().nullable(),
  assignedToId: z.string().trim().optional().nullable().or(z.literal('')),
  followUpAt: z.string().trim().optional().nullable().or(z.literal('')),
  branchId: z.string().trim().optional().nullable().or(z.literal('')),
});

export const updateEnquirySchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    phone: z
      .string()
      .trim()
      .refine((val) => isValidBangladeshiPhone(val), {
        message: 'Please provide a valid 11-digit Bangladeshi phone number (e.g., 017XXXXXXXX)',
      })
      .optional(),
    email: z.string().trim().email().optional().nullable().or(z.literal('')),
    guardianName: z.string().trim().max(100).optional().nullable(),
    source: enquirySourceEnum.optional(),
    stage: z.nativeEnum(EnquiryStage).optional(),
    lostReason: z.string().trim().max(500).optional().nullable(),
    interestedBatchId: z.string().trim().optional().nullable().or(z.literal('')),
    interestedGrade: z.string().trim().max(40).optional().nullable(),
    message: z.string().trim().max(1000).optional().nullable(),
    assignedToId: z.string().trim().optional().nullable().or(z.literal('')),
    followUpAt: z.string().trim().optional().nullable().or(z.literal('')),
    branchId: z.string().trim().optional().nullable().or(z.literal('')),
  })
  .refine(
    (data) => {
      if (data.stage === EnquiryStage.LOST) {
        return Boolean(data.lostReason && data.lostReason.trim().length > 0);
      }
      return true;
    },
    {
      message: 'Reason is required when marking an enquiry as LOST',
      path: ['lostReason'],
    }
  );

export const createEnquiryNoteSchema = z.object({
  kind: z.nativeEnum(EnquiryNoteKind).default(EnquiryNoteKind.NOTE),
  body: z.string().trim().min(1, 'Note content is required').max(1000, 'Note content cannot exceed 1000 characters'),
});

export const duplicateQuerySchema = z.object({
  phone: z.string().trim().min(1, 'Phone is required'),
});

export const convertEnquirySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name cannot exceed 100 characters'),
  phone: z
    .string()
    .trim()
    .refine((val) => isValidBangladeshiPhone(val), {
      message: 'Please provide a valid 11-digit Bangladeshi phone number (e.g., 017XXXXXXXX)',
    }),
  email: z.string().trim().email('Invalid email address').optional().nullable().or(z.literal('')),
  batchId: z.string().trim().min(1, 'batchId is required'),
  guardian: z
    .object({
      name: z.string().trim().max(100).optional().nullable(),
      phone: z
        .string()
        .trim()
        .refine((val) => !val || isValidBangladeshiPhone(val), {
          message: 'Please provide a valid 11-digit Bangladeshi phone number for guardian',
        })
        .optional()
        .nullable()
        .or(z.literal('')),
    })
    .optional()
    .nullable(),
  admissionFee: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, 'Admission fee must be a valid amount')
    .optional()
    .nullable()
    .or(z.literal('')),
});

export const enquiryIdParamSchema = z.object({
  id: z.string().min(1, 'Enquiry ID is required'),
});
