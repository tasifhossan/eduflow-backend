import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import {
  createGuardianAccount,
  linkGuardianToStudent,
  unlinkGuardianFromStudent,
  getMyLinkedStudents,
  getLinkedStudentAttendance,
  getLinkedStudentResults,
  getLinkedStudentPayments,
} from '../controllers/guardian.controller';

const router = Router();

router.post(
  '/guardians',
  authenticate,
  authorize(Role.ADMIN),
  createGuardianAccount
);

router.post(
  '/guardians/link',
  authenticate,
  authorize(Role.ADMIN),
  linkGuardianToStudent
);

router.delete(
  '/guardians/link/:id',
  authenticate,
  authorize(Role.ADMIN),
  unlinkGuardianFromStudent
);

router.get(
  '/guardians/my-students',
  authenticate,
  authorize(Role.GUARDIAN),
  getMyLinkedStudents
);

router.get(
  '/guardians/students/:studentId/attendance',
  authenticate,
  authorize(Role.GUARDIAN),
  getLinkedStudentAttendance
);

router.get(
  '/guardians/students/:studentId/results',
  authenticate,
  authorize(Role.GUARDIAN),
  getLinkedStudentResults
);

router.get(
  '/guardians/students/:studentId/payments',
  authenticate,
  authorize(Role.GUARDIAN),
  getLinkedStudentPayments
);

export default router;
