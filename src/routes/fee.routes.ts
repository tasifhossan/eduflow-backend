import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import {
  updateBatchFee,
  setStudentFee,
  getStudentNetFee,
  createPaymentRecord,
  createInstallmentPlan,
  updatePaymentRecord,
  getPaymentsByBatch,
  getPaymentsByStudent,
  getDueSummary,
  getMyPayments,
} from '../controllers/fee.controller';

const router = Router();

// Student self payment history
router.get('/payments/my-payments', authenticate, authorize(Role.STUDENT), getMyPayments);

// Batch fee configuration

router.patch('/batches/:id/fee', authenticate, authorize(Role.ADMIN), updateBatchFee);

// Enrollment fee & discount configuration
router.patch('/enrollments/:id/fee', authenticate, authorize(Role.ADMIN), setStudentFee);
router.get('/enrollments/:id/net-fee', authenticate, authorize(Role.ADMIN), getStudentNetFee);

// Payment creation & management
router.post('/payments/installment-plan', authenticate, authorize(Role.ADMIN), createInstallmentPlan);
router.post('/payments', authenticate, authorize(Role.ADMIN), createPaymentRecord);
router.get('/payments/due-summary', authenticate, authorize(Role.ADMIN), getDueSummary);
router.patch('/payments/:id', authenticate, authorize(Role.ADMIN), updatePaymentRecord);

// Payment queries by batch & student
router.get('/batches/:batchId/payments', authenticate, authorize(Role.ADMIN), getPaymentsByBatch);
router.get('/students/:studentId/payments', authenticate, authorize(Role.ADMIN), getPaymentsByStudent);

export default router;
