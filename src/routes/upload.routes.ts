import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { getSignedUploadParams } from '../controllers/upload.controller';

const router = Router();

router.get(
  '/uploads/signature',
  authenticate,
  authorize(Role.ADMIN, Role.TEACHER),
  getSignedUploadParams
);

export default router;
