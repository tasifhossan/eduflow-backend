import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { createPracticeSession, submitPracticeSession } from '../controllers/practice.controller';

const router = Router();

router.post(
  '/students/:studentId/practice-sessions',
  authenticate,
  authorize(Role.STUDENT),
  createPracticeSession
);

router.post(
  '/students/:studentId/practice-sessions/:sessionId/submit',
  authenticate,
  authorize(Role.STUDENT),
  submitPracticeSession
);

export default router;
