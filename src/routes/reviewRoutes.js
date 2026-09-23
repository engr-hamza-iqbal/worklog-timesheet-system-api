import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireCapability, requireAdmin } from '../middleware/permission.js';
import {
  handleGetReviewQueue,
  handleApproveEntries,
  handleReturnEntry,
  handleReopenEntry,
} from '../controllers/reviewController.js';

const router = express.Router();

// All review routes require authentication
router.use(authenticate);

// GET  /api/reviews                    — view review queue (REVIEW_TIME or Admin)
// Admin bypasses requireCapability internally in reviewService (buildReviewerScope),
// but we still let the route through — the service guards access properly.
router.get('/', handleGetReviewQueue);

// POST /api/reviews/approve             — approve one or more entries
router.post('/approve', handleApproveEntries);

// POST /api/reviews/return              — return an entry with mandatory comment
router.post('/return', handleReturnEntry);

// POST /api/reviews/reopen              — reopen an approved entry (Admin only)
router.post('/reopen', requireAdmin(), handleReopenEntry);

export default router;
