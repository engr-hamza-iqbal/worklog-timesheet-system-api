-- 04. Grouping by Time: Hours per week and per month for a chosen year.
-- Purpose: Groups work duration into chronological weekly and monthly buckets using PostgreSQL DATE_TRUNC.

-- A: Weekly Breakdown
SELECT 
    TO_CHAR(DATE_TRUNC('week', te."workDate"), 'YYYY-MM-DD') AS week_start_date,
    COUNT(te."id") AS total_entries,
    ROUND(COALESCE(SUM(te."durationMinutes"), 0) / 60.0, 2) AS weekly_hours
FROM "TimeEntry" te
WHERE te."status" = 'APPROVED'
  AND te."deletedAt" IS NULL
  AND EXTRACT(YEAR FROM te."workDate") = 2026
GROUP BY DATE_TRUNC('week', te."workDate")
ORDER BY week_start_date ASC;

-- B: Monthly Breakdown
SELECT 
    TO_CHAR(DATE_TRUNC('month', te."workDate"), 'YYYY-MM') AS year_month,
    COUNT(te."id") AS total_entries,
    ROUND(COALESCE(SUM(te."durationMinutes"), 0) / 60.0, 2) AS monthly_hours
FROM "TimeEntry" te
WHERE te."status" = 'APPROVED'
  AND te."deletedAt" IS NULL
  AND EXTRACT(YEAR FROM te."workDate") = 2026
GROUP BY DATE_TRUNC('month', te."workDate")
ORDER BY year_month ASC;
