import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/auth.middleware';
import { requireFeature } from '../middleware/featureFlag.middleware';
import {
  createAssignment,
  getAssignments,
  getAssignmentById,
  updateAssignment,
  deleteAssignment,
  submitAssignment,
  getAssignmentSubmissions,
  getSubmissionById,
  gradeSubmission,
  submitOfflineBulkMarks,
} from '../controllers/assignment.controller';

const router = Router();

router.use(requireFeature('assignments'));

const submissionLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 per minute per user
  keyGenerator: (req: Request) => req.user?.userId || 'anonymous',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      message: 'Too many submission requests. Rate limit is 10 per minute.',
    });
  },
});

router.post('/assignments', authenticate, createAssignment);
router.get('/assignments', authenticate, getAssignments);
router.get('/assignments/:id', authenticate, getAssignmentById);
router.patch('/assignments/:id', authenticate, updateAssignment);
router.delete('/assignments/:id', authenticate, deleteAssignment);

router.post('/assignments/:id/submit', authenticate, submissionLimiter, submitAssignment);
router.get('/assignments/:id/submissions', authenticate, getAssignmentSubmissions);
router.post('/assignments/:id/marks', authenticate, submitOfflineBulkMarks);

router.get('/submissions/:id', authenticate, getSubmissionById);
router.patch('/submissions/:id/grade', authenticate, gradeSubmission);

export default router;
