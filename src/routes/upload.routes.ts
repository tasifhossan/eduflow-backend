import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/auth.middleware';
import { getSignedUploadParams } from '../controllers/upload.controller';

const router = Router();

const uploadSignatureLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30, // 30 per hour per user
  keyGenerator: (req: Request) => req.user?.userId || 'anonymous',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      message: 'Too many upload signature requests. Rate limit is 30 per hour.',
    });
  },
});

router.post(
  '/uploads/signature',
  authenticate,
  uploadSignatureLimiter,
  getSignedUploadParams
);

router.get(
  '/uploads/signature',
  authenticate,
  uploadSignatureLimiter,
  getSignedUploadParams
);

export default router;
