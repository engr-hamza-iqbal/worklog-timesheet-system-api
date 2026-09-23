import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireCapability } from '../middleware/permission.js';
import { handleGetAnalytics } from '../controllers/analyticsController.js';

const router = express.Router();
router.use(authenticate);
router.get('/', requireCapability('VIEW_ANALYTICS'), handleGetAnalytics);
export default router;
