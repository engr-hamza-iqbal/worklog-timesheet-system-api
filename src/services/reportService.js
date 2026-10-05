import prisma from '../config/db.js';
import { Prisma } from '@prisma/client';
import { getUserActiveCapabilities } from './accessService.js';

async function getReportScope(actorUser) {
  if (!actorUser || actorUser.accountType === 'ADMIN') return null;

  const capabilities = await getUserActiveCapabilities(actorUser);
  const reportCapability = capabilities.VIEW_REPORTS;
  if (!reportCapability) {
    throw Object.assign(new Error('You do not hold the VIEW_REPORTS capability.'), { status: 403 });
  }
  if (reportCapability.isGlobal) return null;

  const allowedUserIds = new Set(reportCapability.allowedUserIds || []);
  if (reportCapability.allowedProjectIds?.length) {
    const assignments = await prisma.projectAssignment.findMany({
      where: {
        projectId: { in: reportCapability.allowedProjectIds },
        removedAt: null,
      },
      select: { userId: true },
    });
    assignments.forEach(({ userId }) => allowedUserIds.add(userId));
  }

  return {
    allowedProjectIds: reportCapability.allowedProjectIds || [],
    allowedUserIds: [...allowedUserIds],
  };
}

function reportScopeSql(scope) {
  if (!scope) return Prisma.empty;
  const clauses = [];
  if (scope.allowedUserIds.length) {
    clauses.push(Prisma.sql`te."userId" IN (${Prisma.join(scope.allowedUserIds)})`);
  }
  if (scope.allowedProjectIds.length) {
    clauses.push(Prisma.sql`te."projectId" IN (${Prisma.join(scope.allowedProjectIds)})`);
  }
  if (clauses.length === 1) return Prisma.sql`AND ${clauses[0]}`;
  if (clauses.length === 2) return Prisma.sql`AND (${clauses[0]} OR ${clauses[1]})`;
  return Prisma.sql`AND FALSE`;
}

function date(value, fallback) {
  const parsed = new Date(value || fallback);
  if (Number.isNaN(parsed.getTime())) throw Object.assign(new Error('Report dates must be valid.'), { status: 400 });
  return parsed.toISOString().slice(0, 10);
}

function range(filters = {}) {
  const startDate = date(filters.startDate, '2000-01-01');
  const endDate = date(filters.endDate, new Date().toISOString().slice(0, 10));
  if (endDate < startDate) throw Object.assign(new Error('End date cannot be earlier than start date.'), { status: 400 });
  return { startDate, endDate };
}

export async function getReports(filters = {}, actorUser = null) {
  const { startDate, endDate } = range(filters);
  const projectId = filters.projectId || null;
  const clientId = filters.clientId || null;

  const reportScope = await getReportScope(actorUser);
  let scopedProjectClause = reportScopeSql(reportScope);
  let canViewBilling = true;
  if (actorUser && actorUser.accountType !== 'ADMIN') {
    const caps = await getUserActiveCapabilities(actorUser);
    canViewBilling = caps['VIEW_BILLING']?.isGlobal === true;
  }

  const approvedWhere = Prisma.sql`
    te."status" = 'APPROVED'
    AND te."deletedAt" IS NULL
    AND te."workDate" >= ${startDate}::date
    AND te."workDate" <= ${endDate}::date
    AND (${projectId}::text IS NULL OR te."projectId" = ${projectId})
    AND (${clientId}::text IS NULL OR p."clientId" = ${clientId})
    ${scopedProjectClause}
  `;

  const [byProject, byClient, byEmployee, byStatus] = await Promise.all([
    prisma.$queryRaw(Prisma.sql`
      SELECT p."id" AS "projectId", p."name" AS "projectName", c."name" AS "clientName",
             COALESCE(SUM(te."durationMinutes"), 0)::int AS "minutes",
             ROUND(COALESCE(SUM(te."durationMinutes"), 0) / 60.0, 2) AS "hours",
             ROUND(COALESCE(SUM(te."durationMinutes" * te."approvedRateSnapshot"), 0) / 60.0, 2) AS "billableValue"
      FROM "TimeEntry" te
      JOIN "Project" p ON p."id" = te."projectId"
      JOIN "Client" c ON c."id" = p."clientId"
      WHERE ${approvedWhere}
      GROUP BY p."id", p."name", c."name"
      ORDER BY "hours" DESC
    `),
    prisma.$queryRaw(Prisma.sql`
      SELECT c."id" AS "clientId", c."name" AS "clientName",
             COALESCE(SUM(te."durationMinutes"), 0)::int AS "minutes",
             ROUND(COALESCE(SUM(te."durationMinutes"), 0) / 60.0, 2) AS "hours",
             ROUND(COALESCE(SUM(te."durationMinutes" * te."approvedRateSnapshot"), 0) / 60.0, 2) AS "billableValue"
      FROM "TimeEntry" te
      JOIN "Project" p ON p."id" = te."projectId"
      JOIN "Client" c ON c."id" = p."clientId"
      WHERE ${approvedWhere}
      GROUP BY c."id", c."name"
      ORDER BY "hours" DESC
    `),
    prisma.$queryRaw(Prisma.sql`
      SELECT u."id" AS "userId", u."name" AS "userName", u."email",
             COALESCE(SUM(te."durationMinutes"), 0)::int AS "minutes",
             ROUND(COALESCE(SUM(te."durationMinutes"), 0) / 60.0, 2) AS "hours"
      FROM "TimeEntry" te
      JOIN "User" u ON u."id" = te."userId"
      JOIN "Project" p ON p."id" = te."projectId"
      WHERE ${approvedWhere}
      GROUP BY u."id", u."name", u."email"
      ORDER BY "hours" DESC
    `),
    prisma.$queryRaw(Prisma.sql`
      SELECT te."status", COUNT(*)::int AS "entries",
             ROUND(COALESCE(SUM(te."durationMinutes"), 0) / 60.0, 2) AS "hours"
      FROM "TimeEntry" te
      JOIN "Project" p ON p."id" = te."projectId"
      WHERE te."deletedAt" IS NULL
        AND te."workDate" >= ${startDate}::date
        AND te."workDate" <= ${endDate}::date
        AND (${projectId}::text IS NULL OR te."projectId" = ${projectId})
        AND (${clientId}::text IS NULL OR p."clientId" = ${clientId})
        ${scopedProjectClause}
      GROUP BY te."status"
      ORDER BY te."status"
    `),
  ]);

  const sanitizedByProject = canViewBilling
    ? byProject
    : byProject.map(({ billableValue, ...rest }) => rest);

  const sanitizedByClient = canViewBilling
    ? byClient
    : byClient.map(({ billableValue, ...rest }) => rest);

  return { startDate, endDate, byProject: sanitizedByProject, byClient: sanitizedByClient, byEmployee, byStatus };
}

export async function getMissingTimesheets(targetDate, actorUser) {
  const checkDate = date(targetDate, new Date().toISOString().slice(0, 10));
  const reportScope = await getReportScope(actorUser);
  const scopeFilter = reportScope
    ? reportScope.allowedUserIds.length
      ? Prisma.sql`AND u."id" IN (${Prisma.join(reportScope.allowedUserIds)})`
      : Prisma.sql`AND FALSE`
    : Prisma.empty;

  const missingEmployees = await prisma.$queryRaw(Prisma.sql`
    SELECT u."id" AS "userId", u."name" AS "userName", u."email"
    FROM "User" u
    WHERE u."accountType" = 'EMPLOYEE'
      AND u."isActive" = true
      AND NOT EXISTS (
        SELECT 1 FROM "TimeEntry" te
        WHERE te."userId" = u."id"
          AND te."workDate" = ${checkDate}::date
          AND te."deletedAt" IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM "TimeOffDay" tod
        WHERE tod."userId" = u."id"
          AND tod."date" = ${checkDate}::date
          AND tod."status" = 'APPROVED'
      )
      ${scopeFilter}
    ORDER BY u."name" ASC
  `);

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const existingLogs = await prisma.emailLog.findMany({
    where: {
      emailType: 'MISSING_TIMESHEET',
      referenceDate: new Date(checkDate),
      attemptedAt: { gte: startOfDay },
      status: { in: ['SENT', 'PENDING'] },
    },
    select: { recipientUserId: true },
  });

  const chasedUserIds = new Set(existingLogs.map((l) => l.recipientUserId));

  return {
    date: checkDate,
    employees: missingEmployees.map((emp) => ({
      ...emp,
      chasedToday: chasedUserIds.has(emp.userId),
    })),
  };
}

export async function chaseMissingTimesheets({ date: targetDate, userIds, actorUser }) {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    throw Object.assign(new Error('Please select at least one employee to chase.'), { status: 400 });
  }

  const checkDate = date(targetDate, new Date().toISOString().slice(0, 10));
  const reportScope = await getReportScope(actorUser);
  if (reportScope && userIds.some((userId) => !reportScope.allowedUserIds.includes(userId))) {
    throw Object.assign(new Error('One or more employees are outside your report scope.'), { status: 403 });
  }
  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, isActive: true },
    select: { id: true, name: true, email: true },
  });

  const sent = [];
  const skipped = [];

  const { canSendMissingTimesheetChase, buildMissingTimesheetEmail, queueEmail } = await import('./emailService.js');

  for (const user of users) {
    const canSend = await canSendMissingTimesheetChase(user.id, checkDate);
    if (!canSend) {
      skipped.push({ userId: user.id, name: user.name, reason: 'Already reminded today' });
      continue;
    }

    const emailContent = buildMissingTimesheetEmail({
      recipientName: user.name,
      missingDates: [checkDate],
    });

    queueEmail({
      recipientUserId: user.id,
      recipientEmail: user.email,
      emailType: 'MISSING_TIMESHEET',
      subject: emailContent.subject,
      relatedEntityType: 'MissingTimesheet',
      referenceDate: checkDate,
      html: emailContent.html,
    });

    sent.push({ userId: user.id, name: user.name });
  }

  return { date: checkDate, sentCount: sent.length, skippedCount: skipped.length, sent, skipped };
}
