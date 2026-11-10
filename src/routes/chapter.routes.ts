import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { getChapters, createChapter, updateChapter } from '../controllers/chapter.controller';

const router = Router();

router.get('/', authenticate, authorize(Role.ADMIN, Role.TEACHER), getChapters);
router.post('/', authenticate, authorize(Role.ADMIN), createChapter);
router.patch('/:id', authenticate, authorize(Role.ADMIN), updateChapter);

export default router;
