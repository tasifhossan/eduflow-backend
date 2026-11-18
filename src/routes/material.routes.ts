import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { requireFeature } from '../middleware/featureFlag.middleware';
import {
  createMaterial,
  updateMaterial,
  deleteMaterial,
  publishMaterial,
  unpublishMaterial,
  reorderMaterials,
  copyMaterial,
  getMaterialsByBatch,
  getMaterialById,
  getBatchMaterialsSummary,
  getMaterialAccessLogs,
} from '../controllers/material.controller';

const router = Router();

// Batch materials routes
router.get(
  '/batches/:batchId/materials/summary',
  authenticate,
  requireFeature('materials'),
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.TEACHER, Role.STUDENT, Role.GUARDIAN),
  getBatchMaterialsSummary
);

router.put(
  '/batches/:batchId/materials/order',
  authenticate,
  requireFeature('materials'),
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.TEACHER),
  reorderMaterials
);

router.get(
  '/batches/:batchId/materials',
  authenticate,
  requireFeature('materials'),
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.TEACHER, Role.STUDENT, Role.GUARDIAN),
  getMaterialsByBatch
);

// Individual material actions (must precede /materials/:id)
router.post(
  '/materials/:id/publish',
  authenticate,
  requireFeature('materials'),
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.TEACHER),
  publishMaterial
);

router.post(
  '/materials/:id/unpublish',
  authenticate,
  requireFeature('materials'),
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.TEACHER),
  unpublishMaterial
);

router.post(
  '/materials/:id/copy',
  authenticate,
  requireFeature('materials'),
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.TEACHER),
  copyMaterial
);

router.get(
  '/materials/:id/access',
  authenticate,
  requireFeature('materials'),
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.TEACHER),
  getMaterialAccessLogs
);

// Material CRUD
router.post(
  '/materials',
  authenticate,
  requireFeature('materials'),
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.TEACHER),
  createMaterial
);

router.get(
  '/materials/:id',
  authenticate,
  requireFeature('materials'),
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.TEACHER, Role.STUDENT, Role.GUARDIAN),
  getMaterialById
);

router.patch(
  '/materials/:id',
  authenticate,
  requireFeature('materials'),
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.TEACHER),
  updateMaterial
);

router.delete(
  '/materials/:id',
  authenticate,
  requireFeature('materials'),
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.TEACHER),
  deleteMaterial
);

export default router;
