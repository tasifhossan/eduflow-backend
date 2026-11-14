import { Request, Response } from 'express';
import { Role, Prisma, PaymentMethod, FeeChargeKind, FeeAdjustmentType } from '@prisma/client';
import prisma, { runTimedTransaction } from '../utils/prisma';
import { FeeLedgerService } from '../services/fee-ledger.service';
import { formatMoney, roundMoney } from '../utils/money';
import { createAuditLog } from '../utils/audit';
import {
  recordPaymentLedgerSchema,
  reversePaymentSchema,
  createChargeSchema,
  voidChargeSchema,
  createInstallmentsSchema,
  generateDuesSchema,
  createAdjustmentSchema,
  voidAdjustmentSchema,
  paymentsQuerySchema,
  duesQuerySchema,
  collectionReportQuerySchema,
} from '../validators/fee.validator';

/**
 * Helper to fetch center settings for timezone and receipt headers/footers
 */
async function getCenterSettings() {
  const settings = await prisma.centerSettings.findUnique({
    where: { key: 'center' },
  });
  return {
    timezone: settings?.timezone || 'Asia/Dhaka',
    feeDueDay: settings?.feeDueDay ?? 10,
    receiptHeader: settings?.receiptHeader || null,
    receiptFooter: settings?.receiptFooter || null,
    centerName: settings?.name || 'EduFlow Coaching',
  };
}

/**
 * Resolves effective branch scoping for fee endpoints
 */
function resolveBranchScope(req: Request): string | null {
  if (req.user?.role === Role.SUPER_ADMIN) {
    const qBranch = (req.query.branchId as string) || (req.body?.branchId as string);
    return qBranch || null;
  }
  return req.user?.branchId || null;
}

/**
 * GET /api/fees/students/search?q=
 * Staff only (ADMIN, SUPER_ADMIN, ACCOUNTANT), max 20 results.
 */
export async function searchStudents(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    if (
      req.user.role !== Role.ADMIN &&
      req.user.role !== Role.SUPER_ADMIN &&
      req.user.role !== Role.ACCOUNTANT
    ) {
      return res.status(403).json({ success: false, message: 'Forbidden: Access denied' });
    }

    const q = ((req.query.q as string) || '').trim();
    if (!q) {
      return res.status(200).json({ success: true, data: [] });
    }

    const branchId = resolveBranchScope(req);

    const where: Prisma.UserWhereInput = {
      role: Role.STUDENT,
      ...(branchId ? { branchId } : {}),
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { studentCode: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
      ],
    };

    const students = await prisma.user.findMany({
      where,
      take: 20,
      select: {
        id: true,
        name: true,
        studentCode: true,
        phone: true,
        branchId: true,
        branch: { select: { id: true, name: true, code: true } },
        enrollments: {
          where: { status: 'ACTIVE' },
          select: {
            batch: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const data = students.map((s) => ({
      id: s.id,
      name: s.name,
      studentCode: s.studentCode,
      phone: s.phone,
      branchId: s.branchId,
      branchName: s.branch.name,
      batches: s.enrollments.map((e) => e.batch.name),
    }));

    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error('searchStudents error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

/**
 * Builds comprehensive account statement for a student
 */
export async function buildStudentAccountStatement(studentId: string, timezone: string) {
  const todayStr = FeeLedgerService.getTodayInTimezone(timezone);

  const student = await prisma.user.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      name: true,
      studentCode: true,
      phone: true,
      branchId: true,
      branch: { select: { id: true, name: true, code: true } },
    },
  });

  if (!student) return null;

  // 1. Fetch charges with adjustments and allocations
  const charges = await prisma.feeCharge.findMany({
    where: { studentId },
    include: {
      batch: { select: { id: true, name: true } },
      adjustments: { orderBy: { createdAt: 'asc' } },
      allocations: {
        include: {
          payment: { select: { id: true, receiptNumber: true, reversal: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { dueDate: 'asc' },
  });

  const formattedCharges = charges.map((ch) => {
    const bal = FeeLedgerService.deriveChargeStatus(ch, todayStr);
    return {
      id: ch.id,
      batchId: ch.batchId,
      batchName: ch.batch.name,
      kind: ch.kind,
      period: ch.period,
      description: ch.description,
      dueDate: ch.dueDate.toISOString().slice(0, 10),
      originalAmount: formatMoney(bal.originalAmount),
      totalAdjustments: formatMoney(bal.totalAdjustments),
      effectiveAmount: formatMoney(bal.effectiveAmount),
      paidAmount: formatMoney(bal.paidAmount),
      paid: formatMoney(bal.paidAmount),
      balance: formatMoney(bal.balance),
      status: bal.status,
      source: ch.source,
      createdAt: ch.createdAt.toISOString(),
      voidReason: ch.voidReason || null,
      adjustments: ch.adjustments.map((a) => ({
        id: a.id,
        type: a.type,
        amount: formatMoney(a.amount),
        reason: a.reason,
        status: a.status,
        createdAt: a.createdAt.toISOString(),
      })),
    };
  });

  // 2. Fetch payments with allocations and reversals
  const payments = await prisma.payment.findMany({
    where: { studentId },
    include: {
      allocations: {
        include: {
          charge: {
            select: { id: true, description: true, period: true },
          },
        },
      },
      reversal: true,
      receivedBy: { select: { id: true, name: true } },
    },
    orderBy: { receivedAt: 'desc' },
  });

  const formattedPayments = payments.map((p) => {
    const allocatedTotal = p.allocations.reduce((sum, a) => sum.add(a.amount), new Prisma.Decimal(0));
    const unallocated = p.reversal ? new Prisma.Decimal(0) : p.amount.sub(allocatedTotal);

    return {
      id: p.id,
      receiptNumber: p.receiptNumber,
      receivedAt: p.receivedAt.toISOString(),
      amount: formatMoney(p.amount),
      method: p.method,
      reference: p.reference || null,
      note: p.note || null,
      receivedById: p.receivedById,
      receivedByName: p.receivedBy.name,
      isReversed: !!p.reversal,
      reversal: p.reversal
        ? {
            reason: p.reversal.reason,
            reversedAt: p.reversal.reversedAt.toISOString(),
          }
        : null,
      allocations: p.allocations.map((a) => ({
        chargeId: a.chargeId,
        chargeDescription: a.charge.description,
        period: a.charge.period,
        amount: formatMoney(a.amount),
      })),
      unallocatedAmount: formatMoney(unallocated.gt(0) ? unallocated : new Prisma.Decimal(0)),
    };
  });

  // 3. Totals and credit
  const credit = await FeeLedgerService.getStudentCredit(studentId);

  let totalCharges = new Prisma.Decimal(0);
  let totalEffective = new Prisma.Decimal(0);
  let totalPaid = new Prisma.Decimal(0);
  let totalOutstanding = new Prisma.Decimal(0);

  for (const ch of formattedCharges) {
    if (ch.status !== 'VOID') {
      totalCharges = totalCharges.add(new Prisma.Decimal(ch.originalAmount));
      totalEffective = totalEffective.add(new Prisma.Decimal(ch.effectiveAmount));
      totalPaid = totalPaid.add(new Prisma.Decimal(ch.paidAmount));
      totalOutstanding = totalOutstanding.add(new Prisma.Decimal(ch.balance));
    }
  }

  return {
    student: {
      id: student.id,
      name: student.name,
      studentCode: student.studentCode,
      phone: student.phone,
      branchId: student.branchId,
      branchName: student.branch.name,
    },
    creditBalance: formatMoney(credit),
    studentCredit: formatMoney(credit),
    totals: {
      totalCharges: formatMoney(totalCharges),
      totalEffective: formatMoney(totalEffective),
      totalPaid: formatMoney(totalPaid),
      totalOutstanding: formatMoney(totalOutstanding),
      studentCredit: formatMoney(credit),
      creditBalance: formatMoney(credit),
    },
    charges: formattedCharges,
    payments: formattedPayments,
  };
}

/**
 * GET /api/fees/students/:studentId/account
 * Scoped account statement (ADMIN, SUPER_ADMIN, ACCOUNTANT)
 */
export async function getStudentAccount(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const studentId = req.params.studentId as string;
    const student = await prisma.user.findUnique({
      where: { id: studentId },
      select: { branchId: true },
    });

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    // Role check
    if (req.user.role === Role.ADMIN || req.user.role === Role.ACCOUNTANT) {
      if (student.branchId !== req.user.branchId) {
        return res.status(403).json({ success: false, message: 'Forbidden: Cross-branch access denied' });
      }
    } else if (req.user.role === Role.STUDENT) {
      if (req.user.userId !== studentId) {
        return res.status(403).json({ success: false, message: 'Forbidden: Access denied' });
      }
    } else if (req.user.role === Role.GUARDIAN) {
      const link = await prisma.guardianLink.findUnique({
        where: { guardianId_studentId: { guardianId: req.user.userId, studentId } },
      });
      if (!link) {
        return res.status(403).json({ success: false, message: 'Forbidden: Not linked to this student' });
      }
    } else if (req.user.role !== Role.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Forbidden: Access denied' });
    }

    const settings = await getCenterSettings();
    const statement = await buildStudentAccountStatement(studentId, settings.timezone);

    return res.status(200).json({ success: true, data: statement });
  } catch (err) {
    console.error('getStudentAccount error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

/**
 * GET /api/fees/my-account (STUDENT only)
 */
export async function getMyAccount(req: Request, res: Response) {
  try {
    if (!req.user || req.user.role !== Role.STUDENT) {
      return res.status(403).json({ success: false, message: 'Forbidden: Students only' });
    }
    const settings = await getCenterSettings();
    const statement = await buildStudentAccountStatement(req.user.userId, settings.timezone);
    return res.status(200).json({ success: true, data: statement });
  } catch (err) {
    console.error('getMyAccount error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

/**
 * GET /api/fees/guardian/students/:studentId/account (GUARDIAN only)
 */
export async function getGuardianStudentAccount(req: Request, res: Response) {
  try {
    if (!req.user || req.user.role !== Role.GUARDIAN) {
      return res.status(403).json({ success: false, message: 'Forbidden: Guardians only' });
    }

    const studentId = req.params.studentId as string;
    const link = await prisma.guardianLink.findUnique({
      where: { guardianId_studentId: { guardianId: req.user.userId, studentId } },
    });

    if (!link) {
      return res.status(403).json({ success: false, message: 'Forbidden: Guardian is not linked to this student' });
    }

    const settings = await getCenterSettings();
    const statement = await buildStudentAccountStatement(studentId, settings.timezone);
    return res.status(200).json({ success: true, data: statement });
  } catch (err) {
    console.error('getGuardianStudentAccount error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

/**
 * POST /api/fees/payments
 * Creates an immutable Payment record with AUTO or MANUAL allocation and race-free receipt numbering.
 * Supports Idempotency-Key header.
 */
export async function recordPayment(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    if (
      req.user.role !== Role.ADMIN &&
      req.user.role !== Role.SUPER_ADMIN &&
      req.user.role !== Role.ACCOUNTANT
    ) {
      return res.status(403).json({ success: false, message: 'Forbidden: Access denied' });
    }

    const parseResult = recordPaymentLedgerSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { studentId, amount, method, reference, receivedAt, note, allocation } = parseResult.data;
    const paymentAmount = roundMoney(amount);

    // Verify student and branch
    const student = await prisma.user.findUnique({
      where: { id: studentId },
      select: { id: true, branchId: true },
    });

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    if (req.user.role !== Role.SUPER_ADMIN && student.branchId !== req.user.branchId) {
      return res.status(403).json({ success: false, message: 'Forbidden: Student belongs to another branch' });
    }

    const branchId = student.branchId;
    const idempotencyKey = (req.headers['idempotency-key'] as string) || null;

    // Idempotency check: if key provided, return original payment
    if (idempotencyKey) {
      const existingPayment = await prisma.payment.findFirst({
        where: {
          receivedById: req.user.userId,
          idempotencyKey,
        },
        include: {
          allocations: true,
        },
      });

      if (existingPayment) {
        const paymentPayload = {
          id: existingPayment.id,
          receiptNumber: existingPayment.receiptNumber,
          amount: formatMoney(existingPayment.amount),
          method: existingPayment.method,
          receivedAt: existingPayment.receivedAt.toISOString(),
          allocations: existingPayment.allocations.map((a) => ({
            chargeId: a.chargeId,
            amount: formatMoney(a.amount),
          })),
        };
        return res.status(200).json({
          success: true,
          message: 'Payment already recorded (idempotent)',
          data: {
            ...paymentPayload,
            payment: paymentPayload,
          },
        });
      }
    }

    const settings = await getCenterSettings();
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { code: true },
    });
    const branchCode = branch?.code || 'BR';
    const effectiveReceivedAt = receivedAt ? new Date(receivedAt) : new Date();
    const todayStr = FeeLedgerService.getTodayInTimezone(settings.timezone);
    const { fullYear, yy } = FeeLedgerService.getYearInTimezone(effectiveReceivedAt, settings.timezone);

    // Pre-read open charges and plan allocations before entering the transaction
    const mode = allocation?.mode || 'AUTO';
    const plannedAllocations: Array<{ chargeId: string; amount: Prisma.Decimal }> = [];

    if (mode === 'AUTO') {
      const openCharges = await prisma.feeCharge.findMany({
        where: {
          studentId,
          status: 'ACTIVE',
          ...(allocation?.batchId ? { batchId: allocation.batchId } : {}),
        },
        include: {
          adjustments: true,
          allocations: {
            include: { payment: { select: { reversal: true } } },
          },
        },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      });

      let remainingAmount = paymentAmount;
      for (const ch of openCharges) {
        if (remainingAmount.lte(0)) break;
        const balDetails = FeeLedgerService.deriveChargeStatus(ch, todayStr);
        if (balDetails.balance.gt(0)) {
          const toAlloc = Prisma.Decimal.min(remainingAmount, balDetails.balance);
          plannedAllocations.push({ chargeId: ch.id, amount: toAlloc });
          remainingAmount = remainingAmount.sub(toAlloc);
        }
      }
    } else if (mode === 'MANUAL') {
      const items = allocation?.items || [];
      let manualTotal = new Prisma.Decimal(0);
      const chargeIds = items.map((it) => it.chargeId);

      const openCharges = await prisma.feeCharge.findMany({
        where: {
          id: { in: chargeIds },
          studentId,
          status: 'ACTIVE',
        },
        include: {
          adjustments: true,
          allocations: {
            include: { payment: { select: { reversal: true } } },
          },
        },
      });

      const chargeMap = new Map(openCharges.map((c) => [c.id, c]));

      for (const it of items) {
        const allocAmt = roundMoney(it.amount);
        manualTotal = manualTotal.add(allocAmt);
        const ch = chargeMap.get(it.chargeId);
        if (!ch) {
          return res.status(400).json({ success: false, message: `Invalid charge ID: ${it.chargeId}` });
        }
        const balDetails = FeeLedgerService.deriveChargeStatus(ch, todayStr);
        if (allocAmt.gt(balDetails.balance)) {
          return res.status(400).json({
            success: false,
            message: `Allocation amount ${allocAmt.toFixed(2)} exceeds charge ${it.chargeId} balance ${balDetails.balance.toFixed(2)}`,
          });
        }
        plannedAllocations.push({ chargeId: ch.id, amount: allocAmt });
      }

      if (manualTotal.gt(paymentAmount)) {
        return res.status(400).json({
          success: false,
          message: `Total manual allocations (${manualTotal.toFixed(2)}) cannot exceed payment amount (${paymentAmount.toFixed(2)})`,
        });
      }
    }

    // Execute minimal write transaction with default 5s timeout
    const createdPayment = await runTimedTransaction(
      'fee.recordPayment',
      async (tx) => {
        // 1. Single atomic sequence increment RETURNING lastNumber
        const seqResult = await tx.$queryRaw<Array<{ lastNumber: number }>>`
          INSERT INTO "ReceiptSequence" ("id", "branchId", "year", "lastNumber")
          VALUES (concat('seq_', md5(random()::text || clock_timestamp()::text)), ${branchId}, ${fullYear}, 1)
          ON CONFLICT ("branchId", "year")
          DO UPDATE SET "lastNumber" = "ReceiptSequence"."lastNumber" + 1
          RETURNING "lastNumber"
        `;
        const nextNumber = seqResult[0]?.lastNumber || 1;
        const receiptNumber = `${branchCode}-${yy}-${String(nextNumber).padStart(6, '0')}`;

        // 2. Insert Payment
        const payment = await tx.payment.create({
          data: {
            branchId,
            studentId,
            receiptNumber,
            receivedAt: effectiveReceivedAt,
            amount: paymentAmount,
            method,
            reference: reference || null,
            note: note || null,
            receivedById: req.user!.userId,
            idempotencyKey,
            source: 'MANUAL',
          },
        });

        // 3. Batch insert allocations
        if (plannedAllocations.length > 0) {
          await tx.paymentAllocation.createMany({
            data: plannedAllocations.map((a) => ({
              branchId,
              paymentId: payment.id,
              chargeId: a.chargeId,
              amount: a.amount,
            })),
          });

          // 4. Single verification query to ensure charge balances are not over-allocated
          const allocatedChargeIds = plannedAllocations.map((a) => a.chargeId);
          const recheckedCharges = await tx.feeCharge.findMany({
            where: { id: { in: allocatedChargeIds } },
            include: {
              adjustments: true,
              allocations: {
                include: { payment: { select: { reversal: true } } },
              },
            },
          });

          for (const ch of recheckedCharges) {
            const bal = FeeLedgerService.deriveChargeStatus(ch, todayStr);
            if (bal.balance.lt(0)) {
              throw new Error(`Charge ${ch.id} balance over-allocated (${bal.balance.toFixed(2)})`);
            }
          }
        }

        return {
          payment,
          allocations: plannedAllocations,
        };
      }
    );

    // Audit log
    await createAuditLog({
      actorId: req.user.userId,
      action: 'PAYMENT_CREATE',
      entityType: 'Payment',
      entityId: createdPayment.payment.id,
      branchId,
      metadata: {
        paymentId: createdPayment.payment.id,
        receiptNumber: createdPayment.payment.receiptNumber,
        amount: formatMoney(createdPayment.payment.amount),
        method: createdPayment.payment.method,
        studentId,
      },
      ip: req.ip,
    });

    const paymentPayload = {
      id: createdPayment.payment.id,
      receiptNumber: createdPayment.payment.receiptNumber,
      amount: formatMoney(createdPayment.payment.amount),
      method: createdPayment.payment.method,
      receivedAt: createdPayment.payment.receivedAt.toISOString(),
      allocations: createdPayment.allocations.map((a) => ({
        chargeId: a.chargeId,
        amount: formatMoney(a.amount),
      })),
    };

    return res.status(201).json({
      success: true,
      message: 'Payment recorded successfully',
      data: {
        ...paymentPayload,
        payment: paymentPayload,
      },
    });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Concurrent idempotency hit
      const idempotencyKey = (req.headers['idempotency-key'] as string) || null;
      if (idempotencyKey && req.user) {
        const existing = await prisma.payment.findFirst({
          where: { receivedById: req.user.userId, idempotencyKey },
          include: { allocations: true },
        });
        if (existing) {
          const paymentPayload = {
            id: existing.id,
            receiptNumber: existing.receiptNumber,
            amount: formatMoney(existing.amount),
            method: existing.method,
            receivedAt: existing.receivedAt.toISOString(),
            allocations: existing.allocations.map((a) => ({
              chargeId: a.chargeId,
              amount: formatMoney(a.amount),
            })),
          };
          return res.status(200).json({
            success: true,
            message: 'Payment already recorded (idempotent)',
            data: {
              ...paymentPayload,
              payment: paymentPayload,
            },
          });
        }
      }
    }

    console.error('recordPayment error:', err);
    return res.status(400).json({
      success: false,
      message: err.message || 'Failed to record payment',
    });
  }
}

/**
 * POST /api/fees/payments/:id/reverse
 * Reverses a payment with a reason (ADMIN and SUPER_ADMIN only).
 */
export async function reversePayment(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    if (req.user.role !== Role.ADMIN && req.user.role !== Role.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Forbidden: Only administrators can reverse payments' });
    }

    const id = req.params.id as string;
    const parseResult = reversePaymentSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { reason } = parseResult.data;

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: { reversal: true },
    });

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    if (req.user.role === Role.ADMIN && payment.branchId !== req.user.branchId) {
      return res.status(403).json({ success: false, message: 'Forbidden: Access denied to other branches' });
    }

    if (payment.reversal) {
      return res.status(409).json({ success: false, message: 'Payment has already been reversed' });
    }

    const reversal = await prisma.paymentReversal.create({
      data: {
        branchId: payment.branchId,
        paymentId: payment.id,
        reason,
        reversedById: req.user.userId,
      },
    });

    // Audit log
    await createAuditLog({
      actorId: req.user.userId,
      action: 'PAYMENT_REVERSE',
      entityType: 'Payment',
      entityId: payment.id,
      branchId: payment.branchId,
      metadata: {
        paymentId: payment.id,
        receiptNumber: payment.receiptNumber,
        amount: formatMoney(payment.amount),
        reason,
      },
      ip: req.ip,
    });

    const reversalPayload = {
      id: reversal.id,
      paymentId: payment.id,
      receiptNumber: payment.receiptNumber,
      reversedAt: reversal.reversedAt.toISOString(),
      reason: reversal.reason,
    };

    return res.status(200).json({
      success: true,
      message: 'Payment reversed successfully',
      data: {
        ...reversalPayload,
        reversal: reversalPayload,
      },
    });
  } catch (err) {
    console.error('reversePayment error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

/**
 * GET /api/fees/receipts/:paymentId
 * Generates formatted receipt data.
 */
export async function getReceipt(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const paymentId = req.params.paymentId as string;
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        branch: { select: { id: true, name: true, code: true, address: true } },
        student: { select: { id: true, name: true, studentCode: true, branchId: true } },
        receivedBy: { select: { id: true, name: true } },
        reversal: true,
        allocations: {
          include: {
            charge: {
              select: {
                id: true,
                description: true,
                period: true,
                amount: true,
                batch: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Receipt not found' });
    }

    // Role scoping
    if (req.user.role === Role.STUDENT && req.user.userId !== payment.studentId) {
      return res.status(403).json({ success: false, message: 'Forbidden: Access denied' });
    } else if (req.user.role === Role.GUARDIAN) {
      const link = await prisma.guardianLink.findUnique({
        where: { guardianId_studentId: { guardianId: req.user.userId, studentId: payment.studentId } },
      });
      if (!link) {
        return res.status(403).json({ success: false, message: 'Forbidden: Access denied' });
      }
    } else if (
      (req.user.role === Role.ADMIN || req.user.role === Role.ACCOUNTANT) &&
      payment.branchId !== req.user.branchId
    ) {
      return res.status(403).json({ success: false, message: 'Forbidden: Cross-branch access denied' });
    }

    const settings = await getCenterSettings();

    // Compute remaining dues after this payment
    const todayStr = FeeLedgerService.getTodayInTimezone(settings.timezone);
    const charges = await prisma.feeCharge.findMany({
      where: { studentId: payment.studentId, status: 'ACTIVE' },
      include: {
        adjustments: true,
        allocations: {
          include: { payment: { select: { reversal: true } } },
        },
      },
    });

    let remainingDues = new Prisma.Decimal(0);
    for (const ch of charges) {
      const b = FeeLedgerService.deriveChargeStatus(ch, todayStr);
      remainingDues = remainingDues.add(b.balance);
    }

    const receiptDate = new Intl.DateTimeFormat('en-GB', {
      timeZone: settings.timezone,
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(payment.receivedAt);

    const receiptData = {
      receiptNumber: payment.receiptNumber,
      centerName: settings.centerName,
      receiptHeader: settings.receiptHeader,
      receiptFooter: settings.receiptFooter,
      branch: {
        name: payment.branch.name,
        code: payment.branch.code,
        address: payment.branch.address,
      },
      student: {
        id: payment.student.id,
        name: payment.student.name,
        studentCode: payment.student.studentCode,
      },
      allocatedCharges: payment.allocations.map((a) => ({
        chargeId: a.chargeId,
        description: a.charge.description,
        batchName: a.charge.batch.name,
        period: a.charge.period,
        amount: formatMoney(a.amount),
      })),
      amount: formatMoney(payment.amount),
      method: payment.method,
      reference: payment.reference || null,
      receivedBy: payment.receivedBy.name,
      receivedAtDate: receiptDate,
      isReversed: !!payment.reversal,
      remainingDues: formatMoney(remainingDues),
    };

    return res.status(200).json({ success: true, data: receiptData });
  } catch (err) {
    console.error('getReceipt error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

/**
 * GET /api/fees/payments
 * Lists paginated payments with filters and CSV export.
 */
export async function getPayments(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    if (
      req.user.role !== Role.ADMIN &&
      req.user.role !== Role.SUPER_ADMIN &&
      req.user.role !== Role.ACCOUNTANT
    ) {
      return res.status(403).json({ success: false, message: 'Forbidden: Access denied' });
    }

    const parseResult = paymentsQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        data: parseResult.error.flatten(),
      });
    }

    const { page, limit, startDate, endDate, method, batchId, studentId, receivedById, includeReversed, format } =
      parseResult.data;

    const branchId = resolveBranchScope(req);

    const where: Prisma.PaymentWhereInput = {
      ...(branchId ? { branchId } : {}),
      ...(method ? { method } : {}),
      ...(studentId ? { studentId } : {}),
      ...(receivedById ? { receivedById } : {}),
      ...(batchId ? { allocations: { some: { charge: { batchId } } } } : {}),
      ...(!includeReversed ? { reversal: null } : {}),
    };

    if (startDate || endDate) {
      where.receivedAt = {};
      if (startDate) where.receivedAt.gte = new Date(startDate);
      if (endDate) where.receivedAt.lte = new Date(endDate);
    }

    if (format === 'csv') {
      // Fetch all matching rows for CSV export
      const payments = await prisma.payment.findMany({
        where,
        include: {
          student: { select: { name: true, studentCode: true } },
          receivedBy: { select: { name: true } },
          reversal: true,
        },
        orderBy: { receivedAt: 'desc' },
      });

      let csv = '\uFEFF'; // UTF-8 BOM
      csv += 'Receipt Number,Date,Student Name,Student Code,Amount,Method,Reference,Received By,Status\n';

      for (const p of payments) {
        const row = [
          FeeLedgerService.sanitizeForCsv(p.receiptNumber),
          FeeLedgerService.sanitizeForCsv(p.receivedAt.toISOString().slice(0, 10)),
          FeeLedgerService.sanitizeForCsv(p.student.name),
          FeeLedgerService.sanitizeForCsv(p.student.studentCode || ''),
          FeeLedgerService.sanitizeForCsv(formatMoney(p.amount)),
          FeeLedgerService.sanitizeForCsv(p.method),
          FeeLedgerService.sanitizeForCsv(p.reference || ''),
          FeeLedgerService.sanitizeForCsv(p.receivedBy.name),
          FeeLedgerService.sanitizeForCsv(p.reversal ? 'REVERSED' : 'ACTIVE'),
        ];
        csv += row.map((c) => `"${c.replace(/"/g, '""')}"`).join(',') + '\n';
      }

      await createAuditLog({
        actorId: req.user.userId,
        action: 'PAYMENTS_CSV_EXPORT',
        entityType: 'Payment',
        branchId,
        metadata: { rowCount: payments.length },
        ip: req.ip,
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="payments.csv"');
      return res.status(200).send(csv);
    }

    const skip = (page - 1) * limit;
    const [total, payments] = await Promise.all([
      prisma.payment.count({ where }),
      prisma.payment.findMany({
        where,
        skip,
        take: limit,
        include: {
          student: { select: { id: true, name: true, studentCode: true } },
          receivedBy: { select: { id: true, name: true } },
          reversal: true,
          allocations: {
            include: {
              charge: { select: { id: true, description: true, period: true } },
            },
          },
        },
        orderBy: { receivedAt: 'desc' },
      }),
    ]);

    const data = payments.map((p) => ({
      id: p.id,
      receiptNumber: p.receiptNumber,
      receivedAt: p.receivedAt.toISOString(),
      amount: formatMoney(p.amount),
      method: p.method,
      reference: p.reference || null,
      note: p.note || null,
      receivedByName: p.receivedBy.name,
      receivedBy: {
        id: p.receivedBy.id,
        name: p.receivedBy.name,
      },
      studentId: p.studentId,
      studentName: p.student.name,
      studentCode: p.student.studentCode,
      student: {
        id: p.student.id,
        name: p.student.name,
        studentCode: p.student.studentCode,
      },
      isReversed: !!p.reversal,
      reversalReason: p.reversal?.reason || null,
      reversal: p.reversal
        ? {
            reason: p.reversal.reason,
            reversedAt: p.reversal.reversedAt.toISOString(),
          }
        : null,
      allocations: p.allocations.map((a) => ({
        chargeId: a.chargeId,
        chargeDescription: a.charge.description,
        amount: formatMoney(a.amount),
      })),
    }));

    return res.status(200).json({
      success: true,
      data: {
        items: data,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    console.error('getPayments error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

/**
 * POST /api/fees/charges
 * Creates a manual one-time FeeCharge and auto-applies available credit.
 */
export async function createManualCharge(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    if (
      req.user.role !== Role.ADMIN &&
      req.user.role !== Role.SUPER_ADMIN &&
      req.user.role !== Role.ACCOUNTANT
    ) {
      return res.status(403).json({ success: false, message: 'Forbidden: Access denied' });
    }

    const parseResult = createChargeSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { studentId, batchId, amount, dueDate, description, kind, period } = parseResult.data;
    const chargeAmount = roundMoney(amount);

    const student = await prisma.user.findUnique({
      where: { id: studentId },
      select: { branchId: true },
    });
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    if (req.user.role !== Role.SUPER_ADMIN && student.branchId !== req.user.branchId) {
      return res.status(403).json({ success: false, message: 'Forbidden: Student belongs to another branch' });
    }

    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      select: { branchId: true },
    });
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Batch not found' });
    }

    const enrollment = await prisma.enrollment.findUnique({
      where: { studentId_batchId: { studentId, batchId } },
      select: { id: true },
    });

    const settings = await getCenterSettings();

    const createdCharge = await runTimedTransaction('fee.createManualCharge', async (tx) => {
      const ch = await tx.feeCharge.create({
        data: {
          branchId: student.branchId,
          studentId,
          batchId,
          enrollmentId: enrollment?.id || null,
          kind,
          period: period || null,
          description,
          amount: chargeAmount,
          dueDate: new Date(dueDate),
          source: 'MANUAL',
          status: 'ACTIVE',
          createdById: req.user!.userId,
        },
      });

      return ch;
    });

    // Audit log
    await createAuditLog({
      actorId: req.user.userId,
      action: 'CHARGE_CREATE',
      entityType: 'FeeCharge',
      entityId: createdCharge.id,
      branchId: student.branchId,
      metadata: {
        chargeId: createdCharge.id,
        amount: formatMoney(createdCharge.amount),
        kind: createdCharge.kind,
        studentId,
      },
      ip: req.ip,
    });

    const chargePayload = {
      id: createdCharge.id,
      amount: formatMoney(createdCharge.amount),
      description: createdCharge.description,
      dueDate: createdCharge.dueDate.toISOString().slice(0, 10),
      kind: createdCharge.kind,
      period: createdCharge.period,
      status: createdCharge.status,
    };

    return res.status(201).json({
      success: true,
      message: 'Charge created successfully',
      data: {
        ...chargePayload,
        charge: chargePayload,
      },
    });
  } catch (err: any) {
    console.error('createManualCharge error:', err);
    return res.status(400).json({ success: false, message: err.message || 'Failed to create charge' });
  }
}

/**
 * POST /api/fees/charges/:id/void
 * Voids a charge with reason (ADMIN and SUPER_ADMIN only).
 * Rejects if paid amount > 0.
 */
export async function voidCharge(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    if (req.user.role !== Role.ADMIN && req.user.role !== Role.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Forbidden: Only administrators can void charges' });
    }

    const id = req.params.id as string;
    const parseResult = voidChargeSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { reason } = parseResult.data;

    const charge = await prisma.feeCharge.findUnique({
      where: { id },
      include: {
        allocations: {
          include: { payment: { select: { reversal: true } } },
        },
      },
    });

    if (!charge) {
      return res.status(404).json({ success: false, message: 'Charge not found' });
    }

    if (req.user.role === Role.ADMIN && charge.branchId !== req.user.branchId) {
      return res.status(403).json({ success: false, message: 'Forbidden: Cross-branch access denied' });
    }

    if (charge.status === 'VOID') {
      return res.status(409).json({ success: false, message: 'Charge is already voided' });
    }

    // Check if paid amount is 0
    let paidAmount = new Prisma.Decimal(0);
    for (const alloc of charge.allocations) {
      if (!alloc.payment?.reversal) {
        paidAmount = paidAmount.add(alloc.amount);
      }
    }

    if (paidAmount.gt(0)) {
      return res.status(400).json({
        success: false,
        message: `Cannot void charge with active payments. Reverse payments first. (Paid: ৳${paidAmount.toFixed(2)})`,
      });
    }

    const updated = await prisma.feeCharge.update({
      where: { id },
      data: {
        status: 'VOID',
        voidReason: reason,
        voidedAt: new Date(),
        voidedById: req.user.userId,
      },
    });

    // Audit log
    await createAuditLog({
      actorId: req.user.userId,
      action: 'CHARGE_VOID',
      entityType: 'FeeCharge',
      entityId: charge.id,
      branchId: charge.branchId,
      metadata: {
        chargeId: charge.id,
        amount: formatMoney(charge.amount),
        reason,
      },
      ip: req.ip,
    });

    return res.status(200).json({
      success: true,
      message: 'Charge voided successfully',
      data: {
        id: updated.id,
        status: updated.status,
        voidReason: updated.voidReason,
        voidedAt: updated.voidedAt?.toISOString(),
      },
    });
  } catch (err) {
    console.error('voidCharge error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

/**
 * POST /api/fees/charges/installments
 * Exact split of installment plan with remainder on the last installment.
 */
export async function createInstallments(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    if (
      req.user.role !== Role.ADMIN &&
      req.user.role !== Role.SUPER_ADMIN &&
      req.user.role !== Role.ACCOUNTANT
    ) {
      return res.status(403).json({ success: false, message: 'Forbidden: Access denied' });
    }

    const parseResult = createInstallmentsSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { studentId, batchId, total, count, firstDueDate, intervalMonths, description } = parseResult.data;
    const totalAmount = roundMoney(total);

    const student = await prisma.user.findUnique({
      where: { id: studentId },
      select: { branchId: true },
    });
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    if (req.user.role !== Role.SUPER_ADMIN && student.branchId !== req.user.branchId) {
      return res.status(403).json({ success: false, message: 'Forbidden: Student belongs to another branch' });
    }

    const batch = await prisma.batch.findUnique({ where: { id: batchId } });
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Batch not found' });
    }

    const enrollment = await prisma.enrollment.findUnique({
      where: { studentId_batchId: { studentId, batchId } },
      select: { id: true },
    });

    const splitAmounts = FeeLedgerService.splitInstallments(totalAmount, count);
    const settings = await getCenterSettings();
    const baseDate = new Date(firstDueDate);

    const studentCredit = await FeeLedgerService.getStudentCredit(studentId);

    const createdCharges = await runTimedTransaction(
      'fee.createInstallments',
      async (tx) => {
        const installmentRows = Array.from({ length: count }, (_, i) => {
          const dueDate = new Date(baseDate);
          dueDate.setMonth(baseDate.getMonth() + i * intervalMonths);
          return {
            branchId: student.branchId,
            studentId,
            batchId,
            enrollmentId: enrollment?.id || null,
            kind: 'TUITION' as const,
            period: null,
            description: description
              ? `${description} (${i + 1}/${count})`
              : `Installment ${i + 1} of ${count} - ${batch.name}`,
            amount: splitAmounts[i],
            dueDate,
            source: 'INSTALLMENT' as const,
            status: 'ACTIVE' as const,
            createdById: req.user!.userId,
          };
        });

        const inserted = await tx.feeCharge.createManyAndReturn({
          data: installmentRows,
        });

        // Apply credit only if student has available credit
        if (studentCredit.gt(0)) {
          for (const ch of inserted) {
            await FeeLedgerService.applyAvailableCreditToCharge(studentId, ch.id, tx, settings.timezone);
          }
        }
        return inserted;
      },
      { timeout: 15000, maxWait: 10000 }
    );

    // Audit log
    await createAuditLog({
      actorId: req.user.userId,
      action: 'INSTALLMENTS_CREATE',
      entityType: 'FeeCharge',
      branchId: student.branchId,
      metadata: {
        total: formatMoney(totalAmount),
        count,
        studentId,
        batchId,
      },
      ip: req.ip,
    });

    return res.status(201).json({
      success: true,
      message: 'Installments created successfully',
      data: createdCharges.map((c, i) => ({
        id: c.id,
        installment: i + 1,
        amount: formatMoney(c.amount),
        dueDate: c.dueDate.toISOString().slice(0, 10),
      })),
    });
  } catch (err: any) {
    console.error('createInstallments error:', err);
    return res.status(400).json({ success: false, message: err.message || 'Failed to create installments' });
  }
}

/**
 * POST /api/fees/charges/generate
 * Generates monthly tuition dues for active enrollments.
 * Idempotent via unique partial index.
 */
export async function generateDues(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    if (
      req.user.role !== Role.ADMIN &&
      req.user.role !== Role.SUPER_ADMIN &&
      req.user.role !== Role.ACCOUNTANT
    ) {
      return res.status(403).json({ success: false, message: 'Forbidden: Access denied' });
    }

    const parseResult = generateDuesSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { month, batchId, dryRun } = parseResult.data;
    const branchId = resolveBranchScope(req);
    const settings = await getCenterSettings();

    // Verify batchId belongs to branch if explicitly specified
    if (batchId) {
      const targetBatch = await prisma.batch.findUnique({
        where: { id: batchId },
        select: { branchId: true },
      });
      if (!targetBatch) {
        return res.status(404).json({ success: false, message: 'Batch not found' });
      }
      if (branchId && targetBatch.branchId !== branchId) {
        return res.status(403).json({ success: false, message: 'Forbidden: Batch belongs to another branch' });
      }
    }

    // Due date = centerSettings.feeDueDay of the given month in center timezone
    const [yearStr, monthStr] = month.split('-');
    const dueYear = parseInt(yearStr, 10);
    const dueMonth = parseInt(monthStr, 10);
    const dueDate = new Date(Date.UTC(dueYear, dueMonth - 1, settings.feeDueDay));

    // Find active enrollments in scope where batch.feeBilling is MONTHLY
    const enrollments = await prisma.enrollment.findMany({
      where: {
        status: 'ACTIVE',
        batch: {
          feeBilling: 'MONTHLY',
          ...(branchId ? { branchId } : {}),
          ...(batchId ? { id: batchId } : {}),
        },
      },
      include: {
        batch: true,
        student: { select: { id: true, name: true, branchId: true } },
      },
    });

    const created: any[] = [];
    const skipped: any[] = [];

    // Pre-check existing tuition charges in ONE batch query
    const enrollmentIds = enrollments.map((e) => e.id);
    const existingCharges = await prisma.feeCharge.findMany({
      where: {
        enrollmentId: { in: enrollmentIds },
        kind: 'TUITION',
        period: month,
        status: 'ACTIVE',
      },
      select: { enrollmentId: true },
    });
    const existingSet = new Set(existingCharges.map((c) => c.enrollmentId));

    const toCreate: Array<{
      enr: (typeof enrollments)[0];
      baseFee: Prisma.Decimal;
      discountAmount: Prisma.Decimal;
      effectiveFee: Prisma.Decimal;
    }> = [];

    for (const enr of enrollments) {
      // Base fee
      const baseFee = enr.customFeeAmount !== null ? roundMoney(enr.customFeeAmount) : roundMoney(enr.batch.feeAmount);

      // Check discount
      let discountAmount = new Prisma.Decimal(0);
      if (enr.discountType === 'FIXED' && enr.discountValue) {
        discountAmount = roundMoney(enr.discountValue);
      } else if (enr.discountType === 'PERCENTAGE' && enr.discountValue) {
        discountAmount = roundMoney(baseFee.mul(enr.discountValue).div(100));
      }

      const effectiveFee = roundMoney(baseFee.sub(discountAmount));
      if (effectiveFee.lte(0)) {
        skipped.push({
          enrollmentId: enr.id,
          studentId: enr.student.id,
          studentName: enr.student.name,
          batchId: enr.batch.id,
          reason: 'Effective fee is zero or fully waived',
        });
        continue;
      }

      // Check if tuition charge already exists
      if (existingSet.has(enr.id)) {
        skipped.push({
          enrollmentId: enr.id,
          studentId: enr.student.id,
          studentName: enr.student.name,
          batchId: enr.batch.id,
          reason: 'Tuition charge already exists for this period',
        });
        continue;
      }

      if (dryRun) {
        created.push({
          enrollmentId: enr.id,
          studentId: enr.student.id,
          studentName: enr.student.name,
          batchId: enr.batch.id,
          amount: formatMoney(baseFee),
          discount: formatMoney(discountAmount),
          netAmount: formatMoney(effectiveFee),
        });
      } else {
        toCreate.push({ enr, baseFee, discountAmount, effectiveFee });
      }
    }

    if (!dryRun && toCreate.length > 0) {
      // Pre-check student credits in a single query before entering the transaction
      const studentIds = Array.from(new Set(toCreate.map((i) => i.enr.student.id)));
      const paymentsWithCredit = await prisma.payment.findMany({
        where: {
          studentId: { in: studentIds },
          reversal: null,
        },
        select: {
          studentId: true,
          amount: true,
          allocations: { select: { amount: true } },
        },
      });

      const studentsWithCredit = new Set<string>();
      for (const p of paymentsWithCredit) {
        let rem = p.amount;
        for (const a of p.allocations) {
          rem = rem.sub(a.amount);
        }
        if (rem.gt(0)) {
          studentsWithCredit.add(p.studentId);
        }
      }

      await runTimedTransaction('fee.generateDues', async (tx) => {
        const chargeRows = toCreate.map(({ enr, baseFee }) => ({
          branchId: enr.batch.branchId,
          studentId: enr.student.id,
          batchId: enr.batch.id,
          enrollmentId: enr.id,
          kind: 'TUITION' as const,
          period: month,
          description: `Monthly Tuition Fee - ${month}`,
          amount: baseFee,
          dueDate,
          source: 'GENERATED' as const,
          status: 'ACTIVE' as const,
          createdById: req.user!.userId,
        }));

        const insertedCharges = await tx.feeCharge.createManyAndReturn({
          data: chargeRows,
        });

        const chargeByEnrollment = new Map(insertedCharges.map((c) => [c.enrollmentId, c]));
        const discountAdjustments: any[] = [];

        for (const item of toCreate) {
          const ch = chargeByEnrollment.get(item.enr.id);
          if (!ch) continue;

          if (item.discountAmount.gt(0)) {
            discountAdjustments.push({
              branchId: item.enr.batch.branchId,
              chargeId: ch.id,
              type: 'DISCOUNT' as const,
              amount: item.discountAmount,
              reason: 'Enrollment discount',
              status: 'ACTIVE' as const,
              createdById: req.user!.userId,
            });
          }

          created.push({
            chargeId: ch.id,
            studentId: item.enr.student.id,
            studentName: item.enr.student.name,
            amount: formatMoney(item.baseFee),
            effectiveAmount: formatMoney(item.effectiveFee),
          });
        }

        if (discountAdjustments.length > 0) {
          await tx.feeAdjustment.createMany({
            data: discountAdjustments,
          });
        }

        // Apply available credits only if any of the students have positive credit
        if (studentsWithCredit.size > 0) {
          for (const item of toCreate) {
            if (studentsWithCredit.has(item.enr.student.id)) {
              const ch = chargeByEnrollment.get(item.enr.id);
              if (ch) {
                await FeeLedgerService.applyAvailableCreditToCharge(item.enr.student.id, ch.id, tx, settings.timezone);
              }
            }
          }
        }
      },
      { timeout: 15000, maxWait: 10000 }
      );
    }

    if (!dryRun) {
      await createAuditLog({
        actorId: req.user.userId,
        action: 'DUES_GENERATE',
        entityType: 'FeeCharge',
        branchId,
        metadata: {
          month,
          batchId,
          createdCount: created.length,
          skippedCount: skipped.length,
        },
        ip: req.ip,
      });
    }

    return res.status(200).json({
      success: true,
      message: dryRun
        ? `Dry run completed. ${created.length} would be created, ${skipped.length} skipped.`
        : `Dues generation completed. ${created.length} created, ${skipped.length} skipped.`,
      data: {
        dryRun: !!dryRun,
        month,
        createdCount: created.length,
        skippedCount: skipped.length,
        created,
        skipped,
      },
    });
  } catch (err: any) {
    console.error('generateDues error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

/**
 * POST /api/fees/adjustments
 * Creates DISCOUNT, WAIVER, or CORRECTION adjustment (ADMIN and SUPER_ADMIN only).
 */
export async function createAdjustment(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    if (req.user.role !== Role.ADMIN && req.user.role !== Role.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Forbidden: Only administrators can adjust fees' });
    }

    const parseResult = createAdjustmentSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { chargeId, type, amount, reason } = parseResult.data;
    const adjAmount = roundMoney(amount);

    const charge = await prisma.feeCharge.findUnique({
      where: { id: chargeId },
      include: {
        adjustments: true,
      },
    });

    if (!charge || charge.status === 'VOID') {
      return res.status(404).json({ success: false, message: 'Active charge not found' });
    }

    if (req.user.role === Role.ADMIN && charge.branchId !== req.user.branchId) {
      return res.status(403).json({ success: false, message: 'Forbidden: Cross-branch access denied' });
    }

    const existingAdjustments = charge.adjustments
      .filter((a) => a.status === 'ACTIVE')
      .reduce((sum, a) => sum.add(a.amount), new Prisma.Decimal(0));

    if (existingAdjustments.add(adjAmount).gt(charge.amount)) {
      return res.status(400).json({
        success: false,
        message: `Total adjustments cannot exceed original charge amount (${formatMoney(charge.amount)})`,
      });
    }

    const adjustment = await prisma.feeAdjustment.create({
      data: {
        branchId: charge.branchId,
        chargeId: charge.id,
        type,
        amount: adjAmount,
        reason,
        status: 'ACTIVE',
        createdById: req.user.userId,
      },
    });

    // Audit log
    await createAuditLog({
      actorId: req.user.userId,
      action: 'ADJUSTMENT_CREATE',
      entityType: 'FeeAdjustment',
      entityId: adjustment.id,
      branchId: charge.branchId,
      metadata: {
        adjustmentId: adjustment.id,
        chargeId: charge.id,
        type,
        amount: formatMoney(adjAmount),
        reason,
      },
      ip: req.ip,
    });

    return res.status(201).json({
      success: true,
      message: 'Adjustment created successfully',
      data: {
        id: adjustment.id,
        chargeId: adjustment.chargeId,
        type: adjustment.type,
        amount: formatMoney(adjustment.amount),
        reason: adjustment.reason,
      },
    });
  } catch (err) {
    console.error('createAdjustment error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

/**
 * POST /api/fees/adjustments/:id/void
 * Voids an adjustment with reason (ADMIN and SUPER_ADMIN only).
 */
export async function voidAdjustment(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    if (req.user.role !== Role.ADMIN && req.user.role !== Role.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Forbidden: Only administrators can void adjustments' });
    }

    const id = req.params.id as string;
    const parseResult = voidAdjustmentSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { reason } = parseResult.data;

    const adjustment = await prisma.feeAdjustment.findUnique({
      where: { id },
    });

    if (!adjustment) {
      return res.status(404).json({ success: false, message: 'Adjustment not found' });
    }

    if (req.user.role === Role.ADMIN && adjustment.branchId !== req.user.branchId) {
      return res.status(403).json({ success: false, message: 'Forbidden: Cross-branch access denied' });
    }

    if (adjustment.status === 'VOID') {
      return res.status(409).json({ success: false, message: 'Adjustment is already voided' });
    }

    const updated = await prisma.feeAdjustment.update({
      where: { id },
      data: {
        status: 'VOID',
        voidReason: reason,
        voidedAt: new Date(),
        voidedById: req.user.userId,
      },
    });

    // Audit log
    await createAuditLog({
      actorId: req.user.userId,
      action: 'ADJUSTMENT_VOID',
      entityType: 'FeeAdjustment',
      entityId: adjustment.id,
      branchId: adjustment.branchId,
      metadata: {
        adjustmentId: adjustment.id,
        chargeId: adjustment.chargeId,
        amount: formatMoney(adjustment.amount),
        reason,
      },
      ip: req.ip,
    });

    return res.status(200).json({
      success: true,
      message: 'Adjustment voided successfully',
      data: {
        id: updated.id,
        status: updated.status,
        voidReason: updated.voidReason,
      },
    });
  } catch (err) {
    console.error('voidAdjustment error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

/**
 * GET /api/fees/dues
 * Lists per-student outstanding dues with filters, summary totals, and CSV export.
 */
export async function getDues(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    if (
      req.user.role !== Role.ADMIN &&
      req.user.role !== Role.SUPER_ADMIN &&
      req.user.role !== Role.ACCOUNTANT
    ) {
      return res.status(403).json({ success: false, message: 'Forbidden: Access denied' });
    }

    const parseResult = duesQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        data: parseResult.error.flatten(),
      });
    }

    const { page, limit, month, batchId, status, format } = parseResult.data;
    const branchId = resolveBranchScope(req);
    const settings = await getCenterSettings();
    const todayStr = FeeLedgerService.getTodayInTimezone(settings.timezone);

    // Fetch active charges
    const charges = await prisma.feeCharge.findMany({
      where: {
        status: 'ACTIVE',
        ...(branchId ? { branchId } : {}),
        ...(batchId ? { batchId } : {}),
        ...(month ? { period: month } : {}),
      },
      include: {
        student: { select: { id: true, name: true, studentCode: true, phone: true } },
        batch: { select: { id: true, name: true } },
        adjustments: true,
        allocations: {
          include: { payment: { select: { reversal: true } } },
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    // Group charges by student
    const studentDuesMap = new Map<
      string,
      {
        studentId: string;
        name: string;
        studentCode: string;
        phone: string;
        totalDue: Prisma.Decimal;
        totalPaid: Prisma.Decimal;
        outstanding: Prisma.Decimal;
        statusSet: Set<string>;
      }
    >();

    let grandTotalDue = new Prisma.Decimal(0);
    let grandTotalPaid = new Prisma.Decimal(0);
    let grandTotalOutstanding = new Prisma.Decimal(0);

    for (const ch of charges) {
      const bal = FeeLedgerService.deriveChargeStatus(ch, todayStr);

      if (bal.balance.gt(0)) {
        grandTotalDue = grandTotalDue.add(bal.effectiveAmount);
        grandTotalPaid = grandTotalPaid.add(bal.paidAmount);
        grandTotalOutstanding = grandTotalOutstanding.add(bal.balance);

        const cur = studentDuesMap.get(ch.studentId) || {
          studentId: ch.studentId,
          name: ch.student.name,
          studentCode: ch.student.studentCode || '',
          phone: ch.student.phone || '',
          totalDue: new Prisma.Decimal(0),
          totalPaid: new Prisma.Decimal(0),
          outstanding: new Prisma.Decimal(0),
          statusSet: new Set<string>(),
        };

        cur.totalDue = cur.totalDue.add(bal.effectiveAmount);
        cur.totalPaid = cur.totalPaid.add(bal.paidAmount);
        cur.outstanding = cur.outstanding.add(bal.balance);
        cur.statusSet.add(bal.status);

        studentDuesMap.set(ch.studentId, cur);
      }
    }

    let rows = Array.from(studentDuesMap.values());

    // Status filter
    if (status && status !== 'ALL') {
      rows = rows.filter((r) => r.statusSet.has(status));
    }

    if (format === 'csv') {
      let csv = '\uFEFF';
      csv += 'Student Name,Student Code,Phone,Total Due,Total Paid,Outstanding Dues,Status\n';

      for (const r of rows) {
        const row = [
          FeeLedgerService.sanitizeForCsv(r.name),
          FeeLedgerService.sanitizeForCsv(r.studentCode),
          FeeLedgerService.sanitizeForCsv(r.phone),
          FeeLedgerService.sanitizeForCsv(formatMoney(r.totalDue)),
          FeeLedgerService.sanitizeForCsv(formatMoney(r.totalPaid)),
          FeeLedgerService.sanitizeForCsv(formatMoney(r.outstanding)),
          FeeLedgerService.sanitizeForCsv(Array.from(r.statusSet).join(' / ')),
        ];
        csv += row.map((c) => `"${c.replace(/"/g, '""')}"`).join(',') + '\n';
      }

      await createAuditLog({
        actorId: req.user.userId,
        action: 'DUES_CSV_EXPORT',
        entityType: 'FeeCharge',
        branchId,
        metadata: { rowCount: rows.length },
        ip: req.ip,
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="dues.csv"');
      return res.status(200).send(csv);
    }

    const total = rows.length;
    const startIndex = (page - 1) * limit;
    const paginatedRows = rows.slice(startIndex, startIndex + limit);

    return res.status(200).json({
      success: true,
      data: {
        summary: {
          totalDue: formatMoney(grandTotalDue),
          totalPaid: formatMoney(grandTotalPaid),
          totalOutstanding: formatMoney(grandTotalOutstanding),
          totalStudentsWithDues: total,
        },
        items: paginatedRows.map((r) => ({
          studentId: r.studentId,
          name: r.name,
          studentCode: r.studentCode,
          phone: r.phone,
          totalDue: formatMoney(r.totalDue),
          totalPaid: formatMoney(r.totalPaid),
          outstanding: formatMoney(r.outstanding),
          status: Array.from(r.statusSet).join(', '),
        })),
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    console.error('getDues error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

/**
 * GET /api/fees/reports/collection
 * Collection report grouped by day | method | batch | receiver.
 */
export async function getCollectionReport(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    if (
      req.user.role !== Role.ADMIN &&
      req.user.role !== Role.SUPER_ADMIN &&
      req.user.role !== Role.ACCOUNTANT
    ) {
      return res.status(403).json({ success: false, message: 'Forbidden: Access denied' });
    }

    const parseResult = collectionReportQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        data: parseResult.error.flatten(),
      });
    }

    const { from, to, groupBy, batchId } = parseResult.data;
    const branchId = resolveBranchScope(req);
    const settings = await getCenterSettings();

    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T23:59:59.999Z`);

    const payments = await prisma.payment.findMany({
      where: {
        ...(branchId ? { branchId } : {}),
        receivedAt: { gte: fromDate, lte: toDate },
        ...(batchId ? { allocations: { some: { charge: { batchId } } } } : {}),
      },
      include: {
        reversal: true,
        receivedBy: { select: { id: true, name: true } },
        allocations: {
          include: {
            charge: { select: { batch: { select: { id: true, name: true } } } },
          },
        },
      },
      orderBy: { receivedAt: 'asc' },
    });

    const groupsMap = new Map<string, { key: string; label: string; total: Prisma.Decimal; count: number }>();
    let totalCollected = new Prisma.Decimal(0);
    let totalReversed = new Prisma.Decimal(0);
    const reversedList: any[] = [];

    for (const p of payments) {
      if (p.reversal) {
        totalReversed = totalReversed.add(p.amount);
        reversedList.push({
          paymentId: p.id,
          receiptNumber: p.receiptNumber,
          amount: formatMoney(p.amount),
          reversedAt: p.reversal.reversedAt.toISOString(),
          reason: p.reversal.reason,
        });
        continue;
      }

      totalCollected = totalCollected.add(p.amount);

      let groupKey = '';
      let groupLabel = '';

      if (groupBy === 'day') {
        groupKey = p.receivedAt.toISOString().slice(0, 10);
        groupLabel = groupKey;
      } else if (groupBy === 'method') {
        groupKey = p.method;
        groupLabel = p.method;
      } else if (groupBy === 'receiver') {
        groupKey = p.receivedById;
        groupLabel = p.receivedBy.name;
      } else if (groupBy === 'batch') {
        const batchName = p.allocations[0]?.charge?.batch?.name || 'Unassigned / Credit';
        groupKey = batchName;
        groupLabel = batchName;
      }

      const cur = groupsMap.get(groupKey) || {
        key: groupKey,
        label: groupLabel,
        total: new Prisma.Decimal(0),
        count: 0,
      };

      cur.total = cur.total.add(p.amount);
      cur.count += 1;
      groupsMap.set(groupKey, cur);
    }

    const groups = Array.from(groupsMap.values()).map((g) => ({
      key: g.key,
      label: g.label,
      total: formatMoney(g.total),
      count: g.count,
    }));

    return res.status(200).json({
      success: true,
      data: {
        from,
        to,
        groupBy,
        summary: {
          totalCollected: formatMoney(totalCollected),
          totalReversed: formatMoney(totalReversed),
          netCollection: formatMoney(totalCollected),
          activePaymentsCount: payments.length - reversedList.length,
          reversedPaymentsCount: reversedList.length,
        },
        groups,
        reversedPayments: reversedList,
      },
    });
  } catch (err) {
    console.error('getCollectionReport error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}
