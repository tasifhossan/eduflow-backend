import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import {
  register,
  login,
  me,
  logout,
  changePassword,
  forgotPassword,
  resetPassword,
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

// Password change rate limiter: 10 per 15 min
const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many password change attempts, please try again later.',
    });
  },
});

// Forgot password rate limiter: 5 per hour
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}_${req.body?.identifier || ''}`,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many password reset requests. Please try again in an hour.',
    });
  },
});

// Reset password rate limiter: 5 per hour
const resetPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many reset attempts. Please try again later.',
    });
  },
});

// Staff-only user provisioning
router.post('/register', authenticate, authorize(Role.ADMIN), register);

// Login
router.post('/login', login);

// Logout
router.post('/logout', logout);

// Current user profile
router.get('/me', authenticate, me);

// Password change (forced on first login or voluntary)
router.post('/change-password', authenticate, changePasswordLimiter, changePassword);

// Self-service forgot password & reset password
router.post('/forgot-password', forgotPasswordLimiter, forgotPassword);
router.post('/reset-password', resetPasswordLimiter, resetPassword);

// Demo login (development & non-production only)
router.post('/demo', demoRateLimiter, demoLogin);

export default router;
