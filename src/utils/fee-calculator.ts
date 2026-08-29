/**
 * Calculates net fee after applying optional discount (FIXED or PERCENTAGE).
 * The net fee will never be below 0.
 */
export function calculateNetFee(
  baseFee: number,
  discountType: 'FIXED' | 'PERCENTAGE' | null | undefined,
  discountValue: number | null | undefined
): number {
  if (!discountType || discountValue === null || discountValue === undefined || discountValue <= 0) {
    return Math.max(0, baseFee);
  }

  let netFee = baseFee;

  if (discountType === 'FIXED') {
    netFee = baseFee - discountValue;
  } else if (discountType === 'PERCENTAGE') {
    netFee = baseFee - baseFee * (discountValue / 100);
  }

  return Math.max(0, netFee);
}
