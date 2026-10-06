import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import prisma from '../config/db.js';
import { bustUserCache } from '../middleware/auth.js';
import { getUserActiveCapabilities } from './accessService.js';

/**
 * List all users with assignment counts
 */
export async function getUsers(actor = null) {
  const where = {};
  if (actor && actor.accountType !== 'ADMIN') {
    where.accountType = { not: 'ADMIN' };
    const capabilities = await getUserActiveCapabilities(actor);
    const canManageUsers = capabilities.MANAGE_USERS;
    const canAssignProjects = capabilities.ASSIGN_PROJECTS;
    const allowedUserIds = new Set([
      ...(canManageUsers?.allowedUserIds || []),
      ...(canAssignProjects?.allowedUserIds || []),
      actor.id,
    ]);
    if (!canManageUsers?.isGlobal && !canAssignProjects?.isGlobal) {
      where.id = { in: [...allowedUserIds] };
    }
  }

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      name: true,
      email: true,
      accountType: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      assignments: {
        where: { removedAt: null },
        select: {
          id: true,
          projectId: true,
          project: {
            select: { id: true, name: true, status: true },
          },
        },
      },
      capabilityGrantsReceived: {
        where: {
          revokedAt: null,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } },
          ],
        },
        select: {
          id: true,
          capability: {
            select: { code: true },
          },
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    accountType: u.accountType,
    isActive: u.isActive,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    activeAssignments: u.assignments.map((a) => a.project),
    activeCapabilitiesCount: actor?.accountType === 'ADMIN' || actor?.id === u.id ? u.capabilityGrantsReceived.length : undefined,
    activeCapabilityCodes: actor?.accountType === 'ADMIN' || actor?.id === u.id
      ? u.capabilityGrantsReceived.map((g) => g.capability.code)
      : undefined,
  }));
}

/**
 * Create a new user (EMPLOYEE or ADMIN)
 */
export async function createUser({ name, email, password, accountType = 'EMPLOYEE', actorUser = null }) {
  if (actorUser?.accountType !== 'ADMIN') {
    const capabilities = await getUserActiveCapabilities(actorUser);
    if (!capabilities.MANAGE_USERS?.isGlobal) {
      const error = new Error('Creating users requires global user-management permission.');
      error.statusCode = 403;
      error.code = 'GLOBAL_CAPABILITY_REQUIRED';
      throw error;
    }
  }
  if (accountType === 'ADMIN' && actorUser?.accountType !== 'ADMIN') {
    const error = new Error('Only an administrator can create an administrator account.');
    error.statusCode = 403;
    error.code = 'ADMIN_ACCOUNT_FORBIDDEN';
    throw error;
  }
  if (!name || !name.trim()) {
    const error = new Error('Name is required.');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const normalizedEmail = email ? email.trim().toLowerCase() : '';
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!normalizedEmail || !emailRegex.test(normalizedEmail)) {
    const error = new Error('A valid email address is required.');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  if (!password || password.length < 8) {
    const error = new Error('Password must be at least 8 characters long.');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  if (!['EMPLOYEE', 'ADMIN'].includes(accountType)) {
    const error = new Error('Account type must be either EMPLOYEE or ADMIN.');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const existing = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (existing) {
    const error = new Error('An account with this email address already exists.');
    error.statusCode = 409;
    error.code = 'EMAIL_ALREADY_EXISTS';
    throw error;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  return prisma.user.create({
    data: {
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
      accountType,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      email: true,
      accountType: true,
      isActive: true,
      createdAt: true,
    },
  });
}

/**
 * Soft-activate or deactivate user account with rule enforcement
 */
export async function updateUserStatus(userId, { isActive }, currentAdminId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    const error = new Error('User not found.');
    error.statusCode = 404;
    error.code = 'USER_NOT_FOUND';
    throw error;
  }

  // Business Rule: A user or administrator cannot deactivate themselves
  if (!isActive && userId === currentAdminId) {
    const error = new Error('You cannot deactivate your own account.');
    error.statusCode = 403;
    error.code = 'SELF_DEACTIVATION_FORBIDDEN';
    throw error;
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (!isActive && user.accountType === 'ADMIN') {
      const activeAdminCount = await tx.user.count({ where: { accountType: 'ADMIN', isActive: true } });
      if (activeAdminCount <= 1) {
        const error = new Error('Cannot deactivate the last remaining active administrator account.');
        error.statusCode = 403;
        error.code = 'LAST_ADMIN_PROTECTED';
        throw error;
      }
    }

    const result = await tx.user.updateMany({
      where: {
        id: userId,
        isActive: user.isActive,
        accountType: user.accountType,
      },
      data: { isActive },
    });
    if (result.count !== 1) {
      const error = new Error('User status changed before this update completed.');
      error.statusCode = 409;
      error.code = 'STALE_USER_UPDATE';
      throw error;
    }
    return tx.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, accountType: true, isActive: true, updatedAt: true },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  // Immediately invalidate auth cache so deactivation takes effect at once
  if (!isActive) bustUserCache(userId);

  return updated;
}

/**
 * Update user details (name, email, accountType)
 */
export async function updateUser(userId, { name, email, accountType }, actorUser = null) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    const error = new Error('User not found.');
    error.statusCode = 404;
    error.code = 'USER_NOT_FOUND';
    throw error;
  }

  const data = {};
  if (name && name.trim()) data.name = name.trim();

  if (email && email.trim().toLowerCase() !== user.email.toLowerCase()) {
    const existing = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (existing && existing.id !== userId) {
      const error = new Error('A user with this email address already exists.');
      error.statusCode = 409;
      error.code = 'EMAIL_ALREADY_EXISTS';
      throw error;
    }
    data.email = email.trim().toLowerCase();
  }

  if (accountType && accountType !== user.accountType) {
    if (!['EMPLOYEE', 'ADMIN'].includes(accountType)) {
      const error = new Error('Account type must be either EMPLOYEE or ADMIN.');
      error.statusCode = 400;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }

    if (accountType === 'ADMIN' && actorUser?.accountType !== 'ADMIN') {
      const error = new Error('Only an administrator can promote an account to administrator.');
      error.statusCode = 403;
      error.code = 'ADMIN_ACCOUNT_FORBIDDEN';
      throw error;
    }

    // Business Rule: A user cannot modify their own account type / role
    if (actorUser && actorUser.id === userId && accountType !== user.accountType) {
      const error = new Error('You cannot modify the account type or role of your own account.');
      error.statusCode = 403;
      error.code = 'SELF_ROLE_CHANGE_FORBIDDEN';
      throw error;
    }

    // Business Rule: The last remaining active administrator cannot be demoted
    if (user.accountType === 'ADMIN' && accountType !== 'ADMIN') {
      const activeAdminCount = await prisma.user.count({
        where: { accountType: 'ADMIN', isActive: true },
      });
      if (activeAdminCount <= 1) {
        const error = new Error('Cannot demote the last remaining active administrator.');
        error.statusCode = 403;
        error.code = 'LAST_ADMIN_PROTECTED';
        throw error;
      }
    }

    data.accountType = accountType;
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data,
    select: {
      id: true,
      name: true,
      email: true,
      accountType: true,
      isActive: true,
      updatedAt: true,
    },
  });

  bustUserCache(userId);
  return updated;
}

/**
 * Assign employee to a project
 */
export async function assignUserToProject(projectId, userId, actorUser = null) {
  // Business Rule: Nobody may assign themselves to projects
  if (actorUser && actorUser.id === userId) {
    const error = new Error('You cannot assign yourself to projects. Another administrator or project assigner must assign projects to you.');
    error.statusCode = 403;
    error.code = 'SELF_PROJECT_ASSIGNMENT_FORBIDDEN';
    throw error;
  }
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    const error = new Error('Project not found.');
    error.statusCode = 404;
    error.code = 'PROJECT_NOT_FOUND';
    throw error;
  }

  if (project.status === 'CLOSED') {
    const error = new Error('Cannot assign employees to a closed project.');
    error.statusCode = 400;
    error.code = 'PROJECT_CLOSED';
    throw error;
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    const error = new Error('User not found.');
    error.statusCode = 404;
    error.code = 'USER_NOT_FOUND';
    throw error;
  }

  if (user.accountType === 'ADMIN') {
    const error = new Error('Administrators cannot be assigned to projects.');
    error.statusCode = 400;
    error.code = 'ADMIN_CANNOT_BE_ASSIGNED';
    throw error;
  }

  if (!user.isActive) {
    const error = new Error('Cannot assign a deactivated user to projects.');
    error.statusCode = 400;
    error.code = 'USER_INACTIVE';
    throw error;
  }

  return prisma.$transaction(async (tx) => {
    const existingActive = await tx.projectAssignment.findFirst({ where: { projectId, userId, removedAt: null } });
    if (existingActive) {
      const error = new Error('User is already assigned to this project.');
      error.statusCode = 400;
      error.code = 'ALREADY_ASSIGNED';
      throw error;
    }
    return tx.projectAssignment.create({
      data: { projectId, userId, assignedAt: new Date() },
      include: {
        user: { select: { id: true, name: true, email: true } },
        project: { select: { id: true, name: true } },
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/**
 * Assign multiple employees to a project
 */
export async function assignUsersToProject(projectId, userIds, actorUser = null) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    const error = new Error('Project not found.');
    error.statusCode = 404;
    error.code = 'PROJECT_NOT_FOUND';
    throw error;
  }

  if (project.status === 'CLOSED') {
    const error = new Error('Cannot assign employees to a closed project.');
    error.statusCode = 400;
    error.code = 'PROJECT_CLOSED';
    throw error;
  }

  // Filter out self-assignment attempts
  const uniqueUserIds = [...new Set(userIds)].filter((uid) => !actorUser || uid !== actorUser.id);
  if (uniqueUserIds.length === 0) {
    const error = new Error('You cannot assign yourself to projects. Another administrator or project assigner must assign projects to you.');
    error.statusCode = 403;
    error.code = 'SELF_PROJECT_ASSIGNMENT_FORBIDDEN';
    throw error;
  }
  const created = [];
  for (const uid of uniqueUserIds) {
    const user = await prisma.user.findUnique({ where: { id: uid } });
    if (!user || !user.isActive || user.accountType === 'ADMIN') continue;

    const existingActive = await prisma.projectAssignment.findFirst({
      where: {
        projectId,
        userId: uid,
        removedAt: null,
      },
    });

    if (!existingActive) {
      const assignment = await prisma.projectAssignment.create({
        data: {
          projectId,
          userId: uid,
          assignedAt: new Date(),
        },
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
          project: {
            select: { id: true, name: true, status: true },
          },
        },
      });
      created.push(assignment);
    }
  }

  return created;
}

/**
 * Assign an employee to multiple projects
 */
export async function assignUserToProjects(userId, projectIds, actorUser = null) {
  // Business Rule: Nobody may assign themselves to projects
  if (actorUser && actorUser.id === userId) {
    const error = new Error('You cannot assign yourself to projects. Another administrator or project assigner must assign projects to you.');
    error.statusCode = 403;
    error.code = 'SELF_PROJECT_ASSIGNMENT_FORBIDDEN';
    throw error;
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    const error = new Error('User not found.');
    error.statusCode = 404;
    error.code = 'USER_NOT_FOUND';
    throw error;
  }

  if (user.accountType === 'ADMIN') {
    const error = new Error('Administrators cannot be assigned to projects.');
    error.statusCode = 400;
    error.code = 'ADMIN_CANNOT_BE_ASSIGNED';
    throw error;
  }

  if (!user.isActive) {
    const error = new Error('Cannot assign a deactivated user to projects.');
    error.statusCode = 400;
    error.code = 'USER_INACTIVE';
    throw error;
  }

  const uniqueProjectIds = [...new Set(projectIds)];
  const created = [];
  for (const pid of uniqueProjectIds) {
    const project = await prisma.project.findUnique({ where: { id: pid } });
    if (!project || project.status === 'CLOSED') continue;

    const existingActive = await prisma.projectAssignment.findFirst({
      where: {
        projectId: pid,
        userId,
        removedAt: null,
      },
    });

    if (!existingActive) {
      const assignment = await prisma.projectAssignment.create({
        data: {
          projectId: pid,
          userId,
          assignedAt: new Date(),
        },
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
          project: {
            select: { id: true, name: true, status: true },
          },
        },
      });
      created.push(assignment);
    }
  }

  return created;
}

/**
 * Soft-remove employee from project (retaining historical work records)
 */
export async function removeUserFromProject(projectId, userId, actorUser = null) {
  const activeAssignment = await prisma.projectAssignment.findFirst({
    where: {
      projectId,
      userId,
      removedAt: null,
    },
  });

  if (!activeAssignment) {
    const error = new Error('User is not currently assigned to this project.');
    error.statusCode = 404;
    error.code = 'ASSIGNMENT_NOT_FOUND';
    throw error;
  }

  // Business Rule: Nobody may remove themselves from project assignments
  if (actorUser && actorUser.id === userId) {
    const error = new Error('You cannot remove yourself from project assignments. Another administrator or project assigner must remove your project assignment.');
    error.statusCode = 403;
    error.code = 'SELF_PROJECT_REMOVAL_FORBIDDEN';
    throw error;
  }

  // Business Rule: Forbid removing project assignment if active capabilities are held for this project
  if (actorUser && actorUser.accountType !== 'ADMIN') {
    const activeGrantWithProjectScope = await prisma.capabilityGrantScope.findFirst({
      where: {
        targetProjectId: projectId,
        scopeType: 'PROJECT',
        grant: {
          userId,
          revokedAt: null,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } },
          ],
        },
      },
      include: {
        grant: {
          include: { capability: true },
        },
      },
    });

    if (activeGrantWithProjectScope) {
      const capCode = activeGrantWithProjectScope.grant?.capability?.code || 'capabilities';
      const isSelf = actorUser.id === userId;
      const message = isSelf
        ? `You cannot remove your own project assignment while you hold active capability "${capCode}" scoped to this project.`
        : `Cannot remove project assignment for a user who holds active capability "${capCode}" on this project.`;
      const error = new Error(message);
      error.statusCode = 403;
      error.code = isSelf ? 'SELF_PROJECT_REMOVAL_FORBIDDEN' : 'CAPABILITY_HELD_PROJECT_REMOVAL_FORBIDDEN';
      throw error;
    }
  }

  return prisma.projectAssignment.update({
    where: { id: activeAssignment.id },
    data: {
      removedAt: new Date(),
    },
  });
}

export default {
  getUsers,
  createUser,
  updateUser,
  updateUserStatus,
  assignUserToProject,
  assignUsersToProject,
  assignUserToProjects,
  removeUserFromProject,
};
