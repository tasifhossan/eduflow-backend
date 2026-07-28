import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import {
  updateQuestion,
  deleteQuestion,
} from '../controllers/question.controller';

const router = Router();

router.patch('/questions/:id', authenticate, authorize(Role.ADMIN, Role.TEACHER), updateQuestion);
router.delete('/questions/:id', authenticate, authorize(Role.ADMIN, Role.TEACHER), deleteQuestion);

export default router;
