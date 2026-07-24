import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { getSubjects, createSubject } from '../controllers/subject.controller';

const router = Router();

router.get('/', authenticate, authorize(Role.ADMIN, Role.TEACHER), getSubjects);
router.post('/', authenticate, authorize(Role.ADMIN), createSubject);

export default router;
