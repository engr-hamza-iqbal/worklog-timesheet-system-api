-- 06. Finding What is Absent: Employees with no entry at all on a given working day, excluding anyone with approved time off.
-- Purpose: Identifies staff who forgot to submit hours while exempting legitimate approved leaves.

SELECT 
    u."id" AS user_id,
    u."name" AS employee_name,
    u."email" AS employee_email
FROM "User" u
WHERE u."accountType" = 'EMPLOYEE'
  AND u."isActive" = true
  AND NOT EXISTS (
      -- Exclude employees with any non-deleted time entry on the target day
      SELECT 1 
      FROM "TimeEntry" te
      WHERE te."userId" = u."id"
        AND te."workDate" = '2026-09-22'::date
        AND te."deletedAt" IS NULL
  )
  AND NOT EXISTS (
      -- Exclude employees with approved time off on the target day
      SELECT 1 
      FROM "TimeOffDay" tod
      WHERE tod."userId" = u."id"
        AND tod."date" = '2026-09-22'::date
        AND tod."status" = 'APPROVED'
  )
ORDER BY u."name" ASC;
