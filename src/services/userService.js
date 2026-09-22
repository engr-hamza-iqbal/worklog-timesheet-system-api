import bcrypt from 'bcryptjs';
import prisma from '../config/db.js';
import { bustUserCache } from '../middleware/auth.js';

/**
 * List all users with assignment counts
 */
export async function getUsers() {
  const users = await prisma.user.findMany({
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
    activeCapabilitiesCount: u.capabilityGrantsReceived.length,
  }));
}

/**
 * Create a new user (EMPLOYEE or ADMIN)
 */
export async function createUser({ name, email, password, accountType = 'EMPLOYEE' }) {
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

  // Business Rule: An admin cannot deactivate themselves
  if (!isActive && userId === currentAdminId) {
    const error = new Error('You cannot deactivate your own administrator account.');
    error.statusCode = 403;
    error.code = 'SELF_DEACTIVATION_FORBIDDEN';
    throw error;
  }

  // Business Rule: The last active administrator cannot be deactivated
  if (!isActive && user.accountType === 'ADMIN') {
    const activeAdminCount = await prisma.user.count({
      where: {
        accountType: 'ADMIN',
        isActive: true,
      },
    });

    if (activeAdminCount <= 1) {
      const error = new Error('Cannot deactivate the last remaining active administrator account.');
      error.statusCode = 403;
      error.code = 'LAST_ADMIN_PROTECTED';
      throw error;
    }
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { isActive },
    select: {
      id: true,
      name: true,
      email: true,
      accountType: true,
      isActive: true,
      updatedAt: true,
    },
  });

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

    // Business Rule: An admin cannot remove their own administrator access
    if (actorUser && actorUser.id === userId && accountType !== 'ADMIN') {
      const error = new Error('You cannot remove administrator access from your own account.');
      error.statusCode = 403;
      error.code = 'SELF_DEMOTION_FORBIDDEN';
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
export async function assignUserToProject(projectId, userId) {
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

  if (!user.isActive) {
    const error = new Error('Cannot assign a deactivated user to projects.');
    error.statusCode = 400;
    error.code = 'USER_INACTIVE';
    throw error;
  }

  // Check existing active assignment
  const existingActive = await prisma.projectAssignment.findFirst({
    where: {
      projectId,
      userId,
      removedAt: null,
    },
  });

  if (existingActive) {
    const error = new Error('User is already assigned to this project.');
    error.statusCode = 400;
    error.code = 'ALREADY_ASSIGNED';
    throw error;
  }

  return prisma.projectAssignment.create({
    data: {
      projectId,
      userId,
      assignedAt: new Date(),
    },
    include: {
      user: {
        select: { id: true, name: true, email: true },
      },
      project: {
        select: { id: true, name: true },
      },
    },
  });
}

/**
 * Soft-remove employee from project (retaining historical work records)
 */
export async function removeUserFromProject(projectId, userId) {
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
  removeUserFromProject,
};
