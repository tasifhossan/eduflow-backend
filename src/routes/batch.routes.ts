import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { branchScope } from '../middleware/branchScope.middleware';
import {
  createBatch,
  getBatches,
  getBatchById,
  updateBatch,
  deleteBatch,
  getBatchForStudent,
} from '../controllers/batch.controller';
import { getBatchAnalytics, getStudentTrend } from '../controllers/analytics.controller';

const router = Router();

router.get('/:id/student-view', authenticate, authorize(Role.STUDENT), getBatchForStudent);
router.post('/', authenticate, authorize(Role.ADMIN), branchScope, createBatch);

router.get('/', authenticate, authorize(Role.ADMIN, Role.TEACHER), branchScope, getBatches);
router.get('/:id', authenticate, authorize(Role.ADMIN, Role.TEACHER), branchScope, getBatchById);
router.patch('/:id', authenticate, authorize(Role.ADMIN), branchScope, updateBatch);
router.delete('/:id', authenticate, authorize(Role.ADMIN), branchScope, deleteBatch);

// Analytics endpoints
router.get('/:batchId/analytics', authenticate, authorize(Role.ADMIN, Role.TEACHER), branchScope, getBatchAnalytics);
router.get('/:batchId/students/:studentId/trend', authenticate, authorize(Role.ADMIN, Role.TEACHER, Role.STUDENT), branchScope, getStudentTrend);

export default router;
