import { z } from 'zod';
import { FeeType, DiscountType } from '@prisma/client';

export const updateBatchFeeSchema = z.object({
  feeType: z.nativeEnum(FeeType, {
    message: 'feeType must be one of: MONTHLY, ONE_TIME',
  }).optional(),
  feeAmount: z.number().positive('feeAmount must be a positive number').optional(),
});

export const setStudentFeeSchema = z
  .object({
    customFeeAmount: z
      .number()
      .positive('customFeeAmount must be a positive number')
      .nullable()
      .optional(),
    discountType: z
      .nativeEnum(DiscountType, {
        message: 'discountType must be one of: FIXED, PERCENTAGE',
      })
      .nullable()
      .optional(),
    discountValue: z
      .number()
      .min(0, 'discountValue must be at least 0')
      .nullable()
      .optional(),
    discountReason: z.string().nullable().optional(),
  })
  .refine(
    (data) => {
      const hasType = data.discountType !== undefined && data.discountType !== null;
      const hasValue = data.discountValue !== undefined && data.discountValue !== null;
      return hasType === hasValue;
    },
    {
      message: 'discountValue is required if discountType is set, and vice versa',
      path: ['discountValue'],
    }
  );

export const recordPaymentSchema = z.object({
  studentId: z.string().min(1, 'studentId is required'),
  batchId: z.string().min(1, 'batchId is required'),
  period: z.string().min(1, 'period is required'),
  amountDue: z.number().positive('amountDue must be positive').optional(),
  amountPaid: z.number().min(0, 'amountPaid cannot be negative').optional().default(0),
  dueDate: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const updatePaymentSchema = z.object({
  amountPaid: z.number().min(0, 'amountPaid cannot be negative').optional(),
  notes: z.string().optional().nullable(),
});

export const createInstallmentPlanSchema = z.object({
  studentId: z.string().min(1, 'studentId is required'),
  batchId: z.string().min(1, 'batchId is required'),
  installments: z
    .array(
      z.object({
        period: z.string().min(1, 'period is required'),
        amountDue: z.number().positive('amountDue must be positive'),
        dueDate: z.string().optional().nullable(),
      })
    )
    .min(2, 'Installment plan must contain at least 2 installments'),
});
