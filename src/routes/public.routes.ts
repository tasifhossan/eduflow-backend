import { Router } from 'express';
import {
  getPublicBatches,
  getPublicBatchBySlug,
  getPublicFilters,
  getPublicStats,
  getPublicBranches,
  getPublicTeachers,
  getPublicPageByKey,
  getPublicSitemap,
} from '../controllers/public.controller';
import { getPublicCenter } from '../controllers/settings.controller';
import { requireFeature } from '../middleware/featureFlag.middleware';

const router = Router();

// Center branding facts & feature flags (always public for runtime site bootstrap)
router.get('/center', getPublicCenter);

// Static legal and about pages (about is gated internally by publicSite, privacy & terms are always accessible)
router.get('/pages/:key', getPublicPageByKey);

// Sitemap feed for published batches and blog posts (cached 5 min, respects feature flags internally)
router.get('/sitemap', getPublicSitemap);

// Public course & center directory (gated by publicSite feature flag)
router.get('/batches', requireFeature('publicSite'), getPublicBatches);
router.get('/batches/:slug', requireFeature('publicSite'), getPublicBatchBySlug);
router.get('/filters', requireFeature('publicSite'), getPublicFilters);
router.get('/stats', requireFeature('publicSite'), getPublicStats);
router.get('/branches', requireFeature('publicSite'), getPublicBranches);
router.get('/teachers', requireFeature('publicSite'), getPublicTeachers);

export default router;
