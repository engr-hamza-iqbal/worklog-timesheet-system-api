import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/permission.js';
import {
  handleGetTypes,
  handleCreateType,
  handleUpdateType,
  handleGetRequests,
  handleCreateRequest,
  handleCancelRequest,
  handleDecideRequest,
} from '../controllers/timeOffController.js';

const router = express.Router();
router.use(authenticate);

router.get('/types', handleGetTypes);
router.post('/types', requireAdmin(), handleCreateType);
router.put('/types/:id', requireAdmin(), handleUpdateType);
router.get('/requests', handleGetRequests);
router.post('/requests', handleCreateRequest);
router.post('/requests/:id/cancel', handleCancelRequest);
router.post('/requests/:id/decide', handleDecideRequest);

export default router;
