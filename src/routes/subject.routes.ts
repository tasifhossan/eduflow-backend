import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { getSubjects, createSubject, updateSubject } from '../controllers/subject.controller';
import { reorderSubjectChapters } from '../controllers/chapter.controller';

const router = Router();

router.get('/', authenticate, authorize(Role.ADMIN, Role.TEACHER), getSubjects);
router.post('/', authenticate, authorize(Role.ADMIN), createSubject);
router.patch('/:id', authenticate, authorize(Role.SUPER_ADMIN), updateSubject);
router.put('/:subjectId/chapters/order', authenticate, authorize(Role.SUPER_ADMIN), reorderSubjectChapters);

export default router;
