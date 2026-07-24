import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import {
  createBatch,
  getBatches,
  getBatchById,
  updateBatch,
  deleteBatch,
} from '../controllers/batch.controller';

const router = Router();

router.post('/', authenticate, authorize(Role.ADMIN), createBatch);
router.get('/', authenticate, authorize(Role.ADMIN, Role.TEACHER), getBatches);
router.get('/:id', authenticate, authorize(Role.ADMIN, Role.TEACHER), getBatchById);
router.patch('/:id', authenticate, authorize(Role.ADMIN), updateBatch);
router.delete('/:id', authenticate, authorize(Role.ADMIN), deleteBatch);

export default router;
