import prisma from '../config/db.js';
import { Prisma } from '@prisma/client';

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

export async function getReports(filters = {}) {
  const { startDate, endDate } = range(filters);
  const projectId = filters.projectId || null;
  const clientId = filters.clientId || null;
  const approvedWhere = Prisma.sql`
    te."status" = 'APPROVED'
    AND te."deletedAt" IS NULL
    AND te."workDate" >= ${startDate}::date
    AND te."workDate" <= ${endDate}::date
    AND (${projectId}::text IS NULL OR te."projectId" = ${projectId})
    AND (${clientId}::text IS NULL OR p."clientId" = ${clientId})
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
      GROUP BY te."status"
      ORDER BY te."status"
    `),
  ]);

  return { startDate, endDate, byProject, byClient, byEmployee, byStatus };
}

export async function getMissingTimesheets(targetDate) {
  const checkDate = date(targetDate, new Date().toISOString().slice(0, 10));

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
