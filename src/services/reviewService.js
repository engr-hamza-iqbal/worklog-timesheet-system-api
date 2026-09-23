import prisma from '../config/db.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toIsoDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()))
    .toISOString()
    .split('T')[0];
}

async function logHistory(tx, { timeEntryId, action, previousStatus, newStatus, performedById, comment }) {
  await tx.timeEntryHistory.create({
    data: { timeEntryId, action, previousStatus, newStatus, performedById, comment },
  });
}

/**
 * Build the WHERE clause additions needed to scope review access.
 * Returns null if the reviewer has unrestricted (global) access.
 *
 * The reviewer may hold REVIEW_TIME globally (no scopes) or scoped to
 * specific projects or specific users.
 *
 * Admins: no scope restrictions — they always see everything.
 */
async function buildReviewerScope(reviewerUser) {
  if (reviewerUser.accountType === 'ADMIN') return null; // Admin sees all

  // Find all active REVIEW_TIME grants so separate scoped grants combine safely.
  const now = new Date();
  const grants = await prisma.capabilityGrant.findMany({
    where: {
      userId: reviewerUser.id,
      capability: { code: 'REVIEW_TIME' },
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    include: { scopes: { select: { scopeType: true, targetUserId: true, targetProjectId: true } } },
  });

  if (grants.length === 0) {
    throw Object.assign(new Error('You do not hold the REVIEW_TIME capability.'), { status: 403 });
  }

  if (grants.some((grant) => grant.scopes.length === 0)) return null; // Any global grant removes restrictions.

  const scopes = grants.flatMap((grant) => grant.scopes);
  const userScopes    = scopes.filter((s) => s.scopeType === 'USER'    && s.targetUserId);
  const projectScopes = scopes.filter((s) => s.scopeType === 'PROJECT' && s.targetProjectId);

  // Build a Prisma OR filter representing the reviewer's scope
  const scopeFilter = [];
  if (userScopes.length > 0) {
    scopeFilter.push({ userId: { in: userScopes.map((s) => s.targetUserId) } });
  }
  if (projectScopes.length > 0) {
    scopeFilter.push({ projectId: { in: projectScopes.map((s) => s.targetProjectId) } });
  }

  if (scopeFilter.length === 0) {
    throw Object.assign(new Error('Your REVIEW_TIME grant has no valid scope.'), { status: 403 });
  }

  return {
    scopeFilter,           // array of OR conditions for Prisma
    scopedUserIds:    userScopes.map((s) => s.targetUserId),
    scopedProjectIds: projectScopes.map((s) => s.targetProjectId),
  };
}

// ─── Service functions ────────────────────────────────────────────────────────

/**
 * Retrieve the review queue — all SUBMITTED entries visible to this reviewer.
 * Excludes the reviewer's own entries (no self-review).
 *
 * @param {object} reviewerUser  req.user
 * @param {object} filters       { userId?, projectId?, userQuery?, projectQuery?, startDate?, endDate? }
 */
export async function getReviewQueue(reviewerUser, filters = {}) {
  const scope = await buildReviewerScope(reviewerUser);

  const where = {
    status: 'SUBMITTED',
    deletedAt: null,
    NOT: { userId: reviewerUser.id }, // never show reviewer their own work
  };

  // Apply scope restrictions
  if (scope !== null && scope.scopeFilter.length > 0) {
    where.OR = scope.scopeFilter;
  }

  // Apply caller-supplied filters on top of scope
  if (filters.userId) where.userId = filters.userId;
  if (filters.projectId) where.projectId = filters.projectId;
  if (filters.userQuery) {
    where.user = {
      OR: [
        { name: { contains: filters.userQuery, mode: 'insensitive' } },
        { email: { contains: filters.userQuery, mode: 'insensitive' } },
      ],
    };
  }
  if (filters.projectQuery) {
    where.project = {
      name: { contains: filters.projectQuery, mode: 'insensitive' },
    };
  }

  if (filters.startDate || filters.endDate) {
    where.workDate = {};
    if (filters.startDate) where.workDate.gte = new Date(`${filters.startDate}T00:00:00.000Z`);
    if (filters.endDate)   where.workDate.lte = new Date(`${filters.endDate}T23:59:59.999Z`);
  }

  const entries = await prisma.timeEntry.findMany({
    where,
    include: {
      user:    { select: { id: true, name: true, email: true } },
      project: { select: { id: true, name: true, status: true, client: { select: { id: true, name: true } } } },
    },
    orderBy: [{ workDate: 'asc' }, { createdAt: 'asc' }],
  });

  return {
    entries: entries.map(formatReviewEntry),
    total:   entries.length,
    scope:   scope ? {
      type:       scope.scopedUserIds?.length ? 'USER' : 'PROJECT',
      userIds:    scope.scopedUserIds    || [],
      projectIds: scope.scopedProjectIds || [],
    } : { type: 'GLOBAL', userIds: [], projectIds: [] },
  };
}

/**
 * Approve one or more SUBMITTED time entries.
 *
 * @param {object} reviewerUser   req.user
 * @param {string[]} entryIds
 */
export async function approveEntries(reviewerUser, entryIds) {
  if (!Array.isArray(entryIds) || entryIds.length === 0) {
    throw Object.assign(new Error('No entry IDs provided.'), { status: 400 });
  }

  const scope = await buildReviewerScope(reviewerUser);

  const entries = await prisma.timeEntry.findMany({
    where: { id: { in: entryIds } },
    include: {
      project: {
        include: {
          rates: { where: { effectiveTo: null }, take: 1, orderBy: { effectiveFrom: 'desc' } },
        },
      },
    },
  });

  if (entries.length !== entryIds.length) {
    throw Object.assign(new Error('One or more time entries not found.'), { status: 404 });
  }

  for (const e of entries) {
    // Self-review prohibition — even admins cannot approve their own
    if (e.userId === reviewerUser.id) {
      throw Object.assign(new Error('Reviewers cannot approve their own time entries.'), { status: 403 });
    }
    if (e.status !== 'SUBMITTED') {
      throw Object.assign(
        new Error(`Entry ${e.id} is not in SUBMITTED status (current: ${e.status}).`),
        { status: 400 }
      );
    }
    // Scope check (non-admin)
    if (scope !== null && scope.scopeFilter.length > 0) {
      const inScope =
        scope.scopedUserIds?.includes(e.userId) ||
        scope.scopedProjectIds?.includes(e.projectId);
      if (!inScope) {
        throw Object.assign(
          new Error(`Entry ${e.id} is outside your review scope.`),
          { status: 403 }
        );
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const e of entries) {
      // Snapshot the billing rate at time of approval (for financial lock)
      const rateSnapshot = e.project?.rates?.[0]?.ratePerHour ?? null;

      await tx.timeEntry.update({
        where: { id: e.id },
        data: { status: 'APPROVED', approvedRateSnapshot: rateSnapshot },
      });

      await logHistory(tx, {
        timeEntryId:    e.id,
        action:         'APPROVE',
        previousStatus: 'SUBMITTED',
        newStatus:      'APPROVED',
        performedById:  reviewerUser.id,
      });
    }
  });

  return { approvedCount: entries.length };
}

/**
 * Return a single SUBMITTED entry with a mandatory comment.
 *
 * @param {object} reviewerUser  req.user
 * @param {string} entryId
 * @param {string} comment       Mandatory return reason
 */
export async function returnEntry(reviewerUser, entryId, comment) {
  if (!comment || comment.trim().length < 5) {
    throw Object.assign(
      new Error('A return comment of at least 5 characters is required when returning an entry.'),
      { status: 400 }
    );
  }

  const scope = await buildReviewerScope(reviewerUser);

  const entry = await prisma.timeEntry.findUnique({ where: { id: entryId } });
  if (!entry) {
    throw Object.assign(new Error('Time entry not found.'), { status: 404 });
  }
  if (entry.userId === reviewerUser.id) {
    throw Object.assign(new Error('Reviewers cannot return their own time entries.'), { status: 403 });
  }
  if (entry.status !== 'SUBMITTED') {
    throw Object.assign(
      new Error(`Entry is not in SUBMITTED status (current: ${entry.status}).`),
      { status: 400 }
    );
  }

  // Scope check
  if (scope !== null && scope.scopeFilter.length > 0) {
    const inScope =
      scope.scopedUserIds?.includes(entry.userId) ||
      scope.scopedProjectIds?.includes(entry.projectId);
    if (!inScope) {
      throw Object.assign(new Error('Entry is outside your review scope.'), { status: 403 });
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.timeEntry.update({ where: { id: entryId }, data: { status: 'RETURNED' } });
    await logHistory(tx, {
      timeEntryId:    entryId,
      action:         'RETURN',
      previousStatus: 'SUBMITTED',
      newStatus:      'RETURNED',
      performedById:  reviewerUser.id,
      comment:        comment.trim(),
    });
  });

  return { entryId, status: 'RETURNED' };
}

/**
 * Reopen an APPROVED entry — ADMIN ONLY.
 *
 * @param {object} adminUser    req.user (must be ADMIN)
 * @param {string} entryId
 * @param {string} reason       Mandatory reopen reason
 */
export async function reopenEntry(adminUser, entryId, reason) {
  if (adminUser.accountType !== 'ADMIN') {
    throw Object.assign(new Error('Only Administrators can reopen approved entries.'), { status: 403 });
  }
  if (!reason || reason.trim().length < 5) {
    throw Object.assign(new Error('A reopen reason of at least 5 characters is required.'), { status: 400 });
  }

  const entry = await prisma.timeEntry.findUnique({ where: { id: entryId } });
  if (!entry) {
    throw Object.assign(new Error('Time entry not found.'), { status: 404 });
  }
  if (entry.status !== 'APPROVED') {
    throw Object.assign(
      new Error(`Can only reopen APPROVED entries (current status: ${entry.status}).`),
      { status: 400 }
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.timeEntry.update({
      where: { id: entryId },
      data: { status: 'DRAFT', approvedRateSnapshot: null },
    });
    await logHistory(tx, {
      timeEntryId:    entryId,
      action:         'REOPEN',
      previousStatus: 'APPROVED',
      newStatus:      'DRAFT',
      performedById:  adminUser.id,
      comment:        reason.trim(),
    });
  });

  return { entryId, status: 'DRAFT' };
}

// ─── Format helper ────────────────────────────────────────────────────────────

function formatReviewEntry(e) {
  return {
    id:              e.id,
    userId:          e.userId,
    user:            e.user,
    projectId:       e.projectId,
    project:         e.project ? {
      id:         e.project.id,
      name:       e.project.name,
      status:     e.project.status,
      clientId:   e.project.client?.id,
      clientName: e.project.client?.name,
    } : undefined,
    workDate:        toIsoDate(e.workDate),
    durationMinutes: e.durationMinutes,
    durationHours:   e.durationMinutes / 60,
    description:     e.description,
    status:          e.status,
    createdAt:       e.createdAt,
    updatedAt:       e.updatedAt,
  };
}
