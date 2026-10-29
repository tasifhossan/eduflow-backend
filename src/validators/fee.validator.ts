import { z } from 'zod';
import { PaymentMethod, FeeAdjustmentType, FeeChargeKind } from '@prisma/client';

export const paymentAllocationSchema = z.object({
  mode: z.enum(['AUTO', 'MANUAL']).default('AUTO'),
  batchId: z.string().optional(),
  items: z
    .array(
      z.object({
        chargeId: z.string().min(1, 'chargeId is required'),
        amount: z.coerce.number().positive('Allocation amount must be positive'),
      })
    )
    .optional(),
});

export const recordPaymentLedgerSchema = z.object({
  studentId: z.string().min(1, 'studentId is required'),
  amount: z.coerce.number().positive('Payment amount must be greater than 0'),
  method: z.nativeEnum(PaymentMethod, {
    message: 'Invalid payment method',
  }),
  reference: z.string().max(100).optional().nullable(),
  receivedAt: z.string().datetime().optional().nullable(),
  note: z.string().max(500).optional().nullable(),
  allocation: paymentAllocationSchema.optional(),
});

export const reversePaymentSchema = z.object({
  reason: z.string().min(1, 'Reason is required').max(200, 'Reason cannot exceed 200 characters'),
});

export const createChargeSchema = z.object({
  studentId: z.string().min(1, 'studentId is required'),
  batchId: z.string().min(1, 'batchId is required'),
  amount: z.coerce.number().positive('Charge amount must be positive'),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'dueDate must be in YYYY-MM-DD format'),
  description: z.string().min(1, 'description is required').max(200),
  kind: z.nativeEnum(FeeChargeKind).default(FeeChargeKind.OTHER),
  period: z.string().optional().nullable(),
});

export const voidChargeSchema = z.object({
  reason: z.string().min(1, 'Void reason is required').max(200),
});

export const createInstallmentsSchema = z.object({
  studentId: z.string().min(1, 'studentId is required'),
  batchId: z.string().min(1, 'batchId is required'),
  total: z.coerce.number().positive('Total installment amount must be positive'),
  count: z.coerce.number().int().min(2, 'Installment count must be at least 2').max(12, 'Installment count cannot exceed 12'),
  firstDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'firstDueDate must be in YYYY-MM-DD format'),
  intervalMonths: z.coerce.number().int().min(1).max(12).default(1),
  description: z.string().max(200).optional(),
});

export const generateDuesSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be in YYYY-MM format'),
  batchId: z.string().optional().nullable(),
  dryRun: z.coerce.boolean().optional().default(false),
});

export const createAdjustmentSchema = z.object({
  chargeId: z.string().min(1, 'chargeId is required'),
  type: z.nativeEnum(FeeAdjustmentType),
  amount: z.coerce.number().positive('Adjustment amount must be positive'),
  reason: z.string().min(1, 'Reason is required').max(200),
});

export const voidAdjustmentSchema = z.object({
  reason: z.string().min(1, 'Void reason is required').max(200),
});

export const paymentsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  method: z.nativeEnum(PaymentMethod).optional(),
  batchId: z.string().optional(),
  studentId: z.string().optional(),
  receivedById: z.string().optional(),
  includeReversed: z
    .preprocess((val) => (val === 'true' || val === true ? true : false), z.boolean())
    .default(false),
  format: z.enum(['csv', 'json']).optional().default('json'),
});

export const duesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  month: z.string().optional(),
  batchId: z.string().optional(),
  status: z.enum(['DUE', 'PARTIAL', 'OVERDUE', 'PAID', 'ALL']).optional().default('ALL'),
  format: z.enum(['csv', 'json']).optional().default('json'),
});

export const collectionReportQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'from must be YYYY-MM-DD'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'to must be YYYY-MM-DD'),
  groupBy: z.enum(['day', 'method', 'batch', 'receiver']).default('day'),
  batchId: z.string().optional(),
});

// Legacy / Batch / Enrollment Fee Schemas
export const updateBatchFeeSchema = z.object({
  feeType: z.enum(['MONTHLY', 'ONE_TIME']).optional(),
  feeAmount: z.coerce.number().min(0).optional(),
});

export const setStudentFeeSchema = z.object({
  customFeeAmount: z.coerce.number().min(0).optional().nullable(),
  discountType: z.enum(['FIXED', 'PERCENTAGE']).optional().nullable(),
  discountValue: z.coerce.number().min(0).optional().nullable(),
  discountReason: z.string().optional().nullable(),
});

export const recordPaymentSchema = z.object({
  studentId: z.string().min(1),
  batchId: z.string().min(1),
  period: z.string().min(1),
  amountDue: z.coerce.number().min(0).optional(),
  amountPaid: z.coerce.number().min(0).optional(),
  dueDate: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const updatePaymentSchema = z.object({
  amountPaid: z.coerce.number().min(0).optional(),
  notes: z.string().optional().nullable(),
});

export const createInstallmentPlanSchema = z.object({
  studentId: z.string().min(1),
  batchId: z.string().min(1),
  installments: z.array(
    z.object({
      period: z.string().min(1),
      amountDue: z.coerce.number().min(0),
      dueDate: z.string().optional().nullable(),
    })
  ),
});

