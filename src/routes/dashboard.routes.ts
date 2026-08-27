import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { getDashboardSummary } from '../controllers/dashboard.controller';

const router = Router();

router.get(
  '/summary',
  authenticate,
  authorize(Role.ADMIN, Role.TEACHER, Role.STUDENT),
  getDashboardSummary,
);

export default router;
