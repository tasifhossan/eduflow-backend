import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { branchScope } from '../middleware/branchScope.middleware';
import { chatWithAi, getAiInsights } from '../controllers/ai.controller';

const router = Router();

// Public AI chat rate limiter: 20 requests per hour per IP
const aiChatRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many AI chat requests from this IP. Please try again after an hour.',
    });
  },
});

// POST /api/ai/chat (Public, rate-limited)
router.post('/chat', aiChatRateLimiter, chatWithAi);

// GET /api/ai/insights (ADMIN, SUPER_ADMIN; branch-scoped)
router.get(
  '/insights',
  authenticate,
  authorize(Role.ADMIN, Role.SUPER_ADMIN),
  branchScope,
  getAiInsights
);

export default router;
