import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import {
  createTest,
  getTestsByBatch,
  getTestById,
  updateTest,
  deleteTest,
} from '../controllers/test.controller';
import {
  addQuestion,
  addQuestionsBulk,
} from '../controllers/question.controller';

const router = Router();

// Test management
router.post('/tests', authenticate, authorize(Role.ADMIN, Role.TEACHER), createTest);
router.get('/batches/:batchId/tests', authenticate, authorize(Role.ADMIN, Role.TEACHER, Role.STUDENT), getTestsByBatch);
router.get('/tests/:id', authenticate, authorize(Role.ADMIN, Role.TEACHER, Role.STUDENT), getTestById);
router.patch('/tests/:id', authenticate, authorize(Role.ADMIN, Role.TEACHER), updateTest);
router.delete('/tests/:id', authenticate, authorize(Role.ADMIN, Role.TEACHER), deleteTest);

// Questions (within test scope)
router.post('/tests/:testId/questions', authenticate, authorize(Role.ADMIN, Role.TEACHER), addQuestion);
router.post('/tests/:testId/questions/bulk', authenticate, authorize(Role.ADMIN, Role.TEACHER), addQuestionsBulk);

export default router;
