import express from 'express';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from '../docs/swagger.js';
import prisma from '../config/db.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { authenticate } from '../middleware/auth.js';
import { requireCapability, requireAdmin } from '../middleware/permission.js';

import authRoutes from './authRoutes.js';
import clientProjectRoutes from './clientProjectRoutes.js';
import userRoutes from './userRoutes.js';
import accessRoutes from './accessRoutes.js';
import timeEntryRoutes from './timeEntryRoutes.js';
import reviewRoutes from './reviewRoutes.js';
import timeOffRoutes from './timeOffRoutes.js';
import reportRoutes from './reportRoutes.js';

const router = express.Router();

router.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return sendSuccess(res, { status: 'healthy', database: 'connected' }, 'Service is operational.');
  } catch (err) {
    return sendError(res, 'Database connection failure', 503, 'SERVICE_UNAVAILABLE', {
      details: err.message,
    });
  }
});

router.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// API Modules
router.use('/api/auth', authRoutes);
router.use('/api', clientProjectRoutes);
router.use('/api', userRoutes);
router.use('/api/access', accessRoutes);
router.use('/api/timesheets', timeEntryRoutes);
router.use('/api/reviews', reviewRoutes);
router.use('/api/time-off', timeOffRoutes);
router.use('/api/reports', reportRoutes);

// Capability test endpoints
router.get(
  '/api/test/reports-access',
  authenticate,
  requireCapability('VIEW_REPORTS'),
  (req, res) => {
    return sendSuccess(res, { granted: true }, 'Access granted to reports feature.');
  }
);

router.get(
  '/api/test/admin-only',
  authenticate,
  requireAdmin(),
  (req, res) => {
    return sendSuccess(res, { granted: true }, 'Access granted to administrator feature.');
  }
);

export default router;
