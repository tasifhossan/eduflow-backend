import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import {
  register,
  login,
  me,
  logout,
  googleLogin,
  demoLogin,
} from '../controllers/auth.controller';

const router = Router();

// Demo login rate limiter: 20 requests per 15 min per IP
const demoRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many demo login requests, please try again later.',
    });
  },
});

router.post('/register', authenticate, authorize(Role.ADMIN), register);

router.post('/login', login);

router.post('/logout', logout);

router.get('/me', authenticate, me);

router.post('/google', googleLogin);

router.post('/demo', demoRateLimiter, demoLogin);

export default router;
