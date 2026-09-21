import express from 'express';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from '../docs/swagger.js';
import prisma from '../config/db.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { authenticate } from '../middleware/auth.js';
import { requireCapability, requireAdmin } from '../middleware/permission.js';
import authRoutes from './authRoutes.js';

const router = express.Router();

/**
 * @swagger
 * /health:
 *   get:
 *     summary: System health check
 *     tags: [System]
 *     responses:
 *       200:
 *         description: Service is healthy and database is connected
 *       503:
 *         description: Database is disconnected
 */
router.get('/health', async (req, res) => {
  try {
    // Quick ping to database
    await prisma.$queryRaw`SELECT 1`;
    return sendSuccess(res, { status: 'healthy', database: 'connected' }, 'Service is operational.');
  } catch (err) {
    return sendError(res, 'Database connection failure', 503, 'SERVICE_UNAVAILABLE', {
      details: err.message,
    });
  }
});

// Swagger Interactive API Documentation
router.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Authentication routes
router.use('/api/auth', authRoutes);

// Demonstration capability verification routes
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
