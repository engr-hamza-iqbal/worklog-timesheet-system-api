-- 03. Arithmetic Across Tables: Total billable value calculated from hours and applicable rate, grouped by client.
-- Purpose: Evaluates billable financial total using historical snapshot rates to preserve monetary integrity.

SELECT 
    c."id" AS client_id,
    c."name" AS client_name,
    COUNT(te."id") AS approved_entries,
    ROUND(COALESCE(SUM(te."durationMinutes"), 0) / 60.0, 2) AS approved_hours,
    ROUND(COALESCE(SUM((te."durationMinutes" / 60.0) * te."approvedRateSnapshot"), 0), 2) AS total_billable_value
FROM "Client" c
JOIN "Project" p ON p."clientId" = c."id"
JOIN "TimeEntry" te ON te."projectId" = p."id"
WHERE te."status" = 'APPROVED'
  AND te."deletedAt" IS NULL
  AND te."workDate" >= '2026-01-01'::date
  AND te."workDate" <= '2026-12-31'::date
GROUP BY c."id", c."name"
ORDER BY total_billable_value DESC;
