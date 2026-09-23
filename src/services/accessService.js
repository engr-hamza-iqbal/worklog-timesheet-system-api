import prisma from '../config/db.js';
import { bustUserCache } from '../middleware/auth.js';

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

  const hasTarget = Boolean(scope.targetProjectId || scope.targetUserId);
  if (!hasTarget) return false;

  const projectAllowed = scope.targetProjectId
    && capability.allowedProjectIds.includes(scope.targetProjectId);
  const userAllowed = scope.targetUserId
    && capability.allowedUserIds.includes(scope.targetUserId);

  return Boolean(projectAllowed || userAllowed);
}

/**
 * List all master system capabilities
 */
export async function getSystemCapabilities() {
  return prisma.capability.findMany({
    orderBy: { code: 'asc' },
  });
}

/**
 * Get all active and past grants for a user with scope details
 */
export async function getUserGrants(userId) {
  const grants = await prisma.capabilityGrant.findMany({
    where: { userId },
    include: {
      capability: true,
      grantedBy: {
        select: { id: true, name: true, email: true },
      },
      revokedBy: {
        select: { id: true, name: true, email: true },
      },
      scopes: {
        include: {
          targetUser: { select: { id: true, name: true } },
          targetProject: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return grants;
}

/**
 * Grant capability to a user with optional scoping and expiry
 */
export async function grantCapability({
  actorId,
  targetUserId,
  capabilityCode,
  expiresAt = null,
  scopeType = null,
  targetUserIds = [],
  targetProjectIds = [],
}) {
  // Business Rule: Nobody may grant access to themselves
  if (actorId === targetUserId) {
    const error = new Error('You cannot grant capabilities to your own account.');
    error.statusCode = 403;
    error.code = 'SELF_GRANT_FORBIDDEN';
    throw error;
  }

  const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!targetUser) {
    const error = new Error('Target user not found.');
    error.statusCode = 404;
    error.code = 'USER_NOT_FOUND';
    throw error;
  }

  const capability = await prisma.capability.findUnique({ where: { code: capabilityCode } });
  if (!capability) {
    const error = new Error(`Capability "${capabilityCode}" does not exist.`);
    error.statusCode = 400;
    error.code = 'INVALID_CAPABILITY';
    throw error;
  }

  // Check if user already holds an active, unexpired grant for this capability
  const existingActive = await prisma.capabilityGrant.findFirst({
    where: {
      userId: targetUserId,
      capabilityId: capability.id,
      revokedAt: null,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
  });

  if (existingActive) {
    const error = new Error(`User already holds an active grant for capability "${capabilityCode}".`);
    error.statusCode = 409;
    error.code = 'CAPABILITY_ALREADY_GRANTED';
    throw error;
  }

  const result = await prisma.$transaction(async (tx) => {
    // 1. Create the grant
    const grant = await tx.capabilityGrant.create({
      data: {
        userId: targetUserId,
        capabilityId: capability.id,
        grantedById: actorId,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });

    // 2. Create scopes if specified
    if (scopeType === 'PROJECT' && Array.isArray(targetProjectIds) && targetProjectIds.length > 0) {
      await tx.capabilityGrantScope.createMany({
        data: targetProjectIds.map((projectId) => ({
          grantId: grant.id,
          scopeType: 'PROJECT',
          targetProjectId: projectId,
        })),
      });
    } else if (scopeType === 'USER' && Array.isArray(targetUserIds) && targetUserIds.length > 0) {
      await tx.capabilityGrantScope.createMany({
        data: targetUserIds.map((uid) => ({
          grantId: grant.id,
          scopeType: 'USER',
          targetUserId: uid,
        })),
      });
    }

    // 3. Write to AccessAuditLog
    await tx.accessAuditLog.create({
      data: {
        action: 'GRANT',
        actorId,
        targetUserId,
        capabilityCode,
        grantId: grant.id,
        details: {
          scopeType: scopeType || 'GLOBAL',
          expiresAt,
          targetUserIds,
          targetProjectIds,
        },
      },
    });

    return grant;
  });

  bustUserCache(targetUserId);
  return result;
}

/**
 * Revoke capability grant immediately
 */
export async function revokeCapability({ actorId, grantId }) {
  const grant = await prisma.capabilityGrant.findUnique({
    where: { id: grantId },
    include: { capability: true },
  });

  if (!grant) {
    const error = new Error('Capability grant not found.');
    error.statusCode = 404;
    error.code = 'GRANT_NOT_FOUND';
    throw error;
  }

  if (grant.revokedAt) {
    return grant; // Already revoked
  }

  return prisma.$transaction(async (tx) => {
    const updatedGrant = await tx.capabilityGrant.update({
      where: { id: grantId },
      data: {
        revokedAt: new Date(),
        revokedById: actorId,
      },
    });

    // Write to AccessAuditLog
    await tx.accessAuditLog.create({
      data: {
        action: 'REVOKE',
        actorId,
        targetUserId: grant.userId,
        capabilityCode: grant.capability.code,
        grantId: grant.id,
        details: {
          revokedAt: new Date(),
        },
      },
    });

    return updatedGrant;
  });

  bustUserCache(grant.userId);
  return result;
}

/**
 * View paginated access audit logs
 */
export async function getAccessAuditLogs({ limit = 50, offset = 0 } = {}) {
  const [logs, total] = await Promise.all([
    prisma.accessAuditLog.findMany({
      take: Math.min(Number(limit) || 50, 100),
      skip: Number(offset) || 0,
      include: {
        actor: { select: { id: true, name: true, email: true } },
        targetUser: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.accessAuditLog.count(),
  ]);

  return { logs, total };
}

export default {
  ALL_CAPABILITIES,
  getUserActiveCapabilities,
  checkUserCapability,
  getSystemCapabilities,
  getUserGrants,
  grantCapability,
  revokeCapability,
  getAccessAuditLogs,
};
