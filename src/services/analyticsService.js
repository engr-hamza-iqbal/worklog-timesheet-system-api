import prisma from '../config/db.js';
import { Prisma } from '@prisma/client';
import { getUserActiveCapabilities } from './accessService.js';

async function getAnalyticsScope(actorUser) {
  if (!actorUser || actorUser.accountType === 'ADMIN') return null;
  const capabilities = await getUserActiveCapabilities(actorUser);
  const capability = capabilities.VIEW_ANALYTICS;
  if (!capability) throw Object.assign(new Error('You do not hold the VIEW_ANALYTICS capability.'), { status: 403 });
  if (capability.isGlobal) return null;

  const allowedUserIds = new Set(capability.allowedUserIds || []);
  if (capability.allowedProjectIds?.length) {
    const assignments = await prisma.projectAssignment.findMany({
      where: { projectId: { in: capability.allowedProjectIds }, removedAt: null },
      select: { userId: true },
    });
    assignments.forEach(({ userId }) => allowedUserIds.add(userId));
  }
  return { allowedUserIds: [...allowedUserIds], allowedProjectIds: capability.allowedProjectIds || [] };
}

function date(value, fallback) {
  const parsed = new Date(value || fallback);
  if (Number.isNaN(parsed.getTime())) throw Object.assign(new Error('Analytics dates must be valid.'), { status: 400 });
  return parsed.toISOString().slice(0, 10);
}

export async function getAnalytics({ startDate, endDate, projectId, clientId, employeeId } = {}, actorUser = null) {
  const start = date(startDate, '2000-01-01');
  const end = date(endDate, new Date().toISOString().slice(0, 10));
  if (end < start) throw Object.assign(new Error('End date cannot be earlier than start date.'), { status: 400 });

  const analyticsScope = await getAnalyticsScope(actorUser);
  if (employeeId && analyticsScope && !analyticsScope.allowedUserIds.includes(employeeId)) {
    throw Object.assign(new Error('Employee is outside your analytics scope.'), { status: 403 });
  }
  const scopeParts = [];
  if (analyticsScope?.allowedUserIds.length) scopeParts.push(Prisma.sql`te."userId" IN (${Prisma.join(analyticsScope.allowedUserIds)})`);
  if (analyticsScope?.allowedProjectIds.length) scopeParts.push(Prisma.sql`te."projectId" IN (${Prisma.join(analyticsScope.allowedProjectIds)})`);
  const scopedProjectClause = analyticsScope
    ? scopeParts.length ? Prisma.sql`AND (${Prisma.join(scopeParts, ' OR ')})` : Prisma.sql`AND FALSE`
    : Prisma.empty;
  const employeeClause = employeeId ? Prisma.sql`AND te."userId" = ${employeeId}` : Prisma.empty;
  const timeOffScopeClause = analyticsScope
    ? analyticsScope.allowedUserIds.length
      ? Prisma.sql`AND tod."userId" IN (${Prisma.join(analyticsScope.allowedUserIds)})`
      : Prisma.sql`AND FALSE`
    : Prisma.empty;

  const filters = Prisma.sql`
    te."status" = 'APPROVED' AND te."deletedAt" IS NULL
    AND te."workDate" BETWEEN ${start}::date AND ${end}::date
    AND (${projectId || null}::text IS NULL OR te."projectId" = ${projectId || null})
    AND (${clientId || null}::text IS NULL OR p."clientId" = ${clientId || null})
    ${employeeClause}
    ${scopedProjectClause}
  `;
  const allStatusFilters = Prisma.sql`
    te."deletedAt" IS NULL
    AND te."workDate" BETWEEN ${start}::date AND ${end}::date
    AND (${projectId || null}::text IS NULL OR te."projectId" = ${projectId || null})
    AND (${clientId || null}::text IS NULL OR p."clientId" = ${clientId || null})
    ${employeeClause}
    ${scopedProjectClause}
  `;
  const [weekly, projects, clients, employees] = await Promise.all([
    prisma.$queryRaw(Prisma.sql`
      SELECT TO_CHAR(DATE_TRUNC('week', te."workDate"), 'YYYY-MM-DD') AS "week",
             ROUND(SUM(te."durationMinutes") / 60.0, 2) AS "hours"
      FROM "TimeEntry" te JOIN "Project" p ON p."id" = te."projectId"
      WHERE ${filters}
      GROUP BY DATE_TRUNC('week', te."workDate") ORDER BY DATE_TRUNC('week', te."workDate")
    `),
    prisma.$queryRaw(Prisma.sql`
      SELECT p."name" AS "label", ROUND(SUM(te."durationMinutes") / 60.0, 2) AS "hours"
      FROM "TimeEntry" te JOIN "Project" p ON p."id" = te."projectId"
      WHERE ${filters} GROUP BY p."id", p."name" ORDER BY "hours" DESC
    `),
    prisma.$queryRaw(Prisma.sql`
      SELECT c."name" AS "label", ROUND(SUM(te."durationMinutes") / 60.0, 2) AS "hours"
      FROM "TimeEntry" te JOIN "Project" p ON p."id" = te."projectId" JOIN "Client" c ON c."id" = p."clientId"
      WHERE ${filters} GROUP BY c."id", c."name" ORDER BY "hours" DESC
    `),
    prisma.$queryRaw(Prisma.sql`
      SELECT u."name" AS "label", ROUND(SUM(te."durationMinutes") / 60.0, 2) AS "hours"
      FROM "TimeEntry" te JOIN "User" u ON u."id" = te."userId" JOIN "Project" p ON p."id" = te."projectId"
      WHERE ${filters} GROUP BY u."id", u."name" ORDER BY "hours" DESC
    `),
  ]);
  const [statusBreakdown, employeeWeekly, timeOff] = await Promise.all([
    prisma.$queryRaw(Prisma.sql`
      SELECT te."status", ROUND(SUM(te."durationMinutes") / 60.0, 2) AS "hours", COUNT(*)::int AS "entries"
      FROM "TimeEntry" te JOIN "Project" p ON p."id" = te."projectId"
      WHERE ${allStatusFilters}
      GROUP BY te."status" ORDER BY te."status"
    `),
    employeeId ? prisma.$queryRaw(Prisma.sql`
      SELECT TO_CHAR(DATE_TRUNC('week', te."workDate"), 'YYYY-MM-DD') AS "week",
             ROUND(SUM(te."durationMinutes") / 60.0, 2) AS "hours"
      FROM "TimeEntry" te JOIN "Project" p ON p."id" = te."projectId"
      WHERE ${filters} AND te."userId" = ${employeeId}
      GROUP BY DATE_TRUNC('week', te."workDate") ORDER BY DATE_TRUNC('week', te."workDate")
    `) : [],
    prisma.$queryRaw(Prisma.sql`
      SELECT tod."status", COUNT(*)::int AS "days"
      FROM "TimeOffDay" tod
      WHERE tod."date" BETWEEN ${start}::date AND ${end}::date
        AND (${employeeId || null}::text IS NULL OR tod."userId" = ${employeeId || null})
        AND tod."status" IN ('APPROVED', 'PENDING')
        ${timeOffScopeClause}
      GROUP BY tod."status" ORDER BY tod."status"
    `),
  ]);
  return { startDate: start, endDate: end, weekly, projects, clients, employees, statusBreakdown, employeeWeekly, timeOff };
}
