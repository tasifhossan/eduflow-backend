import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import {
  createReportPeriod,
  getBatchReportPeriods,
  updateReportPeriod,
  publishReportPeriod,
  unpublishReportPeriod,
  updateReportRemark,
  getReportPeriodCards,
  getStudentReportCard,
  getMyReportCards,
  getMyReportCardById,
} from '../controllers/report-period.controller';

const router = Router();

// Staff report period management
router.post(
  '/report-periods',
  authenticate,
  authorize(Role.ADMIN, Role.TEACHER),
  createReportPeriod
);

router.get(
  '/batches/:id/report-periods',
  authenticate,
  getBatchReportPeriods
);

router.patch(
  '/report-periods/:id',
  authenticate,
  authorize(Role.ADMIN, Role.TEACHER),
  updateReportPeriod
);

router.post(
  '/report-periods/:id/publish',
  authenticate,
  authorize(Role.ADMIN, Role.TEACHER),
  publishReportPeriod
);

router.post(
  '/report-periods/:id/unpublish',
  authenticate,
  authorize(Role.ADMIN, Role.TEACHER),
  unpublishReportPeriod
);

router.put(
  '/report-periods/:id/remarks/:studentId',
  authenticate,
  authorize(Role.ADMIN, Role.TEACHER),
  updateReportRemark
);

router.get(
  '/report-periods/:id/cards',
  authenticate,
  authorize(Role.ADMIN, Role.TEACHER),
  getReportPeriodCards
);

router.get(
  '/report-periods/:id/cards/:studentId',
  authenticate,
  authorize(Role.ADMIN, Role.TEACHER),
  getStudentReportCard
);

// Student and Guardian report cards
router.get(
  '/my/report-cards',
  authenticate,
  getMyReportCards
);

router.get(
  '/my/report-cards/:periodId',
  authenticate,
  getMyReportCardById
);

export default router;

