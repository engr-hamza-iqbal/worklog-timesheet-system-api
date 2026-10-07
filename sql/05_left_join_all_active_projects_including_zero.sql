-- 05. Left Join: Every active project, including those with no time recorded, showing zero rather than being omitted.
-- Purpose: Ensures management sees dormant or brand new active projects that have zero recorded hours.

SELECT 
    p."id" AS project_id,
    p."name" AS project_name,
    c."name" AS client_name,
    COALESCE(COUNT(te."id"), 0) AS total_entries,
    COALESCE(SUM(te."durationMinutes"), 0) AS total_minutes,
    ROUND(COALESCE(SUM(te."durationMinutes"), 0) / 60.0, 2) AS total_hours
FROM "Project" p
JOIN "Client" c ON c."id" = p."clientId"
LEFT JOIN "TimeEntry" te ON te."projectId" = p."id" 
                        AND te."deletedAt" IS NULL 
                        AND te."status" = 'APPROVED'
WHERE p."status" = 'ACTIVE'
GROUP BY p."id", p."name", c."name"
ORDER BY total_hours DESC, p."name" ASC;
