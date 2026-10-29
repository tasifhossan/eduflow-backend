import prisma from '../src/utils/prisma';
import { Prisma } from '@prisma/client';
import { reconcileFees } from './reconcile-fees';

async function backfill() {
  console.log('Starting fee ledger backfill...');

  const legacyPayments = await prisma.feePayment.findMany({
    include: {
      batch: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Found ${legacyPayments.length} legacy FeePayment records to process.`);

  // Load all enrollments to map enrollmentId
  const enrollments = await prisma.enrollment.findMany({
    select: { id: true, studentId: true, batchId: true },
  });
  const enrollmentMap = new Map<string, string>();
  for (const e of enrollments) {
    enrollmentMap.set(`${e.studentId}:${e.batchId}`, e.id);
  }

  let chargesCreated = 0;
  let paymentsCreated = 0;
  let allocationsCreated = 0;

  for (let idx = 0; idx < legacyPayments.length; idx++) {
    const legacy = legacyPayments[idx];

    // Check if already migrated
    const existingCharge = await prisma.feeCharge.findFirst({
      where: {
        studentId: legacy.studentId,
        batchId: legacy.batchId,
        period: legacy.period,
        source: 'MIGRATED',
      },
    });

    if (existingCharge) {
      continue;
    }

    const enrollmentId = enrollmentMap.get(`${legacy.studentId}:${legacy.batchId}`) || null;

    // Parse period YYYY-MM for fallback dueDate if null
    let dueDate: Date;
    if (legacy.dueDate) {
      dueDate = legacy.dueDate;
    } else {
      const parts = (legacy.period || '').split('-');
      if (parts.length === 2 && !isNaN(Number(parts[0])) && !isNaN(Number(parts[1]))) {
        dueDate = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, 10));
      } else {
        dueDate = new Date(legacy.createdAt);
      }
    }

    const chargeAmount = new Prisma.Decimal(legacy.amountDue.toFixed(2));
    const paidAmount = new Prisma.Decimal(legacy.amountPaid.toFixed(2));

    await prisma.$transaction(async (tx) => {
      // 1. Create FeeCharge
      const charge = await tx.feeCharge.create({
        data: {
          branchId: legacy.batch.branchId,
          studentId: legacy.studentId,
          batchId: legacy.batchId,
          enrollmentId,
          kind: 'TUITION',
          period: legacy.period,
          description: `Tuition fee for ${legacy.period}`,
          amount: chargeAmount,
          dueDate,
          source: 'MIGRATED',
          status: 'ACTIVE',
          createdById: legacy.recordedById,
          createdAt: legacy.createdAt,
        },
      });
      chargesCreated++;

      // 2. If amountPaid > 0, create Payment and PaymentAllocation
      if (paidAmount.gt(0)) {
        const receiptSuffix = String(idx + 1).padStart(5, '0');
        const receiptNumber = `MIG-${receiptSuffix}-${legacy.id.slice(-4).toUpperCase()}`;

        const payment = await tx.payment.create({
          data: {
            branchId: legacy.batch.branchId,
            studentId: legacy.studentId,
            receiptNumber,
            receivedAt: legacy.paidAt || legacy.createdAt,
            amount: paidAmount,
            method: 'OTHER',
            reference: 'Legacy fee migration',
            note: legacy.notes || null,
            receivedById: legacy.recordedById,
            source: 'MIGRATED',
            createdAt: legacy.createdAt,
          },
        });
        paymentsCreated++;

        // Allocation: capped to charge amount, any excess is unallocated (student credit)
        const allocatedAmount = Prisma.Decimal.min(paidAmount, chargeAmount);

        await tx.paymentAllocation.create({
          data: {
            branchId: legacy.batch.branchId,
            paymentId: payment.id,
            chargeId: charge.id,
            amount: allocatedAmount,
            createdAt: payment.createdAt,
          },
        });
        allocationsCreated++;
      }
    }, { timeout: 30000, maxWait: 15000 });
  }

  console.log(`Backfill finished:`);
  console.log(`- FeeCharges created:     ${chargesCreated}`);
  console.log(`- Payments created:       ${paymentsCreated}`);
  console.log(`- Allocations created:    ${allocationsCreated}`);

  // Run reconciliation check
  console.log('\nRunning immediate reconciliation...');
  const rec = await reconcileFees(true);
  if (!rec.isMatch) {
    throw new Error('Backfill reconciliation failed: ledger does not match legacy data!');
  }
}

backfill()
  .then(async () => {
    console.log('Backfill process completed successfully.');
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Backfill error:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
