import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import {
  createResource,
  getResourcesByBatch,
  deleteResource,
} from '../controllers/resource.controller';

const router = Router();

router.post(
  '/resources',
  authenticate,
  authorize(Role.ADMIN, Role.TEACHER),
  createResource
);

router.get(
  '/batches/:batchId/resources',
  authenticate,
  authorize(Role.ADMIN, Role.TEACHER, Role.STUDENT),
  getResourcesByBatch
);

router.delete(
  '/resources/:id',
  authenticate,
  authorize(Role.ADMIN, Role.TEACHER),
  deleteResource
);

export default router;
