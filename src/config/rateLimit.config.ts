/**
 * Rate Limiting Configuration & Safety Guards
 *
 * Relaxed limits are strictly forbidden in production.
 * They can ONLY be enabled when NODE_ENV is explicitly NOT production
 * AND ALLOW_RELAXED_RATE_LIMIT === 'true'.
 */

export function isRelaxedRateLimitEnabled(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.ALLOW_RELAXED_RATE_LIMIT === 'true'
  );
}

export function getApiRateLimitMax(): number {
  if (isRelaxedRateLimitEnabled()) {
    return 10000;
  }
  return 300;
}

