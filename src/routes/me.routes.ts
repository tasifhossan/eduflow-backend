import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/auth.middleware';
import { getProfile, updateProfile, changePassword } from '../controllers/me.controller';

const router = Router();

// Rate limiter for password changes: 5 attempts per 15 minutes per IP
const passwordRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many password change attempts, please try again after 15 minutes.',
    });
  },
});

router.use(authenticate);

// Profile retrieval and updates (handles mounting at either /api/me or /api)
router.get(['/', '/me'], getProfile);
router.patch(['/', '/me'], updateProfile);
router.patch(['/password', '/me/password'], passwordRateLimiter, changePassword);

export default router;
