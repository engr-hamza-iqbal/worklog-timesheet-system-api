import prisma from '../config/db.js';

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

export async function getUserActiveCapabilities(user) {
  if (!user || !user.isActive) {
    return {};
  }

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

export async function checkUserCapability(user, capabilityCode, scope = {}) {
  if (!user || !user.isActive) {
    return false;
  }

  if (user.accountType === 'ADMIN') {
    return true;
  }

  const userCapabilities = await getUserActiveCapabilities(user);
  const capability = userCapabilities[capabilityCode];

  if (!capability) {
    return false;
  }

  if (capability.isGlobal) {
    return true;
  }

  if (scope.targetProjectId) {
    return capability.allowedProjectIds.includes(scope.targetProjectId);
  }

  if (scope.targetUserId) {
    return capability.allowedUserIds.includes(scope.targetUserId);
  }

  return true;
}

export default {
  ALL_CAPABILITIES,
  getUserActiveCapabilities,
  checkUserCapability,
};
