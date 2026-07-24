import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import {
  createRoutineSlot,
  getRoutineByBatch,
  deleteRoutineSlot,
} from '../controllers/routine.controller';

const router = Router();

router.post('/routines', authenticate, authorize(Role.ADMIN), createRoutineSlot);
router.get('/batches/:batchId/routine', authenticate, authorize(Role.ADMIN, Role.TEACHER, Role.STUDENT), getRoutineByBatch);
router.delete('/routines/:id', authenticate, authorize(Role.ADMIN), deleteRoutineSlot);

export default router;
