/**
 * Standardized API response format helpers
 */

function sendSuccess(res, data = {}, message = null, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
}

function sendError(res, message, statusCode = 400, code = 'BAD_REQUEST', details = null) {
  return res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  });
}

module.exports = {
  sendSuccess,
  sendError,
};
