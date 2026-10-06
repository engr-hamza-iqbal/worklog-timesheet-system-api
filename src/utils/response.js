
export function sendSuccess(res, data = {}, message = null, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
}

export function sendError(res, message, statusCode = 400, code = 'BAD_REQUEST', details = null) {
  const isServerError = statusCode >= 500;
  return res.status(statusCode).json({
    success: false,
    error: {
      code: isServerError ? 'INTERNAL_ERROR' : code,
      message: isServerError ? 'Internal server error.' : message,
      ...(!isServerError && details ? { details } : {}),
    },
  });
}

export default {
  sendSuccess,
  sendError,
};
