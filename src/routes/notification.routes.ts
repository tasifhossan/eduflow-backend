import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import {
  getNotifications,
  markNotificationsRead,
} from '../controllers/notification.controller';

const router = Router();

router.get('/notifications', authenticate, getNotifications);
router.patch('/notifications/read', authenticate, markNotificationsRead);

export default router;
