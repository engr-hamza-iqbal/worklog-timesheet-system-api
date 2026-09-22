import { checkUserCapability } from '../services/accessService.js';
import { sendError } from '../utils/response.js';

export function requireCapability(capabilityCode, scopeExtractor = null) {
  return async (req, res, next) => {
    if (!req.user) {
      return sendError(res, 'Authentication required before permission evaluation.', 401, 'UNAUTHORIZED');
    }

    let scope = {};
    if (typeof scopeExtractor === 'function') {
      try {
        scope = scopeExtractor(req) || {};
      } catch (e) {
        return sendError(res, 'Invalid request scope parameters.', 400, 'INVALID_SCOPE');
      }
    }

    const hasPermission = await checkUserCapability(req.user, capabilityCode, scope);

    if (!hasPermission) {
      return sendError(
        res,
        `Access denied. You do not hold the required capability (${capabilityCode}) or lack the necessary project/user scope.`,
        403,
        'INSUFFICIENT_PERMISSIONS',
        { requiredCapability: capabilityCode, targetScope: scope }
      );
    }

    next();
  };
}

export function requireAdmin() {
  return (req, res, next) => {
    if (!req.user) {
      return sendError(res, 'Authentication required.', 401, 'UNAUTHORIZED');
    }

    if (req.user.accountType !== 'ADMIN') {
      return sendError(res, 'This operation requires Administrator privileges.', 403, 'ADMIN_REQUIRED');
    }

    next();
  };
}

export default {
  requireCapability,
  requireAdmin,
};
