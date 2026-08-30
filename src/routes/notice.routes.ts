import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import {
  createNotice,
  getNotices,
  deleteNotice,
} from '../controllers/notice.controller';

const router = Router();

router.post(
  '/notices',
  authenticate,
  authorize(Role.ADMIN, Role.TEACHER),
  createNotice
);

router.get(
  '/notices',
  authenticate,
  authorize(Role.ADMIN, Role.TEACHER, Role.STUDENT, Role.GUARDIAN),
  getNotices
);

router.delete(
  '/notices/:id',
  authenticate,
  authorize(Role.ADMIN),
  deleteNotice
);

export default router;
