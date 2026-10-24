import crypto from 'crypto';

/**
 * Generates a high-entropy temporary password with no ambiguous characters:
 * Omits: '0', 'O', 'I', 'l', '1'
 * Guarantees inclusion of uppercase, lowercase, numbers, and special symbols.
 */
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*';
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

export function generateTemporaryPassword(length = 14): string {
  if (length < 12) length = 12;

  // Guarantee at least 2 of each class
  const chars = [
    LOWER[crypto.randomInt(0, LOWER.length)],
    LOWER[crypto.randomInt(0, LOWER.length)],
    UPPER[crypto.randomInt(0, UPPER.length)],
    UPPER[crypto.randomInt(0, UPPER.length)],
    DIGITS[crypto.randomInt(0, DIGITS.length)],
    DIGITS[crypto.randomInt(0, DIGITS.length)],
    SYMBOLS[crypto.randomInt(0, SYMBOLS.length)],
    SYMBOLS[crypto.randomInt(0, SYMBOLS.length)],
  ];

  while (chars.length < length) {
    chars.push(ALL[crypto.randomInt(0, ALL.length)]);
  }

  // Shuffle Fisher-Yates
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}
