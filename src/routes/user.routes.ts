import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { branchScope } from '../middleware/branchScope.middleware';
import { noCache } from '../middleware/noCache.middleware';
import {
  getUsers,
  updateUserBranch,
  adminResetPassword,
  updateUserStatus,
  deleteUser,
  importUsers,
} from '../controllers/user.controller';

const router = Router();

// List users with branch scoping
router.get('/', authenticate, authorize(Role.ADMIN, Role.TEACHER), branchScope, getUsers);

// Reassign user branch (Super Admin only)
router.patch('/:userId/branch', authenticate, authorize(Role.SUPER_ADMIN), updateUserBranch);

// Admin reset of user password
router.post('/:id/reset-password', authenticate, authorize(Role.ADMIN), noCache, adminResetPassword);

// Activate/Deactivate user
router.patch('/:id/status', authenticate, authorize(Role.ADMIN), updateUserStatus);

// Delete user (blocked if related records exist)
router.delete('/:id', authenticate, authorize(Role.ADMIN), deleteUser);

// Bulk CSV import
router.post('/import', authenticate, authorize(Role.ADMIN), noCache, importUsers);

export default router;
