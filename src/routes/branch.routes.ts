import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { branchScope } from '../middleware/branchScope.middleware';
import {
  getBranches,
  getBranchById,
  createBranch,
  updateBranch,
  deleteBranch,
} from '../controllers/branch.controller';

const router = Router();

router.get('/', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.TEACHER), branchScope, getBranches);
router.get('/:id', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.TEACHER), branchScope, getBranchById);

router.post('/', authenticate, authorize(Role.SUPER_ADMIN), createBranch);
router.patch('/:id', authenticate, authorize(Role.SUPER_ADMIN), updateBranch);
router.put('/:id', authenticate, authorize(Role.SUPER_ADMIN), updateBranch);
router.delete('/:id', authenticate, authorize(Role.SUPER_ADMIN), deleteBranch);

export default router;
