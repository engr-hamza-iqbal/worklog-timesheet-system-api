-- 08. Filtering by What Someone May See: Entry list restricted to only the people and projects a given user has been granted access to.
-- Purpose: Demonstrates row-level capability and scope filtering directly in SQL.

-- Example for reviewer Carol (holding capability scoped to specific projects or users)
WITH caller_scope AS (
    SELECT 
        s."scopeType",
        s."targetUserId",
        s."targetProjectId"
    FROM "CapabilityGrant" cg
    JOIN "Capability" c ON c."id" = cg."capabilityId" AND c."code" = 'VIEW_OTHER_RECORDS'
    JOIN "CapabilityGrantScope" s ON s."grantId" = cg."id"
    WHERE cg."userId" = 'reviewer-user-uuid-placeholder'
      AND cg."revokedAt" IS NULL
      AND (cg."expiresAt" IS NULL OR cg."expiresAt" > NOW())
)
SELECT 
    te."id" AS entry_id,
    te."workDate",
    u."name" AS employee_name,
    p."name" AS project_name,
    c."name" AS client_name,
    ROUND(te."durationMinutes" / 60.0, 2) AS hours,
    te."status"
FROM "TimeEntry" te
JOIN "User" u ON u."id" = te."userId"
JOIN "Project" p ON p."id" = te."projectId"
JOIN "Client" c ON c."id" = p."clientId"
WHERE te."deletedAt" IS NULL
  AND (
      -- Caller is viewing their own records OR records in their authorized scope
      te."userId" = 'reviewer-user-uuid-placeholder'
      OR te."userId" IN (SELECT cs."targetUserId" FROM caller_scope cs WHERE cs."targetUserId" IS NOT NULL)
      OR te."projectId" IN (SELECT cs."targetProjectId" FROM caller_scope cs WHERE cs."targetProjectId" IS NOT NULL)
  )
ORDER BY te."workDate" DESC;
