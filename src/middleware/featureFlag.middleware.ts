import { Request, Response, NextFunction } from 'express';
import { getCenterSettings } from '../services/settings.service';

export type FeatureFlagName =
  | 'publicSite'
  | 'aiAssistant'
  | 'blog'
  | 'reviews'
  | 'testimonials'
  | 'newsletter'
  | 'showPoweredBy'
  | 'lectures'
  | 'assignments'
  | 'onlineClasses';

export function requireFeature(flag: FeatureFlagName) {
  return async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const settings = await getCenterSettings();
      const features = (settings.features as Record<string, boolean>) || {};

      // If the flag is explicitly set to false, reject with 404
      if (features[flag] === false) {
        return res.status(404).json({
          success: false,
          message: 'Not available',
        });
      }

      return next();
    } catch (error) {
      console.error(`Error checking feature flag ${flag}:`, error);
      // Fail closed or proceed? Fail gracefully with 500
      return res.status(500).json({
        success: false,
        message: 'Internal server error checking system feature availability',
      });
    }
  };
}
