import { Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { calculateNetFee } from '../utils/fee-calculator';
import {
  updateBatchFeeSchema,
  setStudentFeeSchema,
  recordPaymentSchema,
  updatePaymentSchema,
  createInstallmentPlanSchema,
} from '../validators/fee.validator';

const prisma = new PrismaClient();

/**
 * PATCH /batches/:id/fee
 * Updates a batch's feeType and/or feeAmount (branch restricted).
 */
export async function updateBatchFee(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const branchId = req.user.branchId;

    const existingBatch = await prisma.batch.findUnique({
      where: { id },
    });

    if (!existingBatch) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found',
      });
    }

    if (existingBatch.branchId !== branchId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied to this batch',
      });
    }

    const parseResult = updateBatchFeeSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { feeType, feeAmount } = parseResult.data;

    const updatedBatch = await prisma.batch.update({
      where: { id },
      data: {
        ...(feeType !== undefined && { feeType }),
        ...(feeAmount !== undefined && { feeAmount }),
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Batch fee updated successfully',
      data: updatedBatch,
    });
  } catch (error) {
    console.error('Update batch fee error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

/**
 * PATCH /enrollments/:id/fee
 * Sets customFeeAmount, discountType, discountValue, discountReason for an enrollment.
 */
export async function setStudentFee(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const branchId = req.user.branchId;

    const enrollment = await prisma.enrollment.findUnique({
      where: { id },
      include: { batch: true },
    });

    if (!enrollment) {
      return res.status(404).json({
        success: false,
        message: 'Enrollment not found',
      });
    }

    if (enrollment.batch.branchId !== branchId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied to this enrollment',
      });
    }

    const parseResult = setStudentFeeSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { customFeeAmount, discountType, discountValue, discountReason } = parseResult.data;

    const updatedEnrollment = await prisma.enrollment.update({
      where: { id },
      data: {
        customFeeAmount,
        discountType,
        discountValue,
        discountReason,
      },
      include: {
        batch: {
          select: { id: true, name: true, feeType: true, feeAmount: true },
        },
        student: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Student fee configuration updated successfully',
      data: updatedEnrollment,
    });
  } catch (error) {
    console.error('Set student fee error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

/**
 * GET /enrollments/:id/net-fee
 * Calculates net fee preview for a specific enrollment.
 */
export async function getStudentNetFee(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const branchId = req.user.branchId;

    const enrollment = await prisma.enrollment.findUnique({
      where: { id },
      include: { batch: true },
    });

    if (!enrollment) {
      return res.status(404).json({
        success: false,
        message: 'Enrollment not found',
      });
    }

    if (enrollment.batch.branchId !== branchId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied to this enrollment',
      });
    }

    const baseFee = enrollment.batch.feeAmount;
    const effectiveBaseFee = enrollment.customFeeAmount ?? baseFee;
    const netFee = calculateNetFee(
      effectiveBaseFee,
      enrollment.discountType,
      enrollment.discountValue
    );

    return res.status(200).json({
      success: true,
      message: 'Student net fee calculated successfully',
      data: {
        baseFee,
        customFeeAmount: enrollment.customFeeAmount,
        discountType: enrollment.discountType,
        discountValue: enrollment.discountValue,
        discountReason: enrollment.discountReason,
        netFee,
      },
    });
  } catch (error) {
    console.error('Get student net fee error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

/**
 * POST /payments
 * Creates a single FeePayment record.
 */
export async function createPaymentRecord(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const parseResult = recordPaymentSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { studentId, batchId, period, amountDue, amountPaid, dueDate, notes } = parseResult.data;
    const branchId = req.user.branchId;

    // Verify batch
    const batch = await prisma.batch.findUnique({ where: { id: batchId } });
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Batch not found' });
    }
    if (batch.branchId !== branchId) {
      return res.status(403).json({ success: false, message: 'Batch does not belong to your branch' });
    }

    // Verify student
    const student = await prisma.user.findUnique({ where: { id: studentId } });
    if (!student || student.branchId !== branchId) {
      return res.status(404).json({ success: false, message: 'Student not found in your branch' });
    }

    // Verify enrollment
    const enrollment = await prisma.enrollment.findUnique({
      where: { studentId_batchId: { studentId, batchId } },
    });
    if (!enrollment) {
      return res.status(404).json({ success: false, message: 'Student is not enrolled in this batch' });
    }

    // Derive amountDue if not provided
    let finalAmountDue: number;
    if (amountDue !== undefined) {
      finalAmountDue = amountDue;
    } else {
      const effectiveBaseFee = enrollment.customFeeAmount ?? batch.feeAmount;
      finalAmountDue = calculateNetFee(
        effectiveBaseFee,
        enrollment.discountType,
        enrollment.discountValue
      );
    }

    const paid = amountPaid ?? 0;
    const status = paid >= finalAmountDue ? 'PAID' : paid > 0 ? 'PARTIAL' : 'DUE';
    const paidAt = status === 'PAID' ? new Date() : null;

    const payment = await prisma.feePayment.create({
      data: {
        studentId,
        batchId,
        period,
        amountDue: finalAmountDue,
        amountPaid: paid,
        status,
        dueDate: dueDate ? new Date(dueDate) : null,
        paidAt,
        recordedById: req.user.userId,
        notes: notes || null,
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Payment record created successfully',
      data: payment,
    });
  } catch (error: any) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({
        success: false,
        message: 'Payment record for this student, batch, and period already exists',
      });
    }

    console.error('Create payment record error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

/**
 * POST /payments/installment-plan
 * Creates multiple FeePayment records in a single transaction.
 */
export async function createInstallmentPlan(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const parseResult = createInstallmentPlanSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { studentId, batchId, installments } = parseResult.data;
    const branchId = req.user.branchId;

    // Verify batch
    const batch = await prisma.batch.findUnique({ where: { id: batchId } });
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Batch not found' });
    }
    if (batch.branchId !== branchId) {
      return res.status(403).json({ success: false, message: 'Batch does not belong to your branch' });
    }

    // Verify student
    const student = await prisma.user.findUnique({ where: { id: studentId } });
    if (!student || student.branchId !== branchId) {
      return res.status(404).json({ success: false, message: 'Student not found in your branch' });
    }

    // Verify enrollment
    const enrollment = await prisma.enrollment.findUnique({
      where: { studentId_batchId: { studentId, batchId } },
    });
    if (!enrollment) {
      return res.status(404).json({ success: false, message: 'Student is not enrolled in this batch' });
    }

    // Check if any period already exists
    const periods = installments.map((i) => i.period);
    const existingPayments = await prisma.feePayment.findMany({
      where: {
        studentId,
        batchId,
        period: { in: periods },
      },
    });

    if (existingPayments.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Installment record already exists for period(s): ${existingPayments.map((p) => p.period).join(', ')}`,
      });
    }

    // Execute creation inside transaction
    const createdPayments = await prisma.$transaction(
      installments.map((inst) =>
        prisma.feePayment.create({
          data: {
            studentId,
            batchId,
            period: inst.period,
            amountDue: inst.amountDue,
            amountPaid: 0,
            status: 'DUE',
            dueDate: inst.dueDate ? new Date(inst.dueDate) : null,
            paidAt: null,
            recordedById: req.user!.userId,
          },
        })
      )
    );

    return res.status(201).json({
      success: true,
      message: 'Installment plan created successfully',
      data: createdPayments,
    });
  } catch (error: any) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({
        success: false,
        message: 'One or more installment periods already exist for this student and batch',
      });
    }

    console.error('Create installment plan error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

/**
 * PATCH /payments/:id
 * Updates amountPaid and/or notes on an existing FeePayment record.
 */
export async function updatePaymentRecord(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const branchId = req.user.branchId;

    const existingPayment = await prisma.feePayment.findUnique({
      where: { id },
      include: { batch: true },
    });

    if (!existingPayment) {
      return res.status(404).json({
        success: false,
        message: 'Payment record not found',
      });
    }

    if (existingPayment.batch.branchId !== branchId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied to this payment record',
      });
    }

    const parseResult = updatePaymentSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { amountPaid, notes } = parseResult.data;

    const newAmountPaid = amountPaid !== undefined ? amountPaid : existingPayment.amountPaid;
    const status =
      newAmountPaid >= existingPayment.amountDue
        ? 'PAID'
        : newAmountPaid > 0
        ? 'PARTIAL'
        : 'DUE';

    const paidAt = status === 'PAID' ? existingPayment.paidAt || new Date() : null;

    const updatedPayment = await prisma.feePayment.update({
      where: { id },
      data: {
        amountPaid: newAmountPaid,
        status,
        paidAt,
        ...(notes !== undefined && { notes }),
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Payment record updated successfully',
      data: updatedPayment,
    });
  } catch (error) {
    console.error('Update payment record error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

/**
 * GET /batches/:batchId/payments
 * Lists all FeePayments for a batch (optionally filtered by ?period=).
 */
export async function getPaymentsByBatch(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const batchId = req.params.batchId as string;
    const period = req.query.period as string | undefined;
    const branchId = req.user.branchId;

    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
    });

    if (!batch) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found',
      });
    }

    if (batch.branchId !== branchId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied to this batch',
      });
    }

    const payments = await prisma.feePayment.findMany({
      where: {
        batchId,
        ...(period ? { period } : {}),
      },
      include: {
        student: {
          select: { id: true, name: true, email: true, phone: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({
      success: true,
      message: 'Batch fee payments retrieved successfully',
      data: payments,
    });
  } catch (error) {
    console.error('Get batch fee payments error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

/**
 * GET /students/:studentId/payments
 * Lists all FeePayments for a student across all batches.
 */
export async function getPaymentsByStudent(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const studentId = req.params.studentId as string;
    const branchId = req.user.branchId;

    const student = await prisma.user.findUnique({
      where: { id: studentId },
    });

    if (!student || student.branchId !== branchId) {
      return res.status(404).json({
        success: false,
        message: 'Student not found in your branch',
      });
    }

    const payments = await prisma.feePayment.findMany({
      where: { studentId },
      include: {
        batch: {
          select: { id: true, name: true, type: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({
      success: true,
      message: 'Student fee payments retrieved successfully',
      data: payments,
    });
  } catch (error) {
    console.error('Get student fee payments error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

/**
 * GET /payments/due-summary
 * Returns counts/totals of DUE and PARTIAL payments for a branch grouped by batch.
 */
export async function getDueSummary(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const branchId = req.user.branchId;

    const dueOrPartialPayments = await prisma.feePayment.findMany({
      where: {
        batch: { branchId },
        status: { in: ['DUE', 'PARTIAL'] },
      },
      include: {
        batch: {
          select: { id: true, name: true },
        },
      },
    });

    const summaryMap: Record<
      string,
      {
        batchId: string;
        batchName: string;
        dueCount: number;
        partialCount: number;
        totalAmountDue: number;
        totalAmountPaid: number;
        totalRemaining: number;
      }
    > = {};

    for (const payment of dueOrPartialPayments) {
      const bId = payment.batchId;
      if (!summaryMap[bId]) {
        summaryMap[bId] = {
          batchId: bId,
          batchName: payment.batch.name,
          dueCount: 0,
          partialCount: 0,
          totalAmountDue: 0,
          totalAmountPaid: 0,
          totalRemaining: 0,
        };
      }

      if (payment.status === 'DUE') {
        summaryMap[bId].dueCount += 1;
      } else if (payment.status === 'PARTIAL') {
        summaryMap[bId].partialCount += 1;
      }

      summaryMap[bId].totalAmountDue += payment.amountDue;
      summaryMap[bId].totalAmountPaid += payment.amountPaid;
      summaryMap[bId].totalRemaining += payment.amountDue - payment.amountPaid;
    }

    return res.status(200).json({
      success: true,
      message: 'Due summary retrieved successfully',
      data: Object.values(summaryMap),
    });
  } catch (error) {
    console.error('Get due summary error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}
