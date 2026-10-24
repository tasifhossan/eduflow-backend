import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { getAuditLogs } from '../controllers/audit.controller';

const router = Router();

router.get('/', authenticate, authorize(Role.ADMIN), getAuditLogs);

export default router;
