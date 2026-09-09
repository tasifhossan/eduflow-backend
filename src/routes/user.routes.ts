import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { branchScope } from '../middleware/branchScope.middleware';
import { getUsers, updateUserBranch } from '../controllers/user.controller';

const router = Router();

router.get('/', authenticate, authorize(Role.ADMIN, Role.TEACHER), branchScope, getUsers);
router.patch('/:userId/branch', authenticate, authorize(Role.SUPER_ADMIN), updateUserBranch);

export default router;
