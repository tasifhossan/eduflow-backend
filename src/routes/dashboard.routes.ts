import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { branchScope } from '../middleware/branchScope.middleware';
import { getDashboardSummary } from '../controllers/dashboard.controller';

const router = Router();

router.get(
  '/summary',
  authenticate,
  authorize(Role.ADMIN, Role.TEACHER, Role.STUDENT, Role.GUARDIAN),
  branchScope,
  getDashboardSummary,
);

export default router;
