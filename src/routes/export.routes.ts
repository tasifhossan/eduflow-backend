import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { exportStudents, exportBatchResults } from '../controllers/export.controller';

const router = Router();

// Exports are restricted to ADMIN (own branch) and SUPER_ADMIN (all branches)
router.get(
  '/exports/students',
  authenticate,
  authorize(Role.ADMIN),
  exportStudents
);

router.get(
  '/exports/batch-results',
  authenticate,
  authorize(Role.ADMIN),
  exportBatchResults
);

export default router;

