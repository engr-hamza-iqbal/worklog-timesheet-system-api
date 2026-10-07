# Practised SQL Queries & Relational Database Architecture

This directory contains the reference SQL queries specified in `req.md` (lines 272–286) for direct execution against PostgreSQL / Supabase, followed by architectural defenses for database design choices.

---

## Index of Practised Queries

1. [`01_joins_entry_person_project_client.sql`](./01_joins_entry_person_project_client.sql)  
   Joins across 4 tables (`TimeEntry`, `User`, `Project`, `Client`) showing who worked on what and for whom.
2. [`02_aggregation_approved_hours_by_project.sql`](./02_aggregation_approved_hours_by_project.sql)  
   Aggregates total approved hours by project with date range boundaries.
3. [`03_arithmetic_billable_value_by_client.sql`](./03_arithmetic_billable_value_by_client.sql)  
   Computes financial billable totals from durations and snapshot rates (`Decimal(10,2)`).
4. [`04_grouping_by_time_week_and_month.sql`](./04_grouping_by_time_week_and_month.sql)  
   Uses `DATE_TRUNC('week', ...)` and `DATE_TRUNC('month', ...)` for chronological aggregation.
5. [`05_left_join_all_active_projects_including_zero.sql`](./05_left_join_all_active_projects_including_zero.sql)  
   `LEFT JOIN` that retains all active projects even if they have 0 recorded hours.
6. [`06_finding_absent_missing_timesheets.sql`](./06_finding_absent_missing_timesheets.sql)  
   Finding absence: employees with 0 entries on a working day, excluding approved leaves.
7. [`07_counting_waiting_entries_by_reviewer.sql`](./07_counting_waiting_entries_by_reviewer.sql)  
   Counts waiting submitted entries grouped by who holds the capability to review them.
8. [`08_filtering_by_scope.sql`](./08_filtering_by_scope.sql)  
   Row-level security in SQL filtering records by project and user grants.
9. [`09_chart_series_weekly_trend_including_zeroes.sql`](./09_chart_series_weekly_trend_including_zeroes.sql)  
   Generates a continuous weekly series using `WITH RECURSIVE` so weeks with 0 hours are not dropped.
10. [`10_two_things_at_once_hours_worked_and_days_away.sql`](./10_two_things_at_once_hours_worked_and_days_away.sql)  
    Simultaneous aggregation of hours worked and approved days away for a single employee.

---

## Architectural & Engineering Concepts Defended

### 1. Transactions: COMMIT and ROLLBACK
- **What they mean**: A database transaction wraps multiple discrete SQL operations into a single atomic unit of work (ACID). If every query succeeds, `COMMIT` persists all modifications to disk. If any validation, constraint, or server error occurs, `ROLLBACK` reverts every change, ensuring the database never remains in a corrupt intermediate state.
- **Where we use it**:
  - Approving entries + writing history log + saving financial snapshots.
  - Creating time entries + writing initial creation history.
  - Deactivating users + validating last remaining active administrator.

### 2. Foreign Keys and Referential Actions (`Restrict` vs `Cascade`)
- **What should happen when something they point at is deleted**:
  - `onDelete: Restrict` is enforced on `User`, `Project`, `Client`, and `TimeEntry`. If an administrator tries to delete a Client or Project that has recorded time entries or assignments, the database rejects the query. Financial and labor records can never become orphaned.
  - `onDelete: Cascade` is reserved strictly for ephemeral child partitions such as `TimeOffDay` (derived from `TimeOffRequest`) and `CapabilityGrantScope` (derived from `CapabilityGrant`).

### 3. Indexes and Performance
- **Why unindexed lookups on large tables fail**: Without an index, the database engine must execute a Full Sequential Table Scan (`Seq Scan`), loading every disk page and checking every row $O(N)$. On a table with 500,000 time entries, this introduces multi-second latencies and disk I/O bottlenecks.
- **Indexes implemented in `schema.prisma`**:
  - `[userId, workDate]` — Instant weekly/daily calendar loading.
  - `[status, workDate]` — Instant review queue querying.
  - `[userId, date, status]` on `TimeOffDay` — Fast exclusion check for missing timesheets.
  - `[email, isActive]` on `User` — Sub-millisecond credential lookup.

### 4. The N+1 Query Problem and Prevention
- **The Problem**: Executing 1 query to fetch $N$ parent records (e.g. 50 time entries), and then executing a separate database query inside a loop for each record to fetch its project ($N$ queries), causing 51 round trips.
- **How we prevent it**:
  - We use Prisma's `include` / `select` relations, which generate SQL `JOIN` or optimized single `IN (...)` queries.
  - In reporting and analytics, we use single `$queryRaw` statements with explicit SQL joins and aggregations.

### 5. Data Types: Floating-Point Rounding vs Integer Minutes & Fixed Decimal
- **Why `float` or `double` is forbidden for time and money**: IEEE 754 floating-point numbers cannot accurately represent base-10 fractions (e.g., `0.1 + 0.2 = 0.30000000000000004`). In financial billing, rounding errors compound over thousands of rows, causing ledger discrepancies.
- **Our Solution**:
  - **Duration**: Stored as integer `durationMinutes` (e.g. 15, 30, 45, 60). No rounding error is possible.
  - **Rates & Billable Values**: Stored as PostgreSQL `Decimal(10, 2)`.
