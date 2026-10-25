import { Request, Response, NextFunction } from 'express';

/**
 * Middleware that instructs caches (proxies, browsers, CDNs) to never store
 * responses for sensitive authentication and credential endpoints.
 */
export function noCache(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
}
