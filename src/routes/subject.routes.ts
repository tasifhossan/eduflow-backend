import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { getSubjects, createSubject, updateSubject } from '../controllers/subject.controller';

const router = Router();

router.get('/', authenticate, authorize(Role.ADMIN, Role.TEACHER), getSubjects);
router.post('/', authenticate, authorize(Role.ADMIN), createSubject);
router.patch('/:id', authenticate, authorize(Role.ADMIN), updateSubject);

export default router;
