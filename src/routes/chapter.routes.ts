import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { getChapters, createChapter } from '../controllers/chapter.controller';

const router = Router();

router.get('/', authenticate, authorize(Role.ADMIN, Role.TEACHER), getChapters);
router.post('/', authenticate, authorize(Role.ADMIN), createChapter);

export default router;
