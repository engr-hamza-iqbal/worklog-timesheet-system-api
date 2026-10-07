-- 07. Counting: How many entries are waiting, grouped by who is able to review them.
-- Purpose: Visualizes review bottlenecks and workload distribution across managers and admins.

WITH active_reviewers AS (
    -- Administrators can review everything
    SELECT u."id" AS reviewer_id, u."name" AS reviewer_name, 'ADMIN' AS role_type, true AS is_global, NULL::text AS target_user_id, NULL::text AS target_project_id
    FROM "User" u
    WHERE u."accountType" = 'ADMIN' AND u."isActive" = true

    UNION ALL

    -- Employees with active REVIEW_TIME grants
    SELECT 
        u."id" AS reviewer_id, 
        u."name" AS reviewer_name, 
        'REVIEWER' AS role_type,
        CASE WHEN COUNT(s."id") = 0 THEN true ELSE false END AS is_global,
        s."targetUserId" AS target_user_id,
        s."targetProjectId" AS target_project_id
    FROM "CapabilityGrant" cg
    JOIN "Capability" c ON c."id" = cg."capabilityId" AND c."code" = 'REVIEW_TIME'
    JOIN "User" u ON u."id" = cg."userId" AND u."isActive" = true
    LEFT JOIN "CapabilityGrantScope" s ON s."grantId" = cg."id"
    WHERE cg."revokedAt" IS NULL
      AND (cg."expiresAt" IS NULL OR cg."expiresAt" > NOW())
    GROUP BY u."id", u."name", s."targetUserId", s."targetProjectId"
)
SELECT 
    r.reviewer_id,
    r.reviewer_name,
    r.role_type,
    COUNT(te."id") AS waiting_entries_count,
    ROUND(COALESCE(SUM(te."durationMinutes"), 0) / 60.0, 2) AS waiting_hours
FROM active_reviewers r
JOIN "TimeEntry" te ON te."status" = 'SUBMITTED' 
                  AND te."deletedAt" IS NULL
                  AND te."userId" <> r.reviewer_id -- Business Rule: Reviewers cannot approve own work
                  AND (
                      r.is_global = true 
                      OR te."userId" = r.target_user_id 
                      OR te."projectId" = r.target_project_id
                  )
GROUP BY r.reviewer_id, r.reviewer_name, r.role_type
ORDER BY waiting_entries_count DESC, waiting_hours DESC;
