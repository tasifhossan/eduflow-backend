import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import {
  markAttendance,
  getAttendanceByBatchAndDate,
  getAttendanceByStudent,
  getTodayAttendanceSummary,
} from '../controllers/attendance.controller';

const router = Router();

router.post('/attendance', authenticate, authorize(Role.ADMIN, Role.TEACHER), markAttendance);
router.get('/attendance/today-summary', authenticate, authorize(Role.ADMIN, Role.TEACHER), getTodayAttendanceSummary);
router.get('/batches/:batchId/attendance', authenticate, authorize(Role.ADMIN, Role.TEACHER), getAttendanceByBatchAndDate);
router.get('/students/:studentId/attendance', authenticate, authorize(Role.ADMIN, Role.TEACHER, Role.STUDENT), getAttendanceByStudent);

export default router;
