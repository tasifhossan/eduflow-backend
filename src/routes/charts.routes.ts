import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { branchScope } from '../middleware/branchScope.middleware';
import {
  getRevenueMonthlyChart,
  getAttendanceTrendChart,
  getEnrollmentsByBatchChart,
  getScoreDistributionChart,
  getFeeStatusChart,
  getMyScoresChart,
  getMyAttendanceChart,
  getOverviewChart,
} from '../controllers/charts.controller';

const router = Router();

router.use(authenticate);

// 1. Revenue monthly (ADMIN, TEACHER, SUPER_ADMIN)
router.get(
  ['/revenue-monthly', '/charts/revenue-monthly'],
  authorize(Role.ADMIN, Role.TEACHER, Role.SUPER_ADMIN),
  branchScope,
  getRevenueMonthlyChart
);

// 2. Attendance trend 30 days (ADMIN, TEACHER, SUPER_ADMIN)
router.get(
  ['/attendance-trend', '/charts/attendance-trend'],
  authorize(Role.ADMIN, Role.TEACHER, Role.SUPER_ADMIN),
  branchScope,
  getAttendanceTrendChart
);

// 3. Enrollments by batch (ADMIN, TEACHER, SUPER_ADMIN)
router.get(
  ['/enrollments-by-batch', '/charts/enrollments-by-batch'],
  authorize(Role.ADMIN, Role.TEACHER, Role.SUPER_ADMIN),
  branchScope,
  getEnrollmentsByBatchChart
);

// 4. Score distribution (ADMIN, TEACHER, SUPER_ADMIN)
router.get(
  ['/score-distribution', '/charts/score-distribution'],
  authorize(Role.ADMIN, Role.TEACHER, Role.SUPER_ADMIN),
  branchScope,
  getScoreDistributionChart
);

// 5. Fee status (ADMIN, TEACHER, SUPER_ADMIN)
router.get(
  ['/fee-status', '/charts/fee-status'],
  authorize(Role.ADMIN, Role.TEACHER, Role.SUPER_ADMIN),
  branchScope,
  getFeeStatusChart
);

// 6. Student specific charts
router.get(
  ['/my-scores', '/charts/my-scores'],
  authorize(Role.STUDENT),
  getMyScoresChart
);

router.get(
  ['/my-attendance', '/charts/my-attendance'],
  authorize(Role.STUDENT),
  getMyAttendanceChart
);

// 7. Role-appropriate overview cards
router.get(
  ['/overview', '/charts/overview'],
  branchScope,
  getOverviewChart
);

export default router;
