-- 02. Aggregation: Total approved hours grouped by project for a chosen date range.
-- Purpose: Produces accurate aggregated project hours strictly for approved records.

SELECT 
    p."id" AS project_id,
    p."name" AS project_name,
    c."name" AS client_name,
    COUNT(te."id") AS entry_count,
    COALESCE(SUM(te."durationMinutes"), 0) AS total_minutes,
    ROUND(COALESCE(SUM(te."durationMinutes"), 0) / 60.0, 2) AS total_approved_hours
FROM "Project" p
JOIN "Client" c ON c."id" = p."clientId"
JOIN "TimeEntry" te ON te."projectId" = p."id"
WHERE te."status" = 'APPROVED'
  AND te."deletedAt" IS NULL
  AND te."workDate" >= '2026-01-01'::date
  AND te."workDate" <= '2026-12-31'::date
GROUP BY p."id", p."name", c."name"
ORDER BY total_approved_hours DESC;
