import prisma from '../src/utils/prisma';
import { Prisma } from '@prisma/client';

export async function reconcileFees(verbose = true) {
  // 1. Legacy sums
  const legacyAgg = await prisma.feePayment.aggregate({
    _sum: {
      amountDue: true,
      amountPaid: true,
    },
    _count: {
      _all: true,
    },
  });

  const legacyTotalDue = new Prisma.Decimal((legacyAgg._sum.amountDue || 0).toFixed(2));
  const legacyTotalPaid = new Prisma.Decimal((legacyAgg._sum.amountPaid || 0).toFixed(2));
  const legacyCount = legacyAgg._count._all;

  // 2. Ledger sums (MIGRATED source)
  const chargeAgg = await prisma.feeCharge.aggregate({
    where: { source: 'MIGRATED', status: 'ACTIVE' },
    _sum: { amount: true },
    _count: { _all: true },
  });

  // Effective payments: payments with source MIGRATED and not reversed
  const payments = await prisma.payment.findMany({
    where: {
      source: 'MIGRATED',
      reversal: null,
    },
    select: {
      id: true,
      amount: true,
      studentId: true,
    },
  });

  const ledgerTotalDue = chargeAgg._sum.amount || new Prisma.Decimal(0);
  const ledgerTotalPaid = payments.reduce((acc, p) => acc.add(p.amount), new Prisma.Decimal(0));
  const chargeCount = chargeAgg._count._all;
  const paymentCount = payments.length;

  // 3. Per-student checks
  const legacyStudentGroups = await prisma.feePayment.groupBy({
    by: ['studentId'],
    _sum: {
      amountDue: true,
      amountPaid: true,
    },
  });

  const chargeStudentGroups = await prisma.feeCharge.groupBy({
    by: ['studentId'],
    where: { source: 'MIGRATED', status: 'ACTIVE' },
    _sum: { amount: true },
  });

  const chargeMap = new Map<string, Prisma.Decimal>();
  for (const cg of chargeStudentGroups) {
    chargeMap.set(cg.studentId, cg._sum.amount || new Prisma.Decimal(0));
  }

  const paymentStudentMap = new Map<string, Prisma.Decimal>();
  for (const p of payments) {
    const cur = paymentStudentMap.get(p.studentId) || new Prisma.Decimal(0);
    paymentStudentMap.set(p.studentId, cur.add(p.amount));
  }

  let mismatchCount = 0;
  const mismatches: string[] = [];

  for (const lsg of legacyStudentGroups) {
    const sId = lsg.studentId;
    const lDue = new Prisma.Decimal((lsg._sum.amountDue || 0).toFixed(2));
    const lPaid = new Prisma.Decimal((lsg._sum.amountPaid || 0).toFixed(2));

    const cDue = chargeMap.get(sId) || new Prisma.Decimal(0);
    const pPaid = paymentStudentMap.get(sId) || new Prisma.Decimal(0);

    if (!lDue.equals(cDue) || !lPaid.equals(pPaid)) {
      mismatchCount++;
      mismatches.push(
        `Student ${sId}: Legacy Due=${lDue}, Ledger Due=${cDue} | Legacy Paid=${lPaid}, Ledger Paid=${pPaid}`
      );
    }
  }

  const dueDiff = legacyTotalDue.sub(ledgerTotalDue);
  const paidDiff = legacyTotalPaid.sub(ledgerTotalPaid);
  const isMatch = dueDiff.isZero() && paidDiff.isZero() && mismatchCount === 0;

  if (verbose) {
    console.log('=====================================================');
    console.log('           FEE LEDGER RECONCILIATION REPORT          ');
    console.log('=====================================================');
    console.log(`Legacy FeePayment Rows: ${legacyCount}`);
    console.log(`Ledger FeeCharge Rows:  ${chargeCount}`);
    console.log(`Ledger Payment Rows:    ${paymentCount}`);
    console.log('-----------------------------------------------------');
    console.log(`Total Due:  Legacy = ${legacyTotalDue.toFixed(2)} | Ledger = ${ledgerTotalDue.toFixed(2)} (Diff: ${dueDiff.toFixed(2)})`);
    console.log(`Total Paid: Legacy = ${legacyTotalPaid.toFixed(2)} | Ledger = ${ledgerTotalPaid.toFixed(2)} (Diff: ${paidDiff.toFixed(2)})`);
    console.log('-----------------------------------------------------');
    console.log(`Unique Students Checked: ${legacyStudentGroups.length}`);
    console.log(`Student Mismatches:      ${mismatchCount}`);
    if (mismatchCount > 0) {
      console.error('MISMATCHES DETECTED:');
      for (const m of mismatches) {
        console.error('  - ' + m);
      }
    } else {
      console.log('All student balances and totals match to the cent! [PASSED]');
    }
    console.log('=====================================================');
  }

  return {
    isMatch,
    legacyTotalDue,
    ledgerTotalDue,
    legacyTotalPaid,
    ledgerTotalPaid,
    mismatchCount,
  };
}

async function main() {
  try {
    const res = await reconcileFees(true);
    await prisma.$disconnect();
    if (!res.isMatch) {
      console.error('Reconciliation FAILED: Differences detected.');
      process.exit(1);
    }
    console.log('Reconciliation SUCCESS: Exact cent-for-cent match.');
    process.exit(0);
  } catch (err) {
    console.error('Error running fee reconciliation:', err);
    await prisma.$disconnect();
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
