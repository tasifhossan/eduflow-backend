import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import {
  createStudent,
  enrollStudent,
  getStudentsByBatch,
  getBatchesByStudent,
  unenrollStudent,
  restoreEnrollment,
} from '../controllers/enrollment.controller';

const router = Router();

router.post('/students', authenticate, authorize(Role.ADMIN), createStudent);
router.post('/enrollments', authenticate, authorize(Role.ADMIN), enrollStudent);
router.get('/batches/:batchId/students', authenticate, authorize(Role.ADMIN, Role.TEACHER), getStudentsByBatch);
router.get('/students/:studentId/batches', authenticate, authorize(Role.ADMIN, Role.TEACHER, Role.STUDENT, Role.GUARDIAN), getBatchesByStudent);
router.patch('/enrollments/:id/unenroll', authenticate, authorize(Role.ADMIN), unenrollStudent);
router.patch('/enrollments/:id/restore', authenticate, authorize(Role.ADMIN), restoreEnrollment);

export default router;
