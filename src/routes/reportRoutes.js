import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireCapability } from '../middleware/permission.js';
import {
  handleGetReports,
  handleGetMissingTimesheets,
  handleChaseMissingTimesheets,
  handleGetWhoIsAway,
  handleGetReviewQueueByReviewer,
  handleGetEmployeeTimeTrend,
  handleGetEmployeeProjectBreakdown,
} from '../controllers/reportController.js';

const router = express.Router();
router.use(authenticate);

router.get('/', requireCapability('VIEW_REPORTS'), handleGetReports);
router.get('/missing-timesheets', requireCapability('VIEW_REPORTS'), handleGetMissingTimesheets);
router.post('/missing-timesheets/chase', requireCapability('VIEW_REPORTS'), handleChaseMissingTimesheets);
router.get('/who-is-away', requireCapability('VIEW_REPORTS'), handleGetWhoIsAway);
router.get('/review-queue-by-reviewer', requireCapability('VIEW_REPORTS'), handleGetReviewQueueByReviewer);
router.get('/employee-time-trend', requireCapability('VIEW_REPORTS'), handleGetEmployeeTimeTrend);
router.get('/employee-project-breakdown', requireCapability('VIEW_REPORTS'), handleGetEmployeeProjectBreakdown);

export default router;

