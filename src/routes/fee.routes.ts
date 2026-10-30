import { Router, Request, Response } from 'express';
import { Role } from '@prisma/client';
import rateLimit from 'express-rate-limit';
import { authenticate, authorize } from '../middleware/auth.middleware';
import {
  updateBatchFee,
  setStudentFee,
  getStudentNetFee,
} from '../controllers/fee.controller';
import {
  searchStudents,
  getStudentAccount,
  getMyAccount,
  getGuardianStudentAccount,
  recordPayment,
  reversePayment,
  getReceipt,
  getPayments,
  createManualCharge,
  voidCharge,
  createInstallments,
  generateDues,
  createAdjustment,
  voidAdjustment,
  getDues,
  getCollectionReport,
} from '../controllers/fee-ledger.controller';

const router = Router();

// Rate limiter for recording payments: 60 per minute per user
const paymentRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.user?.userId || 'anonymous',
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      message: 'Too many payment requests, please try again in a minute.',
    });
  },
});

// ============================================================================
// 1. LEGACY ENDPOINTS (Read-only preserved for M2, Write endpoints 410 Gone)
// ============================================================================

// Legacy Write Endpoints -> 410 Gone
router.post('/payments', authenticate, (_req: Request, res: Response) => {
  return res.status(410).json({
    success: false,
    message: 'Legacy endpoint deprecated. Use /api/fees/payments instead.',
  });
});

router.patch('/payments/:id', authenticate, (_req: Request, res: Response) => {
  return res.status(410).json({
    success: false,
    message: 'Legacy endpoint deprecated. Direct edits are disabled. Use /api/fees/payments/:id/reverse or /api/fees/adjustments instead.',
  });
});

router.post('/payments/installment-plan', authenticate, (_req: Request, res: Response) => {
  return res.status(410).json({
    success: false,
    message: 'Legacy endpoint deprecated. Use /api/fees/charges/installments instead.',
  });
});

// Legacy Read Endpoints -> 410 Gone
router.get('/payments/my-payments', authenticate, (_req: Request, res: Response) => {
  return res.status(410).json({
    success: false,
    message: 'Legacy endpoint deprecated. Use /api/fees/my-account instead.',
  });
});

router.get('/payments/due-summary', authenticate, (_req: Request, res: Response) => {
  return res.status(410).json({
    success: false,
    message: 'Legacy endpoint deprecated. Use /api/fees/dues instead.',
  });
});

router.get('/batches/:batchId/payments', authenticate, (_req: Request, res: Response) => {
  return res.status(410).json({
    success: false,
    message: 'Legacy endpoint deprecated. Use /api/fees/payments instead.',
  });
});

router.get('/students/:studentId/payments', authenticate, (_req: Request, res: Response) => {
  return res.status(410).json({
    success: false,
    message: 'Legacy endpoint deprecated. Use /api/fees/students/:studentId/account instead.',
  });
});

// Batch & enrollment fee config
router.patch('/batches/:id/fee', authenticate, authorize(Role.ADMIN), updateBatchFee);
router.patch('/enrollments/:id/fee', authenticate, authorize(Role.ADMIN), setStudentFee);
router.get('/enrollments/:id/net-fee', authenticate, authorize(Role.ADMIN), getStudentNetFee);

// ============================================================================
// 2. APPEND-ONLY FEE LEDGER ENDPOINTS (/api/fees/...)
// ============================================================================

// Student search (staff only: ADMIN, SUPER_ADMIN, ACCOUNTANT)
router.get(
  '/fees/students/search',
  authenticate,
  authorize(Role.ADMIN, Role.ACCOUNTANT),
  searchStudents
);

// Student accounts
router.get('/fees/my-account', authenticate, authorize(Role.STUDENT), getMyAccount);
router.get(
  '/fees/guardian/students/:studentId/account',
  authenticate,
  authorize(Role.GUARDIAN),
  getGuardianStudentAccount
);
router.get(
  '/fees/students/:studentId/account',
  authenticate,
  authorize(Role.ADMIN, Role.ACCOUNTANT),
  getStudentAccount
);

// Payments & Receipts
router.post(
  '/fees/payments',
  authenticate,
  authorize(Role.ADMIN, Role.ACCOUNTANT),
  paymentRateLimiter,
  recordPayment
);
router.post(
  '/fees/payments/:id/reverse',
  authenticate,
  authorize(Role.ADMIN), // ADMIN & SUPER_ADMIN only, ACCOUNTANT cannot reverse
  reversePayment
);
router.get(
  '/fees/payments',
  authenticate,
  authorize(Role.ADMIN, Role.ACCOUNTANT),
  getPayments
);
router.get(
  '/fees/receipts/:paymentId',
  authenticate,
  authorize(Role.ADMIN, Role.ACCOUNTANT, Role.STUDENT, Role.GUARDIAN),
  getReceipt
);

// Charges & Installments
router.post(
  '/fees/charges',
  authenticate,
  authorize(Role.ADMIN, Role.ACCOUNTANT),
  createManualCharge
);
router.post(
  '/fees/charges/:id/void',
  authenticate,
  authorize(Role.ADMIN), // ADMIN & SUPER_ADMIN only, ACCOUNTANT cannot void
  voidCharge
);
router.post(
  '/fees/charges/installments',
  authenticate,
  authorize(Role.ADMIN, Role.ACCOUNTANT),
  createInstallments
);
router.post(
  '/fees/charges/generate',
  authenticate,
  authorize(Role.ADMIN, Role.ACCOUNTANT),
  generateDues
);

// Adjustments (Discounts, Waivers, Corrections) - ADMIN & SUPER_ADMIN only
router.post(
  '/fees/adjustments',
  authenticate,
  authorize(Role.ADMIN),
  createAdjustment
);
router.post(
  '/fees/adjustments/:id/void',
  authenticate,
  authorize(Role.ADMIN),
  voidAdjustment
);

// Dues & Reports
router.get(
  '/fees/dues',
  authenticate,
  authorize(Role.ADMIN, Role.ACCOUNTANT),
  getDues
);
router.get(
  '/fees/reports/collection',
  authenticate,
  authorize(Role.ADMIN, Role.ACCOUNTANT),
  getCollectionReport
);

export default router;
