import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/permission.js';
import { handleGetEmailLogs, handleSendTestEmail } from '../controllers/emailController.js';

const router = express.Router();
router.use(authenticate);

// Email log is administrator only as stated in req.md
router.get('/', requireAdmin(), handleGetEmailLogs);
router.post('/test', requireAdmin(), handleSendTestEmail);

export default router;
