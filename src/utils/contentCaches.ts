import { invalidateSettingsCache } from '../services/settings.service';
import { invalidateSitemapCache, invalidateStatsCache } from '../controllers/public.controller';

/** Every CMS write calls this so public content summary, sitemap and stats never serve stale data. */
export function invalidateContentCaches(): void {
  invalidateSettingsCache();
  invalidateSitemapCache();
  invalidateStatsCache();
}
