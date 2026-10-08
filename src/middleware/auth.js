import jwt from 'jsonwebtoken';
import prisma from '../config/db.js';
import { JWT_SECRET } from '../config/env.js';
import { sendError } from '../utils/response.js';
import { notifyUserAccessChanged } from '../utils/eventStream.js';

const revokedTokens = new Set();

export function revokeToken(token) {
  if (token && typeof token === 'string') {
    revokedTokens.add(token.trim());
  }
}

export function isTokenRevoked(token) {
  if (!token || typeof token !== 'string') return false;
  return revokedTokens.has(token.trim());
}

export function bustUserCache(userId) {
  notifyUserAccessChanged(userId, { type: 'CAPABILITIES_CHANGED', userId });
}

// ── Middleware ─────────────────────────────────────────────────────────────────
export async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  const rawCookieToken = req.headers.cookie?.match(/(?:^|;\s*)worklog_session=([^;]+)/)?.[1];
  const cookieToken = rawCookieToken ? decodeURIComponent(rawCookieToken) : null;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length)
    : cookieToken;

  if (!token) {
    return sendError(res, 'Authentication required. Please provide a Bearer token.', 401, 'UNAUTHORIZED');
  }

  if (isTokenRevoked(token)) {
    return sendError(res, 'Session has been logged out. Please sign in again.', 401, 'UNAUTHORIZED');
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { userId } = decoded;

    const user = await prisma.user.findUnique({
      where: { id: userId },
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
      return sendError(res, 'Session has expired. Please log in again.', 401, 'TOKEN_EXPIRED');
    }
    return sendError(res, 'Invalid authentication token.', 401, 'INVALID_TOKEN');
  }
}

export default {
  authenticate,
  bustUserCache,
};
