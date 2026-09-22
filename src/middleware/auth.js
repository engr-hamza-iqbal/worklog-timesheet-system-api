import jwt from 'jsonwebtoken';
import prisma from '../config/db.js';
import { JWT_SECRET } from '../config/env.js';
import { sendError } from '../utils/response.js';

// ── User cache ────────────────────────────────────────────────────────────────
// Short-lived (30 s) in-memory cache keyed by userId.
// Eliminates a Supabase round-trip on every authenticated API request.
// Cache entry is automatically stale after TTL_MS; a deactivated account
// takes at most one TTL cycle to propagate (acceptable for this use case).
const USER_CACHE = new Map(); // userId → { user, expiresAt }
const TTL_MS = 30_000; // 30 seconds

function getCachedUser(userId) {
  const entry = USER_CACHE.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    USER_CACHE.delete(userId);
    return null;
  }
  return entry.user;
}

function setCachedUser(userId, user) {
  USER_CACHE.set(userId, { user, expiresAt: Date.now() + TTL_MS });
}

// Allow other code (e.g. deactivation endpoint) to immediately bust a user's cache entry.
export function bustUserCache(userId) {
  USER_CACHE.delete(userId);
}

// ── Middleware ─────────────────────────────────────────────────────────────────
export async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendError(res, 'Authentication required. Please provide a Bearer token.', 401, 'UNAUTHORIZED');
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { userId } = decoded;

    // Try cache first — avoids a Supabase round-trip on every request
    let user = getCachedUser(userId);

    if (!user) {
      user = await prisma.user.findUnique({
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

      setCachedUser(userId, user);
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
