const jwt = require('jsonwebtoken');
const prisma = require('../config/db');
const { JWT_SECRET } = require('../config/env');
const { sendError } = require('../utils/response');

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendError(res, 'Authentication required. Please provide a Bearer token.', 401, 'UNAUTHORIZED');
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Look up fresh user record from database
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        name: true,
        email: true,
        accountType: true,
        isActive: true,
      },
    });

    if (!user) {
      return sendError(res, 'User account no longer exists.', 401, 'USER_NOT_FOUND');
    }

    if (!user.isActive) {
      return sendError(res, 'This account has been deactivated. Access denied.', 403, 'ACCOUNT_DEACTIVATED');
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return sendError(res, 'Session token has expired. Please log in again.', 401, 'TOKEN_EXPIRED');
    }
    return sendError(res, 'Invalid authentication token.', 401, 'INVALID_TOKEN');
  }
}

module.exports = {
  authenticate,
};
