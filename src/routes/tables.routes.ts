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

// 3. GET /tables/payments (All authenticated roles with role-based scoping)
router.get(
  ['/payments', '/tables/payments'],
  branchScope,
  getTablePayments
);

// 4. GET /tables/attendance (All authenticated roles with role-based scoping)
router.get(
  ['/attendance', '/tables/attendance'],
  branchScope,
  getTableAttendance
);

// 5. GET /tables/results (All authenticated roles with role-based scoping)
router.get(
  ['/results', '/tables/results'],
  branchScope,
  getTableResults
);

// 6. GET /tables/enrollments (All authenticated roles with role-based scoping)
router.get(
  ['/enrollments', '/tables/enrollments'],
  branchScope,
  getTableEnrollments
);

export default router;
