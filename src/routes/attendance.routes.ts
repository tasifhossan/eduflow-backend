import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { noCache } from '../middleware/noCache.middleware';
import {
  markAttendance,
  getAttendanceByBatchAndDate,
  getAttendanceByStudent,
  getTodayAttendanceSummary,
  getLowAttendanceReport,
  getBatchAttendanceSheet,
  getMyAttendanceSummary,
} from '../controllers/attendance.controller';

const router = Router();

router.post('/attendance', authenticate, authorize(Role.ADMIN, Role.TEACHER, Role.SUPER_ADMIN), noCache, markAttendance);
router.get('/attendance/today-summary', authenticate, authorize(Role.ADMIN, Role.TEACHER, Role.SUPER_ADMIN), noCache, getTodayAttendanceSummary);
router.get('/attendance/low', authenticate, authorize(Role.ADMIN, Role.TEACHER, Role.SUPER_ADMIN), noCache, getLowAttendanceReport);
router.get('/batches/:id/attendance/sheet', authenticate, authorize(Role.ADMIN, Role.TEACHER, Role.SUPER_ADMIN), noCache, getBatchAttendanceSheet);
router.get('/my/attendance/summary', authenticate, authorize(Role.STUDENT, Role.GUARDIAN), noCache, getMyAttendanceSummary);

router.get('/batches/:batchId/attendance', authenticate, authorize(Role.ADMIN, Role.TEACHER, Role.SUPER_ADMIN), noCache, getAttendanceByBatchAndDate);
router.get('/students/:studentId/attendance', authenticate, authorize(Role.ADMIN, Role.TEACHER, Role.STUDENT, Role.SUPER_ADMIN), noCache, getAttendanceByStudent);

export default router;
