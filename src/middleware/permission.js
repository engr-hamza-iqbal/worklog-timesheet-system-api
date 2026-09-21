const { checkUserCapability } = require('../services/accessService');
const { sendError } = require('../utils/response');

/**
 * Higher-order middleware that enforces capability requirements on endpoints.
 * Evaluates in real-time from the database to ensure immediate revocation.
 * 
 * @param {string} capabilityCode - Required CapabilityCode
 * @param {Function} [scopeExtractor] - Optional function (req) => ({ targetProjectId, targetUserId })
 */
function requireCapability(capabilityCode, scopeExtractor = null) {
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

/**
 * Strictly ensures the user is an ADMINISTRATOR.
 * Used exclusively for access management and capability granting screens.
 */
function requireAdmin() {
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

module.exports = {
  requireCapability,
  requireAdmin,
};
