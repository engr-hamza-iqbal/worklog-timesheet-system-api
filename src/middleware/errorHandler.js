const { sendError } = require('../utils/response');

function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';
  const code = err.code || 'INTERNAL_ERROR';

  // Only log unexpected server errors (500+)
  if (statusCode >= 500) {
    console.error('Internal Server Error:', err);
  }

  if (err.name === 'JsonWebTokenError') {
    return sendError(res, 'Invalid authentication token', 401, 'INVALID_TOKEN');
  }

  if (err.name === 'TokenExpiredError') {
    return sendError(res, 'Authentication token has expired', 401, 'TOKEN_EXPIRED');
  }

  if (err.code === 'P2002') {
    return sendError(res, 'A unique constraint was violated', 409, 'CONFLICT', {
      target: err.meta?.target,
    });
  }

  return sendError(res, message, statusCode, code);
}

module.exports = errorHandler;
