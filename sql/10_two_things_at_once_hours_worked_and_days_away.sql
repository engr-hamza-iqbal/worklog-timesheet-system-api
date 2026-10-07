-- 10. Two Things at Once: Hours worked and days away for one employee over the same period.
-- Purpose: Evaluates employee productivity side-by-side with approved leave days.

SELECT 
    u."id" AS user_id,
    u."name" AS employee_name,
    -- Metric 1: Total approved hours worked in date range
    COALESCE(
        (SELECT ROUND(SUM(te."durationMinutes") / 60.0, 2)
         FROM "TimeEntry" te
         WHERE te."userId" = u."id"
           AND te."status" = 'APPROVED'
           AND te."deletedAt" IS NULL
           AND te."workDate" BETWEEN '2026-01-01'::date AND '2026-12-31'::date),
        0.00
    ) AS total_approved_hours_worked,

    -- Metric 2: Total approved days away in date range
    COALESCE(
        (SELECT COUNT(tod."id")
         FROM "TimeOffDay" tod
         WHERE tod."userId" = u."id"
           AND tod."status" = 'APPROVED'
           AND tod."date" BETWEEN '2026-01-01'::date AND '2026-12-31'::date),
        0
    ) AS total_approved_days_away
FROM "User" u
WHERE u."id" = 'user-uuid-placeholder'
  AND u."isActive" = true;
