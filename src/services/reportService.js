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
