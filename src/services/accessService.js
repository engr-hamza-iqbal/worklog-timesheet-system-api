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
        allowedProjects: [],
        allowedUsers: [],
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
      scopes: {
        include: {
          targetProject: { select: { id: true, name: true } },
          targetUser: { select: { id: true, name: true, email: true } },
        },
      },
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
        allowedProjects: [],
        allowedUsers: [],
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
            capabilityMap[code].allowedProjects.push({
              id: scope.targetProjectId,
              name: scope.targetProject?.name || scope.targetProjectId,
            });
          }
        } else if (scope.scopeType === 'USER' && scope.targetUserId) {
          if (!capabilityMap[code].allowedUserIds.includes(scope.targetUserId)) {
            capabilityMap[code].allowedUserIds.push(scope.targetUserId);
            capabilityMap[code].allowedUsers.push({
              id: scope.targetUserId,
              name: scope.targetUser?.name || scope.targetUserId,
              email: scope.targetUser?.email || '',
            });
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

  const hasTarget = Boolean(
    scope.targetProjectId ||
    scope.targetUserId ||
    scope.targetClientId ||
    (Array.isArray(scope.targetProjectIds) && scope.targetProjectIds.length > 0) ||
    (Array.isArray(scope.targetUserIds) && scope.targetUserIds.length > 0)
  );

  // If no target project or user was specified in scope (e.g. general route check like GET /api/reports),
  // holding this capability (whether global or scoped to any project/user) grants general access.
  if (!hasTarget) {
    return Boolean(
      capability.isGlobal ||
      (Array.isArray(capability.allowedProjectIds) && capability.allowedProjectIds.length > 0) ||
      (Array.isArray(capability.allowedUserIds) && capability.allowedUserIds.length > 0)
    );
  }

  // 1. Client constraint: if targetClientId is checked, client must have at least one allowed project
  if (scope.targetClientId) {
    if (capability.allowedProjectIds.length > 0) {
      const clientHasProject = await prisma.project.findFirst({
        where: {
          clientId: scope.targetClientId,
          id: { in: capability.allowedProjectIds },
        },
        select: { id: true },
      });
      if (!clientHasProject) {
        return false;
      }
    } else if (capability.allowedUserIds.length > 0) {
      // User-scoped capabilities do not grant client-level actions
      return false;
    }
  }

  // 2. User constraint: if capability is scoped to specific users, all targeted users must be in allowedUserIds
  if (capability.allowedUserIds.length > 0) {
    if (scope.targetUserId && !capability.allowedUserIds.includes(scope.targetUserId)) {
      return false;
    }
    if (Array.isArray(scope.targetUserIds) && scope.targetUserIds.length > 0) {
      const allAllowed = scope.targetUserIds.every((uid) => capability.allowedUserIds.includes(uid));
      if (!allAllowed) return false;
    }
    // If only scoped to users, but action targets a project without specifying an allowed target user, deny
    if ((scope.targetProjectId || (Array.isArray(scope.targetProjectIds) && scope.targetProjectIds.length > 0)) &&
        !scope.targetUserId && (!Array.isArray(scope.targetUserIds) || scope.targetUserIds.length === 0)) {
      return false;
    }
  }

  // 3. Project constraint: if capability is scoped to specific projects, all targeted projects must be in allowedProjectIds
  if (capability.allowedProjectIds.length > 0) {
    if (scope.targetProjectId && !capability.allowedProjectIds.includes(scope.targetProjectId)) {
      return false;
    }
    if (Array.isArray(scope.targetProjectIds) && scope.targetProjectIds.length > 0) {
      const allAllowed = scope.targetProjectIds.every((pid) => capability.allowedProjectIds.includes(pid));
      if (!allAllowed) return false;
    }

    // If scoped to projects and checking target user(s) without a target project,
    // verify the target user is assigned to at least one allowed project
    if (capability.allowedUserIds.length === 0 && !scope.targetProjectId && (!scope.targetProjectIds || scope.targetProjectIds.length === 0)) {
      if (scope.targetUserId) {
        const isAssigned = await prisma.projectAssignment.findFirst({
          where: {
            userId: scope.targetUserId,
            projectId: { in: capability.allowedProjectIds },
            removedAt: null,
          },
          select: { id: true },
        });
        if (!isAssigned) {
          return false;
        }
      }
      if (Array.isArray(scope.targetUserIds) && scope.targetUserIds.length > 0) {
        for (const uid of scope.targetUserIds) {
          const isAssigned = await prisma.projectAssignment.findFirst({
            where: {
              userId: uid,
              projectId: { in: capability.allowedProjectIds },
              removedAt: null,
            },
            select: { id: true },
          });
          if (!isAssigned) {
            return false;
          }
        }
      }
    }
  } else if (!capability.isGlobal && (scope.targetProjectId || (Array.isArray(scope.targetProjectIds) && scope.targetProjectIds.length > 0))) {
    // If the capability itself is not scoped by project (e.g. ASSIGN_PROJECTS scoped to users),
    // but the actor has other project constraints (e.g. MANAGE_USERS or MANAGE_CLIENTS_PROJECTS scoped to projects),
    // enforce that target project operations cannot exceed the actor's permitted project boundaries.
    const fallbackProjects = new Set();
    const manageUsers = userCapabilities['MANAGE_USERS'];
    if (manageUsers && !manageUsers.isGlobal && Array.isArray(manageUsers.allowedProjectIds) && manageUsers.allowedProjectIds.length > 0) {
      manageUsers.allowedProjectIds.forEach((id) => fallbackProjects.add(id));
    }
    const manageClients = userCapabilities['MANAGE_CLIENTS_PROJECTS'];
    if (manageClients && !manageClients.isGlobal && Array.isArray(manageClients.allowedProjectIds) && manageClients.allowedProjectIds.length > 0) {
      manageClients.allowedProjectIds.forEach((id) => fallbackProjects.add(id));
    }
    if (fallbackProjects.size > 0) {
      if (scope.targetProjectId && !fallbackProjects.has(scope.targetProjectId)) {
        return false;
      }
      if (Array.isArray(scope.targetProjectIds) && scope.targetProjectIds.length > 0) {
        const allAllowed = scope.targetProjectIds.every((pid) => fallbackProjects.has(pid));
        if (!allAllowed) return false;
      }
    }
  }

  return true;
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
          targetUser: { select: { id: true, name: true, email: true } },
          targetProject: {
            select: {
              id: true,
              name: true,
              client: { select: { id: true, name: true } },
            },
          },
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

  if (scopeType === 'PROJECT' && (!Array.isArray(targetProjectIds) || targetProjectIds.length === 0)) {
    const error = new Error('At least one project target is required for a project-scoped grant.');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  if (scopeType === 'USER' && (!Array.isArray(targetUserIds) || targetUserIds.length === 0)) {
    const error = new Error('At least one user target is required for a user-scoped grant.');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
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

  // Business Rule: Nobody may revoke capabilities from themselves
  if (actorId === grant.userId) {
    const error = new Error('You cannot revoke capabilities from your own account.');
    error.statusCode = 403;
    error.code = 'SELF_REVOCATION_FORBIDDEN';
    throw error;
  }

  const result = await prisma.$transaction(async (tx) => {
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
 * Revoke multiple capability grants immediately
 */
export async function revokeCapabilities({ actorId, grantIds }) {
  if (!Array.isArray(grantIds) || grantIds.length === 0) {
    const error = new Error('No grant IDs provided for revocation.');
    error.statusCode = 400;
    error.code = 'INVALID_ARGUMENTS';
    throw error;
  }

  const grants = await prisma.capabilityGrant.findMany({
    where: {
      id: { in: grantIds },
      revokedAt: null,
    },
    include: { capability: true },
  });

  if (grants.length === 0) {
    return [];
  }

  // Business Rule: Nobody may revoke capabilities from themselves
  const targetGrants = grants.filter((g) => g.userId !== actorId);
  if (targetGrants.length === 0) {
    if (grants.some((g) => g.userId === actorId)) {
      const error = new Error('You cannot revoke capabilities from your own account.');
      error.statusCode = 403;
      error.code = 'SELF_REVOCATION_FORBIDDEN';
      throw error;
    }
    return [];
  }

  const now = new Date();
  const affectedUserIds = [...new Set(targetGrants.map((g) => g.userId))];

  const results = await prisma.$transaction(async (tx) => {
    await tx.capabilityGrant.updateMany({
      where: { id: { in: targetGrants.map((g) => g.id) } },
      data: {
        revokedAt: now,
        revokedById: actorId,
      },
    });

    await tx.accessAuditLog.createMany({
      data: targetGrants.map((g) => ({
        action: 'REVOKE',
        actorId,
        targetUserId: g.userId,
        capabilityCode: g.capability.code,
        grantId: g.id,
        details: { revokedAt: now },
      })),
    });

    return targetGrants;
  });

  for (const uid of affectedUserIds) {
    bustUserCache(uid);
  }

  return results;
}

/**
 * Revoke a capability from multiple users
 */
export async function revokeCapabilityFromUsers({ actorId, capabilityCode, userIds }) {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    const error = new Error('No user IDs provided.');
    error.statusCode = 400;
    error.code = 'INVALID_ARGUMENTS';
    throw error;
  }

  const capability = await prisma.capability.findUnique({
    where: { code: capabilityCode },
  });

  if (!capability) {
    const error = new Error(`Capability "${capabilityCode}" does not exist.`);
    error.statusCode = 400;
    error.code = 'INVALID_CAPABILITY';
    throw error;
  }

  const eligibleUserIds = userIds.filter((uid) => uid !== actorId);
  if (eligibleUserIds.length === 0) {
    const error = new Error('You cannot revoke capabilities from your own account.');
    error.statusCode = 403;
    error.code = 'SELF_REVOCATION_FORBIDDEN';
    throw error;
  }

  const activeGrants = await prisma.capabilityGrant.findMany({
    where: {
      userId: { in: eligibleUserIds },
      capabilityId: capability.id,
      revokedAt: null,
    },
  });

  if (activeGrants.length === 0) {
    return [];
  }

  const grantIds = activeGrants.map((g) => g.id);
  return revokeCapabilities({ actorId, grantIds });
}

/**
 * Update an existing capability grant (extend/modify expiry, update scopes)
 */
export async function updateCapabilityGrant({
  actorId,
  grantId,
  expiresAt,
  scopeType,
  targetProjectIds,
  targetUserIds,
}) {
  const grant = await prisma.capabilityGrant.findUnique({
    where: { id: grantId },
    include: {
      capability: true,
      scopes: true,
    },
  });

  if (!grant) {
    const error = new Error('Capability grant not found.');
    error.statusCode = 404;
    error.code = 'GRANT_NOT_FOUND';
    throw error;
  }

  if (grant.revokedAt) {
    const error = new Error('Cannot edit a revoked capability grant.');
    error.statusCode = 400;
    error.code = 'GRANT_REVOKED';
    throw error;
  }

  if (actorId === grant.userId) {
    const error = new Error('You cannot modify capabilities on your own account.');
    error.statusCode = 403;
    error.code = 'SELF_GRANT_FORBIDDEN';
    throw error;
  }

  // Determine if expiry is being modified
  const isExpiryProvided = expiresAt !== undefined;
  const newExpiresAt = isExpiryProvided
    ? (expiresAt ? new Date(expiresAt) : null)
    : grant.expiresAt;
  const oldExpiryTime = grant.expiresAt ? new Date(grant.expiresAt).getTime() : null;
  const newExpiryTime = newExpiresAt ? newExpiresAt.getTime() : null;
  const expiryChanged = isExpiryProvided && oldExpiryTime !== newExpiryTime;

  // Determine if scope is being modified
  const isScopeProvided = scopeType !== undefined;
  if (isScopeProvided) {
    if (scopeType === 'PROJECT' && (!Array.isArray(targetProjectIds) || targetProjectIds.length === 0)) {
      const error = new Error('At least one project target is required for a project-scoped grant.');
      error.statusCode = 400;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
    if (scopeType === 'USER' && (!Array.isArray(targetUserIds) || targetUserIds.length === 0)) {
      const error = new Error('At least one user target is required for a user-scoped grant.');
      error.statusCode = 400;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
  }
  let scopeChanged = false;
  if (isScopeProvided) {
    if (scopeType === 'GLOBAL') {
      scopeChanged = grant.scopes.length > 0;
    } else if (scopeType === 'PROJECT') {
      const oldProjectIds = grant.scopes
        .filter((s) => s.scopeType === 'PROJECT')
        .map((s) => s.targetProjectId)
        .sort();
      const newProjectIds = [...(targetProjectIds || [])].sort();
      scopeChanged =
        grant.scopes.some((s) => s.scopeType !== 'PROJECT') ||
        oldProjectIds.length !== newProjectIds.length ||
        oldProjectIds.some((id, idx) => id !== newProjectIds[idx]);
    } else if (scopeType === 'USER') {
      const oldUserIds = grant.scopes
        .filter((s) => s.scopeType === 'USER')
        .map((s) => s.targetUserId)
        .sort();
      const newUserIds = [...(targetUserIds || [])].sort();
      scopeChanged =
        grant.scopes.some((s) => s.scopeType !== 'USER') ||
        oldUserIds.length !== newUserIds.length ||
        oldUserIds.some((id, idx) => id !== newUserIds[idx]);
    }
  }

  await prisma.$transaction(async (tx) => {
    // 1. Update expiry if changed
    if (expiryChanged) {
      await tx.capabilityGrant.update({
        where: { id: grantId },
        data: { expiresAt: newExpiresAt },
      });

      await tx.accessAuditLog.create({
        data: {
          action: 'CHANGE_EXPIRY',
          actorId,
          targetUserId: grant.userId,
          capabilityCode: grant.capability.code,
          grantId: grant.id,
          details: {
            previousExpiresAt: grant.expiresAt,
            newExpiresAt,
          },
        },
      });
    }

    // 2. Update scopes if changed
    if (scopeChanged) {
      await tx.capabilityGrantScope.deleteMany({
        where: { grantId },
      });

      if (scopeType === 'PROJECT' && Array.isArray(targetProjectIds) && targetProjectIds.length > 0) {
        await tx.capabilityGrantScope.createMany({
          data: targetProjectIds.map((projectId) => ({
            grantId,
            scopeType: 'PROJECT',
            targetProjectId: projectId,
          })),
        });
      } else if (scopeType === 'USER' && Array.isArray(targetUserIds) && targetUserIds.length > 0) {
        await tx.capabilityGrantScope.createMany({
          data: targetUserIds.map((uid) => ({
            grantId,
            scopeType: 'USER',
            targetUserId: uid,
          })),
        });
      }

      await tx.accessAuditLog.create({
        data: {
          action: 'CHANGE_SCOPE',
          actorId,
          targetUserId: grant.userId,
          capabilityCode: grant.capability.code,
          grantId: grant.id,
          details: {
            newScopeType: scopeType,
            targetProjectIds: scopeType === 'PROJECT' ? targetProjectIds : [],
            targetUserIds: scopeType === 'USER' ? targetUserIds : [],
          },
        },
      });
    }
  });

  bustUserCache(grant.userId);

  return prisma.capabilityGrant.findUnique({
    where: { id: grantId },
    include: {
      capability: true,
      grantedBy: { select: { id: true, name: true, email: true } },
      scopes: {
        include: {
          targetUser: { select: { id: true, name: true, email: true } },
          targetProject: {
            select: {
              id: true,
              name: true,
              client: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });
}

/**
 * Bulk update multiple capability grants
 */
export async function updateCapabilityGrants({
  actorId,
  grantIds,
  expiresAt,
  scopeType,
  targetProjectIds,
  targetUserIds,
}) {
  if (!Array.isArray(grantIds) || grantIds.length === 0) {
    const error = new Error('No grant IDs provided for update.');
    error.statusCode = 400;
    error.code = 'INVALID_ARGUMENTS';
    throw error;
  }

  const results = [];
  for (const grantId of grantIds) {
    const updated = await updateCapabilityGrant({
      actorId,
      grantId,
      expiresAt,
      scopeType,
      targetProjectIds,
      targetUserIds,
    });
    results.push(updated);
  }

  return results;
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

/**
 * Grant multiple capabilities to a target user
 */
export async function grantCapabilitiesToUser({
  actorId,
  targetUserId,
  capabilityCodes = [],
  expiresAt = null,
  scopeType = null,
  targetUserIds = [],
  targetProjectIds = [],
}) {
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

  const uniqueCodes = [...new Set(capabilityCodes)];
  if (uniqueCodes.length === 0) return [];

  const capabilities = await prisma.capability.findMany({
    where: { code: { in: uniqueCodes } },
  });
  if (capabilities.length === 0) return [];

  const now = new Date();
  const existingActiveGrants = await prisma.capabilityGrant.findMany({
    where: {
      userId: targetUserId,
      capabilityId: { in: capabilities.map((c) => c.id) },
      revokedAt: null,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: now } },
      ],
    },
    select: { capabilityId: true },
  });

  const activeCapIdSet = new Set(existingActiveGrants.map((g) => g.capabilityId));
  const capsToGrant = capabilities.filter((c) => !activeCapIdSet.has(c.id));

  if (capsToGrant.length === 0) {
    return [];
  }

  if (scopeType === 'PROJECT' && (!Array.isArray(targetProjectIds) || targetProjectIds.length === 0)) {
    const error = new Error('At least one project target is required for a project-scoped grant.');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  if (scopeType === 'USER' && (!Array.isArray(targetUserIds) || targetUserIds.length === 0)) {
    const error = new Error('At least one user target is required for a user-scoped grant.');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const expiryDate = expiresAt ? new Date(expiresAt) : null;

  const results = await prisma.$transaction(async (tx) => {
    const createdGrants = [];

    for (const capability of capsToGrant) {
      const g = await tx.capabilityGrant.create({
        data: {
          userId: targetUserId,
          capabilityId: capability.id,
          grantedById: actorId,
          expiresAt: expiryDate,
        },
      });

      if (scopeType === 'PROJECT' && Array.isArray(targetProjectIds) && targetProjectIds.length > 0) {
        await tx.capabilityGrantScope.createMany({
          data: targetProjectIds.map((projectId) => ({
            grantId: g.id,
            scopeType: 'PROJECT',
            targetProjectId: projectId,
          })),
        });
      } else if (scopeType === 'USER' && Array.isArray(targetUserIds) && targetUserIds.length > 0) {
        await tx.capabilityGrantScope.createMany({
          data: targetUserIds.map((uid) => ({
            grantId: g.id,
            scopeType: 'USER',
            targetUserId: uid,
          })),
        });
      }

      await tx.accessAuditLog.create({
        data: {
          action: 'GRANT',
          actorId,
          targetUserId,
          capabilityCode: capability.code,
          grantId: g.id,
          details: {
            scopeType: scopeType || 'GLOBAL',
            expiresAt,
            targetUserIds,
            targetProjectIds,
          },
        },
      });

      createdGrants.push(g);
    }

    return createdGrants;
  });

  bustUserCache(targetUserId);
  return results;
}

/**
 * Grant one capability to multiple target users
 */
export async function grantCapabilityToUsers({
  actorId,
  targetUserIds = [],
  capabilityCode,
  expiresAt = null,
  scopeType = null,
  targetScopeUserIds = [],
  targetProjectIds = [],
}) {
  const capability = await prisma.capability.findUnique({ where: { code: capabilityCode } });
  if (!capability) {
    const error = new Error(`Capability "${capabilityCode}" does not exist.`);
    error.statusCode = 400;
    error.code = 'INVALID_CAPABILITY';
    throw error;
  }

  const uniqueUserIds = [...new Set(targetUserIds)].filter((uid) => uid !== actorId);
  if (uniqueUserIds.length === 0) return [];

  const eligibleUsers = await prisma.user.findMany({
    where: { id: { in: uniqueUserIds }, isActive: true },
    select: { id: true },
  });
  if (eligibleUsers.length === 0) return [];

  const eligibleUserIds = eligibleUsers.map((u) => u.id);
  const now = new Date();
  const existingActive = await prisma.capabilityGrant.findMany({
    where: {
      userId: { in: eligibleUserIds },
      capabilityId: capability.id,
      revokedAt: null,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: now } },
      ],
    },
    select: { userId: true },
  });

  const alreadyGrantedUserIdSet = new Set(existingActive.map((g) => g.userId));
  const userIdsToGrant = eligibleUserIds.filter((uid) => !alreadyGrantedUserIdSet.has(uid));
  if (userIdsToGrant.length === 0) return [];

  const expiryDate = expiresAt ? new Date(expiresAt) : null;

  const results = await prisma.$transaction(async (tx) => {
    const createdGrants = [];

    for (const uid of userIdsToGrant) {
      const g = await tx.capabilityGrant.create({
        data: {
          userId: uid,
          capabilityId: capability.id,
          grantedById: actorId,
          expiresAt: expiryDate,
        },
      });

      if (scopeType === 'PROJECT' && Array.isArray(targetProjectIds) && targetProjectIds.length > 0) {
        await tx.capabilityGrantScope.createMany({
          data: targetProjectIds.map((projectId) => ({
            grantId: g.id,
            scopeType: 'PROJECT',
            targetProjectId: projectId,
          })),
        });
      } else if (scopeType === 'USER' && Array.isArray(targetScopeUserIds) && targetScopeUserIds.length > 0) {
        await tx.capabilityGrantScope.createMany({
          data: targetScopeUserIds.map((tuid) => ({
            grantId: g.id,
            scopeType: 'USER',
            targetUserId: tuid,
          })),
        });
      }

      await tx.accessAuditLog.create({
        data: {
          action: 'GRANT',
          actorId,
          targetUserId: uid,
          capabilityCode,
          grantId: g.id,
          details: {
            scopeType: scopeType || 'GLOBAL',
            expiresAt,
            targetScopeUserIds,
            targetProjectIds,
          },
        },
      });

      createdGrants.push(g);
    }

    return createdGrants;
  });

  for (const uid of userIdsToGrant) {
    bustUserCache(uid);
  }

  return results;
}

export default {
  ALL_CAPABILITIES,
  getUserActiveCapabilities,
  checkUserCapability,
  getSystemCapabilities,
  getUserGrants,
  grantCapability,
  grantCapabilitiesToUser,
  grantCapabilityToUsers,
  revokeCapability,
  revokeCapabilities,
  revokeCapabilityFromUsers,
  updateCapabilityGrant,
  updateCapabilityGrants,
  getAccessAuditLogs,
};
