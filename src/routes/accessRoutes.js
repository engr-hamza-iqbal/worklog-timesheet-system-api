import express from 'express';
import {
  handleGetCapabilities,
  handleGetUserGrants,
  handleGrantCapability,
  handleRevokeCapability,
  handleGetAuditLogs,
} from '../controllers/accessController.js';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/permission.js';

const router = express.Router();

router.use(authenticate);

// Publicly readable by all authenticated users (to display capability names)
router.get('/capabilities', handleGetCapabilities);

// Administrator-only capability granting, revoking, and audit logs
router.use(requireAdmin());

router.get('/users/:userId/grants', handleGetUserGrants);
router.post('/grants', handleGrantCapability);
router.post('/grants/:grantId/revoke', handleRevokeCapability);
router.get('/audit-logs', handleGetAuditLogs);

export default router;
