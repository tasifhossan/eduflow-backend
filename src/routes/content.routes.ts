import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import {
  getBlogPosts,
  getBlogPostBySlug,
  getTestimonials,
  getFaqItems,
  getBatchReviews,
  createBatchReview,
  updateReview,
  deleteReview,
  submitContactMessage,
  getContactMessages,
  updateContactMessageStatus,
  subscribeNewsletter,
} from '../controllers/content.controller';
import { requireFeature } from '../middleware/featureFlag.middleware';

const router = Router();

// Rate limiters: 5 requests per hour per IP
const contactRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many contact submissions from this IP, please try again later.',
    });
  },
});

const newsletterRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many newsletter subscription attempts from this IP, please try again later.',
    });
  },
});

// 1. Blog
router.get('/blog', requireFeature('blog'), getBlogPosts);
router.get('/blog/:slug', requireFeature('blog'), getBlogPostBySlug);

// 2. Testimonials & FAQ
router.get('/testimonials', requireFeature('testimonials'), getTestimonials);
router.get('/faq', getFaqItems);

// 3. Reviews
router.get('/batches/:batchId/reviews', requireFeature('reviews'), getBatchReviews);
router.post(
  '/batches/:batchId/reviews',
  requireFeature('reviews'),
  authenticate,
  authorize(Role.STUDENT),
  createBatchReview
);
router.patch('/reviews/:id', authenticate, updateReview);
router.delete('/reviews/:id', authenticate, deleteReview);

// 4. Contact
router.post('/contact', contactRateLimiter, submitContactMessage);
router.get(
  '/contact',
  authenticate,
  authorize(Role.SUPER_ADMIN),
  getContactMessages
);
router.patch(
  '/contact/:id/status',
  authenticate,
  authorize(Role.SUPER_ADMIN),
  updateContactMessageStatus
);

// 5. Newsletter
router.post('/newsletter', requireFeature('newsletter'), newsletterRateLimiter, subscribeNewsletter);

export default router;
