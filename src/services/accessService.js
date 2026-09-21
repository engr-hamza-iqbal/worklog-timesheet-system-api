import prisma from '../config/db.js';

// All 9 system capabilities as defined by schema and requirements
export const ALL_CAPABILITIES = [
  'VIEW_OTHER_RECORDS',
  'REVIEW_TIME',
  'DECIDE_TIME_OFF',
  'MANAGE_CLIENTS_PROJECTS',
  'ASSIGN_PROJECTS',
  'MANAGE_USERS',
  'VIEW_REPORTS',
  'VIEW_ANALYTICS',
  'VIEW_BILLING',
];

/**
 * Resolves all active capabilities and scopes for a user in real-time.
 * Administrator accounts hold all capabilities globally.
 * Employee accounts resolve active grants from the database.
 * 
 * @param {Object} user - { id, accountType, isActive }
 * @returns {Promise<Object>} Map of capability code to { isGlobal: boolean, allowedProjectIds: string[], allowedUserIds: string[] }
 */
export async function getUserActiveCapabilities(user) {
  if (!user || !user.isActive) {
    return {};
  }

  // Administrators inherently hold all capabilities globally
  if (user.accountType === 'ADMIN') {
    const adminCapabilities = {};
    for (const code of ALL_CAPABILITIES) {
      adminCapabilities[code] = {
        isGlobal: true,
        allowedProjectIds: [],
        allowedUserIds: [],
      };
    }
    return adminCapabilities;
  }

  // Query database for active grants for this employee
  const now = new Date();
  const activeGrants = await prisma.capabilityGrant.findMany({
    where: {
      userId: user.id,
      revokedAt: null,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: now } },
      ],
    },
    include: {
      capability: true,
      scopes: true,
    },
  });

  const capabilityMap = {};

  for (const grant of activeGrants) {
    const code = grant.capability.code;

    if (!capabilityMap[code]) {
      capabilityMap[code] = {
        isGlobal: false,
        allowedProjectIds: [],
        allowedUserIds: [],
      };
    }

    // 0 scopes means the grant is GLOBAL
    if (!grant.scopes || grant.scopes.length === 0) {
      capabilityMap[code].isGlobal = true;
    } else {
      for (const scope of grant.scopes) {
        if (scope.scopeType === 'PROJECT' && scope.targetProjectId) {
          if (!capabilityMap[code].allowedProjectIds.includes(scope.targetProjectId)) {
            capabilityMap[code].allowedProjectIds.push(scope.targetProjectId);
          }
        } else if (scope.scopeType === 'USER' && scope.targetUserId) {
          if (!capabilityMap[code].allowedUserIds.includes(scope.targetUserId)) {
            capabilityMap[code].allowedUserIds.push(scope.targetUserId);
          }
        }
      }
    }
  }

  return capabilityMap;
}

/**
 * Checks if a user possesses a specific capability, optionally evaluating project/user scope.
 * 
 * @param {Object} user - Authenticated user
 * @param {string} capabilityCode - Code from CapabilityCode enum
 * @param {Object} [scope] - { targetProjectId?: string, targetUserId?: string }
 * @returns {Promise<boolean>}
 */
export async function checkUserCapability(user, capabilityCode, scope = {}) {
  if (!user || !user.isActive) {
    return false;
  }

  // Admins have all capabilities
  if (user.accountType === 'ADMIN') {
    return true;
  }

  const userCapabilities = await getUserActiveCapabilities(user);
  const capability = userCapabilities[capabilityCode];

  if (!capability) {
    return false;
  }

  // If granted globally, permission holds everywhere
  if (capability.isGlobal) {
    return true;
  }

  // If scoped to a project
  if (scope.targetProjectId) {
    return capability.allowedProjectIds.includes(scope.targetProjectId);
  }

  // If scoped to a user
  if (scope.targetUserId) {
    return capability.allowedUserIds.includes(scope.targetUserId);
  }

  // If no specific scope parameter was requested, possession of any grant satisfies base check
  return true;
}

export default {
  ALL_CAPABILITIES,
  getUserActiveCapabilities,
  checkUserCapability,
};
