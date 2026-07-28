import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import {
  submitTest,
  gradeWrittenAnswer,
  getTestResults,
  getStudentResult,
} from '../controllers/submission.controller';

const router = Router();

router.post('/tests/:testId/submit', authenticate, authorize(Role.STUDENT), submitTest);
router.patch('/answers/:id/grade', authenticate, authorize(Role.ADMIN, Role.TEACHER), gradeWrittenAnswer);
router.get('/tests/:testId/results', authenticate, authorize(Role.ADMIN, Role.TEACHER), getTestResults);
router.get('/tests/:testId/my-result', authenticate, authorize(Role.STUDENT), getStudentResult);

export default router;
