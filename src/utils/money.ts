import { Prisma } from '@prisma/client';

/**
 * Display-only helper for non-ledger endpoints that expect number types.
 * WARNING: Never convert Prisma.Decimal to number for arithmetic!
 */
export function moneyToNumber(val: Prisma.Decimal | number | string | null | undefined): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  if (val instanceof Prisma.Decimal) return val.toNumber();
  const parsed = Number(val);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Formats a Decimal or number as an exact 2-decimal string ("3500.00").
 */
export function formatMoney(val: Prisma.Decimal | number | string | null | undefined): string {
  if (val === null || val === undefined) return '0.00';
  if (val instanceof Prisma.Decimal) return val.toFixed(2);
  const dec = new Prisma.Decimal(val);
  return dec.toFixed(2);
}

/**
 * Ensures a value is rounded to 2 decimal places using ROUND_HALF_UP.
 */
export function roundMoney(val: Prisma.Decimal | number | string): Prisma.Decimal {
  const dec = val instanceof Prisma.Decimal ? val : new Prisma.Decimal(val);
  return dec.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}
