import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { noCache } from '../middleware/noCache.middleware';
import {
  getEnquiries,
  createEnquiry,
  getEnquiryById,
  updateEnquiry,
  addEnquiryNote,
  getDuplicateEnquiries,
  getEnquiriesSummary,
  convertEnquiry,
} from '../controllers/enquiry.controller';

const router = Router();

// Summary endpoint
router.get('/summary', authenticate, authorize(Role.ADMIN), noCache, getEnquiriesSummary);

// Duplicate phone check
router.get('/duplicates', authenticate, authorize(Role.ADMIN), noCache, getDuplicateEnquiries);

// List / export enquiries
router.get('/', authenticate, authorize(Role.ADMIN), noCache, getEnquiries);

// Create enquiry (walk-in/phone)
router.post('/', authenticate, authorize(Role.ADMIN), noCache, createEnquiry);

// Get single enquiry by ID with notes
router.get('/:id', authenticate, authorize(Role.ADMIN), noCache, getEnquiryById);

// Update enquiry (stage, follow-up, assignee, branch, contact fields)
router.patch('/:id', authenticate, authorize(Role.ADMIN), noCache, updateEnquiry);

// Add note / call log / visit log
router.post('/:id/notes', authenticate, authorize(Role.ADMIN), noCache, addEnquiryNote);

// Convert enquiry to enrolled student
router.post('/:id/convert', authenticate, authorize(Role.ADMIN), noCache, convertEnquiry);

export default router;
