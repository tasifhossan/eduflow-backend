import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import {
  getStudentsWithSummary,
  updateStudent,
  getGuardianChangeLog,
} from '../controllers/student.controller';

const router = Router();

router.get('/students/summary', authenticate, authorize(Role.ADMIN, Role.TEACHER), getStudentsWithSummary);
router.patch('/students/:id', authenticate, authorize(Role.ADMIN), updateStudent);
router.get('/students/:id/guardian-log', authenticate, authorize(Role.ADMIN), getGuardianChangeLog);

export default router;
