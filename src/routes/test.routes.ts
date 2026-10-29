import { Router } from 'express';
import { Role } from '@prisma/client';
import rateLimit from 'express-rate-limit';
import { authenticate, authorize } from '../middleware/auth.middleware';
import {
  createTest,
  getTestsByBatch,
  getTestById,
  updateTest,
  deleteTest,
  restoreTest,
} from '../controllers/test.controller';
import {
  addQuestion,
  addQuestionsBulk,
} from '../controllers/question.controller';
import {
  startTestAttempt,
  getStudentAttempt,
  saveAttemptAnswers,
  getTestAttemptsStaff,
  extendTestAttempt,
  finalizeTestAttempts,
} from '../controllers/exam-attempt.controller';
import { EXAM_CONFIG } from '../config/academics.config';

const router = Router();

// Autosave rate limiter: 120 per minute per user
const autosaveLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: EXAM_CONFIG.AUTOSAVE_RATE_LIMIT_PER_MINUTE,
  keyGenerator: (req: any) => req.user?.userId || 'anonymous',
  message: {
    success: false,
    message: 'Too many autosave requests, please slow down.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Test management
router.post('/tests', authenticate, authorize(Role.ADMIN, Role.TEACHER), createTest);
router.get('/batches/:batchId/tests', authenticate, authorize(Role.ADMIN, Role.TEACHER, Role.STUDENT), getTestsByBatch);
router.get('/tests/:id', authenticate, authorize(Role.ADMIN, Role.TEACHER, Role.STUDENT), getTestById);
router.patch('/tests/:id', authenticate, authorize(Role.ADMIN, Role.TEACHER), updateTest);
router.delete('/tests/:id', authenticate, authorize(Role.ADMIN, Role.TEACHER), deleteTest);
router.post('/tests/:id/restore', authenticate, authorize(Role.ADMIN, Role.TEACHER), restoreTest);

// Student exam attempt lifecycle
router.post('/tests/:id/start', authenticate, authorize(Role.STUDENT), startTestAttempt);
router.get('/tests/:id/attempt', authenticate, authorize(Role.STUDENT), getStudentAttempt);
router.put(
  '/tests/:id/attempt/answers',
  authenticate,
  authorize(Role.STUDENT),
  autosaveLimiter,
  saveAttemptAnswers
);

// Staff attempt monitoring, extensions, and manual/lazy bulk finalize
router.get('/tests/:id/attempts', authenticate, authorize(Role.ADMIN, Role.TEACHER), getTestAttemptsStaff);
router.post(
  '/tests/:id/attempts/:attemptId/extend',
  authenticate,
  authorize(Role.ADMIN, Role.TEACHER),
  extendTestAttempt
);
router.post('/tests/:id/finalize', authenticate, authorize(Role.ADMIN, Role.TEACHER), finalizeTestAttempts);

// Questions (within test scope)
router.post('/tests/:testId/questions', authenticate, authorize(Role.ADMIN, Role.TEACHER), addQuestion);
router.post('/tests/:testId/questions/bulk', authenticate, authorize(Role.ADMIN, Role.TEACHER), addQuestionsBulk);

export default router;
