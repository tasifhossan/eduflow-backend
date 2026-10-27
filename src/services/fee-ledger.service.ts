import prisma from '../utils/prisma';
import { Prisma, FeeCharge, FeeAdjustment, Payment, PaymentAllocation, PaymentReversal } from '@prisma/client';
import { roundMoney, formatMoney } from '../utils/money';

export type DerivedChargeStatus = 'VOID' | 'WAIVED' | 'PAID' | 'PARTIAL' | 'OVERDUE' | 'DUE';

export interface ChargeBalanceDetails {
  chargeId: string;
  originalAmount: Prisma.Decimal;
  totalAdjustments: Prisma.Decimal;
  effectiveAmount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  balance: Prisma.Decimal;
  status: DerivedChargeStatus;
}

export class FeeLedgerService {
  /**
   * Returns current local date string (YYYY-MM-DD) in center timezone.
   */
  static getTodayInTimezone(timezone: string = 'Asia/Dhaka'): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  /**
   * Returns current 2-digit year in center timezone for a given date.
   */
  static getYearInTimezone(date: Date, timezone: string = 'Asia/Dhaka'): { fullYear: number; yy: string } {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
    });
    const fullYear = parseInt(formatter.format(date), 10);
    const yy = String(fullYear).slice(-2);
    return { fullYear, yy };
  }

  /**
   * Rounds a money value to 2 decimal places.
   */
  static round(val: Prisma.Decimal | number | string): Prisma.Decimal {
    return roundMoney(val);
  }

  /**
   * Calculates derived status and balance for a charge.
   */
  static deriveChargeStatus(
    charge: {
      id: string;
      amount: Prisma.Decimal;
      status: string;
      dueDate: Date;
      adjustments?: Array<{ amount: Prisma.Decimal; status: string }>;
      allocations?: Array<{
        amount: Prisma.Decimal;
        payment?: { reversal?: { id: string } | null } | null;
      }>;
    },
    todayStr: string
  ): ChargeBalanceDetails {
    const originalAmount = roundMoney(charge.amount);

    if (charge.status === 'VOID') {
      return {
        chargeId: charge.id,
        originalAmount,
        totalAdjustments: new Prisma.Decimal(0),
        effectiveAmount: new Prisma.Decimal(0),
        paidAmount: new Prisma.Decimal(0),
        balance: new Prisma.Decimal(0),
        status: 'VOID',
      };
    }

    // Active adjustments
    let totalAdjustments = new Prisma.Decimal(0);
    if (charge.adjustments) {
      for (const adj of charge.adjustments) {
        if (adj.status === 'ACTIVE') {
          totalAdjustments = totalAdjustments.add(roundMoney(adj.amount));
        }
      }
    }
    totalAdjustments = roundMoney(totalAdjustments);

    let effectiveAmount = roundMoney(originalAmount.sub(totalAdjustments));
    if (effectiveAmount.lt(0)) {
      effectiveAmount = new Prisma.Decimal(0);
    }

    if (effectiveAmount.isZero()) {
      return {
        chargeId: charge.id,
        originalAmount,
        totalAdjustments,
        effectiveAmount,
        paidAmount: new Prisma.Decimal(0),
        balance: new Prisma.Decimal(0),
        status: 'WAIVED',
      };
    }

    // Paid amount from allocations whose payment is not reversed
    let paidAmount = new Prisma.Decimal(0);
    if (charge.allocations) {
      for (const alloc of charge.allocations) {
        if (!alloc.payment?.reversal) {
          paidAmount = paidAmount.add(roundMoney(alloc.amount));
        }
      }
    }
    paidAmount = roundMoney(paidAmount);

    let balance = roundMoney(effectiveAmount.sub(paidAmount));
    if (balance.lt(0)) {
      balance = new Prisma.Decimal(0);
    }

    let status: DerivedChargeStatus;
    if (balance.isZero()) {
      status = 'PAID';
    } else if (paidAmount.gt(0)) {
      status = 'PARTIAL';
    } else {
      const dueStr = charge.dueDate.toISOString().slice(0, 10);
      status = dueStr < todayStr ? 'OVERDUE' : 'DUE';
    }

    return {
      chargeId: charge.id,
      originalAmount,
      totalAdjustments,
      effectiveAmount,
      paidAmount,
      balance,
      status,
    };
  }

  /**
   * Computes available student credit:
   * sum(non-reversed payments) - sum(non-reversed allocations)
   */
  static async getStudentCredit(studentId: string, tx?: Prisma.TransactionClient): Promise<Prisma.Decimal> {
    const client = tx || prisma;

    const payments = await client.payment.findMany({
      where: {
        studentId,
        reversal: null,
      },
      select: {
        amount: true,
        allocations: {
          select: {
            amount: true,
          },
        },
      },
    });

    let totalPayment = new Prisma.Decimal(0);
    let totalAllocated = new Prisma.Decimal(0);

    for (const p of payments) {
      totalPayment = totalPayment.add(p.amount);
      for (const a of p.allocations) {
        totalAllocated = totalAllocated.add(a.amount);
      }
    }

    const credit = totalPayment.sub(totalAllocated);
    return credit.gt(0) ? roundMoney(credit) : new Prisma.Decimal(0);
  }

  /**
   * Generates a gap-free receipt number inside a locked transaction:
   * {branch.code}-{YY}-{6 digit sequence}
   */
  static async generateReceiptNumber(
    branchId: string,
    receivedAt: Date,
    timezone: string,
    tx: Prisma.TransactionClient
  ): Promise<string> {
    const branch = await tx.branch.findUnique({
      where: { id: branchId },
      select: { code: true },
    });
    const branchCode = branch?.code || 'BR';

    const { fullYear, yy } = this.getYearInTimezone(receivedAt, timezone);

    // Row-level lock on ReceiptSequence
    const seqRecords = await tx.$queryRaw<Array<{ id: string; lastNumber: number }>>`
      SELECT id, "lastNumber" 
      FROM "ReceiptSequence" 
      WHERE "branchId" = ${branchId} AND "year" = ${fullYear} 
      FOR UPDATE
    `;

    let nextNumber = 1;
    if (seqRecords.length > 0) {
      nextNumber = seqRecords[0].lastNumber + 1;
      await tx.receiptSequence.update({
        where: { id: seqRecords[0].id },
        data: { lastNumber: nextNumber },
      });
    } else {
      await tx.receiptSequence.create({
        data: {
          branchId,
          year: fullYear,
          lastNumber: 1,
        },
      });
    }

    const paddedSeq = String(nextNumber).padStart(6, '0');
    return `${branchCode}-${yy}-${paddedSeq}`;
  }

  /**
   * Automatically applies available student credit to a charge (oldest payments first).
   * Can be called with (chargeId) or (studentId, chargeId, tx, timezone).
   */
  static async applyAvailableCreditToCharge(
    arg1: string,
    arg2?: string,
    txClient?: Prisma.TransactionClient,
    timezone?: string
  ): Promise<Prisma.Decimal> {
    if (!arg1) {
      return new Prisma.Decimal(0);
    }

    if (!arg2) {
      const chargeId = arg1;
      return prisma.$transaction(async (tx) => {
        const ch = await tx.feeCharge.findUnique({
          where: { id: chargeId },
          select: { studentId: true },
        });
        if (!ch) return new Prisma.Decimal(0);
        return this.applyAvailableCreditToCharge(ch.studentId, chargeId, tx, 'Asia/Dhaka');
      }, { timeout: 30000, maxWait: 15000 });
    }

    const studentId = arg1;
    const chargeId = arg2;
    const tx = txClient || prisma;
    const tz = timezone || 'Asia/Dhaka';

    // Fetch charge details
    const charge = await tx.feeCharge.findUnique({
      where: { id: chargeId },
      include: {
        adjustments: true,
        allocations: {
          include: {
            payment: {
              select: { reversal: true },
            },
          },
        },
      },
    });

    if (!charge || charge.status === 'VOID') {
      return new Prisma.Decimal(0);
    }

    const todayStr = this.getTodayInTimezone(tz);
    const balanceDetails = this.deriveChargeStatus(charge, todayStr);
    let remainingChargeBalance = balanceDetails.balance;

    if (remainingChargeBalance.lte(0)) {
      return new Prisma.Decimal(0);
    }

    // Find non-reversed payments for this student with available unallocated credit
    const candidatePayments = await tx.payment.findMany({
      where: {
        studentId,
        branchId: charge.branchId,
        reversal: null,
      },
      include: {
        allocations: true,
      },
      orderBy: { receivedAt: 'asc' },
    });

    let totalCreditApplied = new Prisma.Decimal(0);

    for (const payment of candidatePayments) {
      const allocatedOnPayment = payment.allocations.reduce(
        (acc, a) => acc.add(a.amount),
        new Prisma.Decimal(0)
      );
      const unallocatedOnPayment = roundMoney(payment.amount.sub(allocatedOnPayment));

      if (unallocatedOnPayment.gt(0)) {
        const toAllocate = Prisma.Decimal.min(unallocatedOnPayment, remainingChargeBalance);

        if (toAllocate.gt(0)) {
          // Check if allocation between payment and charge already exists
          const existingAlloc = await tx.paymentAllocation.findUnique({
            where: {
              paymentId_chargeId: {
                paymentId: payment.id,
                chargeId: charge.id,
              },
            },
          });

          if (existingAlloc) {
            await tx.paymentAllocation.update({
              where: { id: existingAlloc.id },
              data: { amount: roundMoney(existingAlloc.amount.add(toAllocate)) },
            });
          } else {
            await tx.paymentAllocation.create({
              data: {
                branchId: charge.branchId,
                paymentId: payment.id,
                chargeId: charge.id,
                amount: toAllocate,
              },
            });
          }

          totalCreditApplied = totalCreditApplied.add(toAllocate);
          remainingChargeBalance = remainingChargeBalance.sub(toAllocate);

          if (remainingChargeBalance.lte(0)) {
            break;
          }
        }
      }
    }

    const res = roundMoney(totalCreditApplied);
    res.toString = () => res.toFixed(2);
    return res;
  }

  /**
   * Splits an installment total into exact Decimal amounts with rounding remainder on last installment.
   * e.g. 100.00 / 3 -> [33.33, 33.33, 33.34]
   */
  static splitInstallments(total: Prisma.Decimal, count: number): Prisma.Decimal[] {
    if (count < 2 || count > 12) {
      throw new Error('Installment count must be between 2 and 12');
    }

    const exactSplit = roundMoney(total.div(count));
    const firstPartSum = exactSplit.mul(count - 1);
    const lastAmount = roundMoney(total.sub(firstPartSum));

    const result: Prisma.Decimal[] = [];
    for (let i = 0; i < count - 1; i++) {
      result.push(exactSplit);
    }
    result.push(lastAmount);
    return result;
  }

  /**
   * Sanitizes string for CSV formulas (=, +, -, @, \t).
   */
  static sanitizeForCsv(val: any): string {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (/^[=+\-@\t]/.test(str)) {
      return `'${str}`;
    }
    return str;
  }
}
