import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { getSettings, updateSettings } from '../controllers/settings.controller';

const router = Router();

router.use(authenticate, authorize(Role.SUPER_ADMIN));

router.get('/', getSettings);
router.patch('/', updateSettings);

export default router;
