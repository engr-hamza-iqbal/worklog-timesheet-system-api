import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireCapability } from '../middleware/permission.js';
import { handleGetReports } from '../controllers/reportController.js';

const router = express.Router();
router.use(authenticate);
router.get('/', requireCapability('VIEW_REPORTS'), handleGetReports);
export default router;
