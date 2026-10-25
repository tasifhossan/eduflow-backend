import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import {
  createAttachment,
  getAttachmentDownload,
  deleteAttachment,
} from '../controllers/attachment.controller';

const router = Router();

router.post('/attachments', authenticate, createAttachment);
router.get('/attachments/:id/download', authenticate, getAttachmentDownload);
router.delete('/attachments/:id', authenticate, deleteAttachment);

export default router;
