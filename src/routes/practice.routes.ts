import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { createPracticeSession } from '../controllers/practice.controller';

const router = Router();

router.post(
  '/students/:studentId/practice-sessions',
  authenticate,
  authorize(Role.STUDENT),
  createPracticeSession
);

export default router;
