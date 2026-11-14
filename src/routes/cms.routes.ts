import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import {
  listBlogPosts,
  getBlogPost,
  createBlogPost,
  updateBlogPost,
  publishBlogPost,
  unpublishBlogPost,
  deleteBlogPost,
  listFaq,
  createFaq,
  updateFaq,
  reorderFaq,
  publishFaq,
  unpublishFaq,
  deleteFaq,
  createFaqSuggestions,
  listTestimonials,
  createTestimonial,
  updateTestimonial,
  reorderTestimonials,
  publishTestimonial,
  unpublishTestimonial,
  deleteTestimonial,
  setTestimonialFeatured,
} from '../controllers/cms.content.controller';
import {
  listTeachers,
  updateTeacher,
  listReviews,
  setReviewVisibility,
  getCmsSummary,
} from '../controllers/cms.people.controller';

// Website content management. Admin screens are NOT gated by the public feature flags.
// ADMIN/SUPER_ADMIN create and edit; only SUPER_ADMIN publishes, unpublishes and deletes.
const router = Router();
router.use(authenticate);

router.get('/summary', authorize(Role.ADMIN, Role.SUPER_ADMIN), getCmsSummary);

// Blog
router.get('/blog', authorize(Role.ADMIN, Role.SUPER_ADMIN), listBlogPosts);
router.get('/blog/:id', authorize(Role.ADMIN, Role.SUPER_ADMIN), getBlogPost);
router.post('/blog', authorize(Role.ADMIN, Role.SUPER_ADMIN), createBlogPost);
router.patch('/blog/:id', authorize(Role.ADMIN, Role.SUPER_ADMIN), updateBlogPost);
router.post('/blog/:id/publish', authorize(Role.SUPER_ADMIN), publishBlogPost);
router.post('/blog/:id/unpublish', authorize(Role.SUPER_ADMIN), unpublishBlogPost);
router.delete('/blog/:id', authorize(Role.SUPER_ADMIN), deleteBlogPost);

// FAQ
router.get('/faq', authorize(Role.ADMIN, Role.SUPER_ADMIN), listFaq);
router.post('/faq', authorize(Role.ADMIN, Role.SUPER_ADMIN), createFaq);
router.put('/faq/order', authorize(Role.ADMIN, Role.SUPER_ADMIN), reorderFaq);
router.post('/faq/suggestions', authorize(Role.ADMIN, Role.SUPER_ADMIN), createFaqSuggestions);
router.patch('/faq/:id', authorize(Role.ADMIN, Role.SUPER_ADMIN), updateFaq);
router.post('/faq/:id/publish', authorize(Role.SUPER_ADMIN), publishFaq);
router.post('/faq/:id/unpublish', authorize(Role.SUPER_ADMIN), unpublishFaq);
router.delete('/faq/:id', authorize(Role.SUPER_ADMIN), deleteFaq);

// Testimonials
router.get('/testimonials', authorize(Role.ADMIN, Role.SUPER_ADMIN), listTestimonials);
router.post('/testimonials', authorize(Role.ADMIN, Role.SUPER_ADMIN), createTestimonial);
router.put('/testimonials/order', authorize(Role.ADMIN, Role.SUPER_ADMIN), reorderTestimonials);
router.patch('/testimonials/:id', authorize(Role.ADMIN, Role.SUPER_ADMIN), updateTestimonial);
router.patch('/testimonials/:id/featured', authorize(Role.ADMIN, Role.SUPER_ADMIN), setTestimonialFeatured);
router.post('/testimonials/:id/publish', authorize(Role.SUPER_ADMIN), publishTestimonial);
router.post('/testimonials/:id/unpublish', authorize(Role.SUPER_ADMIN), unpublishTestimonial);
router.delete('/testimonials/:id', authorize(Role.SUPER_ADMIN), deleteTestimonial);

// Teachers' public profiles
router.get('/teachers', authorize(Role.ADMIN, Role.SUPER_ADMIN), listTeachers);
router.patch('/teachers/:id', authorize(Role.ADMIN, Role.SUPER_ADMIN), updateTeacher);

// Review visibility
router.get('/reviews', authorize(Role.ADMIN, Role.SUPER_ADMIN), listReviews);
router.patch('/reviews/:id/visibility', authorize(Role.ADMIN, Role.SUPER_ADMIN), setReviewVisibility);

export default router;
