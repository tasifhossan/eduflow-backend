import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { branchScope } from '../middleware/branchScope.middleware';
import {
  getTableUsers,
  getTableStudents,
  getTablePayments,
  getTableAttendance,
  getTableResults,
  getTableEnrollments,
} from '../controllers/tables.controller';

const router = Router();

router.use(authenticate);

// 1. GET /tables/users (ADMIN, SUPER_ADMIN)
router.get(
  ['/users', '/tables/users'],
  authorize(Role.ADMIN, Role.SUPER_ADMIN),
  branchScope,
  getTableUsers
);

// 2. GET /tables/students (ADMIN, TEACHER, SUPER_ADMIN, ACCOUNTANT)
router.get(
  ['/students', '/tables/students'],
  authorize(Role.ADMIN, Role.TEACHER, Role.SUPER_ADMIN, Role.ACCOUNTANT),
  branchScope,
  getTableStudents
);

// 3. GET /tables/payments (All authenticated roles EXCEPT TEACHER)
router.get(
  ['/payments', '/tables/payments'],
  authorize(Role.ADMIN, Role.SUPER_ADMIN, Role.ACCOUNTANT, Role.STUDENT, Role.GUARDIAN),
  branchScope,
  getTablePayments
);

// 4. GET /tables/attendance (All authenticated roles EXCEPT ACCOUNTANT)
router.get(
  ['/attendance', '/tables/attendance'],
  authorize(Role.ADMIN, Role.TEACHER, Role.STUDENT, Role.GUARDIAN, Role.SUPER_ADMIN),
  branchScope,
  getTableAttendance
);

// 5. GET /tables/results (All authenticated roles EXCEPT ACCOUNTANT)
router.get(
  ['/results', '/tables/results'],
  authorize(Role.ADMIN, Role.TEACHER, Role.STUDENT, Role.GUARDIAN, Role.SUPER_ADMIN),
  branchScope,
  getTableResults
);

// 6. GET /tables/enrollments (All authenticated roles EXCEPT ACCOUNTANT)
router.get(
  ['/enrollments', '/tables/enrollments'],
  authorize(Role.ADMIN, Role.TEACHER, Role.STUDENT, Role.GUARDIAN, Role.SUPER_ADMIN),
  branchScope,
  getTableEnrollments
);

export default router;
