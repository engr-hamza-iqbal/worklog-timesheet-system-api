-- 01. Joins: A list of entries showing the person, the project, and the client together.
-- Purpose: Returns all non-deleted time entries with author and full project hierarchy.

SELECT 
    te."id" AS entry_id,
    te."workDate" AS work_date,
    ROUND(te."durationMinutes" / 60.0, 2) AS hours_worked,
    te."description",
    te."status",
    u."name" AS employee_name,
    u."email" AS employee_email,
    p."name" AS project_name,
    p."status" AS project_status,
    c."name" AS client_name
FROM "TimeEntry" te
JOIN "User" u ON u."id" = te."userId"
JOIN "Project" p ON p."id" = te."projectId"
JOIN "Client" c ON c."id" = p."clientId"
WHERE te."deletedAt" IS NULL
ORDER BY te."workDate" DESC, te."createdAt" DESC;
