import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { getStudentsWithSummary } from '../controllers/student.controller';

const router = Router();

router.get('/students/summary', authenticate, authorize(Role.ADMIN, Role.TEACHER), getStudentsWithSummary);

export default router;
