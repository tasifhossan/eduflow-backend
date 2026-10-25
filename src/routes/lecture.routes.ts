import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireFeature } from '../middleware/featureFlag.middleware';
import {
  createLecture,
  updateLecture,
  completeLecture,
  cancelLecture,
  deleteLecture,
  generateLectures,
  getLectures,
  getLectureById,
  getSyllabusProgress,
} from '../controllers/lecture.controller';

const router = Router();

router.use(requireFeature('lectures'));

router.post('/lectures', authenticate, createLecture);
router.get('/lectures', authenticate, getLectures);
router.get('/lectures/:id', authenticate, getLectureById);
router.patch('/lectures/:id', authenticate, updateLecture);
router.post('/lectures/:id/complete', authenticate, completeLecture);
router.post('/lectures/:id/cancel', authenticate, cancelLecture);
router.delete('/lectures/:id', authenticate, deleteLecture);

router.post('/batches/:batchId/lectures/generate', authenticate, generateLectures);
router.get('/batches/:batchId/syllabus-progress', authenticate, getSyllabusProgress);

export default router;
