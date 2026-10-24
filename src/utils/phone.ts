/**
 * Normalizes Bangladeshi phone numbers into canonical 11-digit format: 01XXXXXXXXX
 * Supports:
 *   - +8801XXXXXXXXX
 *   - 8801XXXXXXXXX
 *   - 01XXXXXXXXX
 *   - Numbers with internal whitespace or dashes: '01712-345 678'
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;

  let cleaned = trimmed.replace(/[\s-]/g, '');
  if (cleaned.startsWith('+880')) {
    cleaned = '0' + cleaned.slice(4);
  } else if (cleaned.startsWith('880')) {
    cleaned = '0' + cleaned.slice(3);
  }

  return cleaned;
}

export function isValidBangladeshiPhone(phone: string): boolean {
  const norm = normalizePhone(phone);
  if (!norm) return false;
  return /^01[3-9]\d{8}$/.test(norm);
}
