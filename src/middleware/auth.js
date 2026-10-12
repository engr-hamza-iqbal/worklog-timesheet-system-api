import jwt from 'jsonwebtoken';
import prisma from '../config/db.js';
import { JWT_SECRET } from '../config/env.js';
import { sendError } from '../utils/response.js';
import { notifyUserAccessChanged } from '../utils/eventStream.js';
import { bustActiveCapabilitiesCache } from '../services/accessService.js';

// High-speed user session cache (30-second TTL)
const userCache = new Map();
const USER_CACHE_TTL_MS = 30000;

export function bustUserCache(userId) {
  if (userId) {
    userCache.delete(userId);
  } else {
    userCache.clear();
  }
  bustActiveCapabilitiesCache(userId);
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

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { userId } = decoded;

    let user = null;
    const now = Date.now();
    const cached = userCache.get(userId);

    if (cached && cached.expiresAt > now) {
      user = cached.user;
    } else {
      user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          accountType: true,
          isActive: true,
          createdAt: true,
        },
      });

      if (user && user.isActive) {
        userCache.set(userId, { user, expiresAt: now + USER_CACHE_TTL_MS });
      }
    }

    if (!user) {
      return sendError(res, 'User account no longer exists.', 401, 'USER_NOT_FOUND');
    }

    if (!user.isActive) {
      userCache.delete(userId);
      return sendError(res, 'This account has been deactivated. Access denied.', 403, 'ACCOUNT_DEACTIVATED');
    }

    req.user = { ...user };
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
