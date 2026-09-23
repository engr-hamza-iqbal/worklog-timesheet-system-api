import prisma from '../config/db.js';
import { Prisma } from '@prisma/client';

function date(value, fallback) {
  const parsed = new Date(value || fallback);
  if (Number.isNaN(parsed.getTime())) throw Object.assign(new Error('Analytics dates must be valid.'), { status: 400 });
  return parsed.toISOString().slice(0, 10);
}

export async function getAnalytics({ startDate, endDate, projectId, clientId } = {}) {
  const start = date(startDate, '2000-01-01');
  const end = date(endDate, new Date().toISOString().slice(0, 10));
  if (end < start) throw Object.assign(new Error('End date cannot be earlier than start date.'), { status: 400 });
  const filters = Prisma.sql`
    te."status" = 'APPROVED' AND te."deletedAt" IS NULL
    AND te."workDate" BETWEEN ${start}::date AND ${end}::date
    AND (${projectId || null}::text IS NULL OR te."projectId" = ${projectId || null})
    AND (${clientId || null}::text IS NULL OR p."clientId" = ${clientId || null})
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
  return { startDate: start, endDate: end, weekly, projects, clients, employees };
}
