import prisma from '../config/db.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { getUserActiveCapabilities } from '../services/accessService.js';

export async function handleGetDashboardStats(req, res) {
  try {
    const actor = req.user;
    if (!actor) {
      return sendError(res, 'Authentication required', 401, 'UNAUTHORIZED');
    }

    const isAdmin = actor.accountType === 'ADMIN';
    const capabilities = await getUserActiveCapabilities(actor);

    // 1. Projects Count (targeted count)
    const projectsCountPromise = isAdmin
      ? prisma.project.count({ where: { status: 'ACTIVE' } })
      : prisma.projectAssignment.count({
          where: {
            userId: actor.id,
            removedAt: null,
            project: { status: 'ACTIVE' },
          },
        });

    // 2. Pending Reviews Count
    let reviewsCountPromise = Promise.resolve(0);
    if (isAdmin) {
      reviewsCountPromise = prisma.timeEntry.count({
        where: { status: 'SUBMITTED', deletedAt: null },
      });
    } else if (capabilities?.REVIEW_TIME) {
      const grant = capabilities.REVIEW_TIME;
      const where = { status: 'SUBMITTED', deletedAt: null, userId: { not: actor.id } };
      if (!grant.isGlobal) {
        const conditions = [];
        if (grant.allowedUserIds?.length) conditions.push({ userId: { in: grant.allowedUserIds } });
        if (grant.allowedProjectIds?.length) conditions.push({ projectId: { in: grant.allowedProjectIds } });
        if (conditions.length) where.OR = conditions;
      }
      reviewsCountPromise = prisma.timeEntry.count({ where });
    }

    // 3. Pending Time-Off Decisions Count
    let timeOffCountPromise = Promise.resolve(0);
    if (isAdmin) {
      timeOffCountPromise = prisma.timeOffRequest.count({
        where: { status: 'PENDING' },
      });
    } else if (capabilities?.DECIDE_TIME_OFF) {
      const grant = capabilities.DECIDE_TIME_OFF;
      const where = { status: 'PENDING', userId: { not: actor.id } };
      if (!grant.isGlobal && grant.allowedUserIds?.length) {
        where.userId = { in: grant.allowedUserIds };
      }
      timeOffCountPromise = prisma.timeOffRequest.count({ where });
    }

    const [projectsCount, reviewsCount, timeOffCount] = await Promise.all([
      projectsCountPromise,
      reviewsCountPromise,
      timeOffCountPromise,
    ]);

    const pendingCount = reviewsCount + timeOffCount;

    return sendSuccess(
      res,
      {
        projectsCount,
        reviewsCount,
        timeOffCount,
        pendingCount,
      },
      'Dashboard stats retrieved successfully.'
    );
  } catch (error) {
    return sendError(res, error.message, error.status || 500);
  }
}
