-- 09. Chart Series: One row per week for a chosen period, with total hours for that week, including weeks where the total is zero.
-- Purpose: Feeds analytics charts with continuous date intervals without breaking trend line continuity.

WITH RECURSIVE weeks AS (
    -- Generate complete weekly series from start to end date
    SELECT DATE_TRUNC('week', '2026-06-01'::date) AS week_start
    UNION ALL
    SELECT (week_start + INTERVAL '1 week')::timestamp
    FROM weeks
    WHERE week_start < DATE_TRUNC('week', '2026-09-30'::date)
)
SELECT 
    TO_CHAR(w.week_start, 'YYYY-MM-DD') AS week,
    COALESCE(ROUND(SUM(te."durationMinutes") / 60.0, 2), 0.00) AS total_hours
FROM weeks w
LEFT JOIN "TimeEntry" te ON DATE_TRUNC('week', te."workDate") = w.week_start
                        AND te."status" = 'APPROVED'
                        AND te."deletedAt" IS NULL
GROUP BY w.week_start
ORDER BY w.week_start ASC;
