const express = require('express');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('../docs/swagger');
const prisma = require('../config/db');
const { sendSuccess, sendError } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireCapability, requireAdmin } = require('../middleware/permission');
const authRoutes = require('./authRoutes');

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

module.exports = router;
