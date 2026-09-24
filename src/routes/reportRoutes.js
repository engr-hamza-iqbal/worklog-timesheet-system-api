import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireCapability } from '../middleware/permission.js';
import {
  handleGetReports,
  handleGetMissingTimesheets,
  handleChaseMissingTimesheets,
} from '../controllers/reportController.js';

const router = express.Router();
router.use(authenticate);

router.get('/', requireCapability('VIEW_REPORTS'), handleGetReports);
router.get('/missing-timesheets', requireCapability('VIEW_REPORTS'), handleGetMissingTimesheets);
router.post('/missing-timesheets/chase', requireCapability('VIEW_REPORTS'), handleChaseMissingTimesheets);

export default router;
