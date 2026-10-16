import { Router } from 'express';
import {
  getPublicBatches,
  getPublicBatchBySlug,
  getPublicFilters,
  getPublicStats,
  getPublicBranches,
  getPublicTeachers,
} from '../controllers/public.controller';

const router = Router();

router.get('/batches', getPublicBatches);
router.get('/batches/:slug', getPublicBatchBySlug);
router.get('/filters', getPublicFilters);
router.get('/stats', getPublicStats);
router.get('/branches', getPublicBranches);
router.get('/teachers', getPublicTeachers);

export default router;
