const express = require('express');
const cors = require('cors');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const { sendError } = require('./utils/response');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mount all routes (/health, /api-docs, /api/auth, etc.)
app.use('/', routes);

// 404 Catch-All Handler
app.use((req, res) => {
  return sendError(res, `Route not found: ${req.method} ${req.originalUrl}`, 404, 'NOT_FOUND');
});

// Centralized Error Handler
app.use(errorHandler);

module.exports = app;
