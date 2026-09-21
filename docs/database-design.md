# Database Architecture & Design Document
**Project:** Work Log & Timesheet System  
**Phase:** 1 — Backend Foundation & Database/Schema Design  
**Author:** Backend Architecture Team  
**Target Database:** PostgreSQL (Supabase Compatible) / Prisma ORM  

---

## 1. Design Overview

The **Work Log & Timesheet System** is an enterprise-grade application for recording daily employee work, managing multi-tier approval workflows, tracking client project billing, and scheduling leave. Unlike basic CRUD systems, approved time entries become immutable financial records that back client invoicing.

Key design tenants:
* **Two-Role Authorization Base with Dynamic Capabilities**: The system strictly defines two core account types (`EMPLOYEE` and `ADMIN`). All elevated permissions (reviewing time, deciding leave, viewing reports, billing) are managed via individually grantable, scopable, and immediately revocable capabilities stored in the database.
* **Dual-Audit Trail for Work Records**: Work entries decouple content versions (`TimeEntryRevision`) from lifecycle state transitions (`TimeEntryHistory`), preventing loss of previous submission/return comments.
* **Financial Immutability**: Approved entries cannot be directly edited or deleted. Changes require an explicit reopen action by an administrator, creating a transparent audit trail.
* **Exact Numerical Storage**: Monetary rates are stored using PostgreSQL `Decimal(10, 2)` and work duration is stored in whole integer minutes (`durationMinutes` divisible by 15), eliminating floating-point rounding errors.
* **High Query Performance**: Targeted composite indexes and materialized daily leave rows (`TimeOffDay`) optimize missing-timesheet and leave queries.

---

## 2. Entity List & Enums

### Enums
* `AccountType`: `EMPLOYEE`, `ADMIN` (strict system roles; no extraneous roles).
* `ProjectStatus`: `ACTIVE`, `CLOSED`.
* `TimeEntryStatus`: `DRAFT`, `SUBMITTED`, `RETURNED`, `APPROVED`.
* `TimeEntryAction`: `CREATE`, `UPDATE`, `SUBMIT`, `RETURN`, `RESUBMIT`, `APPROVE`, `REOPEN`, `DELETE`.
* `TimeOffStatus`: `PENDING`, `APPROVED`, `DECLINED`, `CANCELLED`.
* `CapabilityCode`: `VIEW_OTHER_RECORDS`, `REVIEW_TIME`, `DECIDE_TIME_OFF`, `MANAGE_CLIENTS_PROJECTS`, `ASSIGN_PROJECTS`, `MANAGE_USERS`, `VIEW_REPORTS`, `VIEW_ANALYTICS`, `VIEW_BILLING`.
* `ScopeType`: `USER`, `PROJECT`.
* `AccessAuditAction`: `GRANT`, `REVOKE`, `CHANGE_SCOPE`, `CHANGE_EXPIRY`.
* `EmailType`: `MISSING_TIMESHEET`, `ENTRY_RETURNED`, `TIME_OFF_DECIDED`, `TIME_OFF_REVIEW_REQUIRED`.
* `EmailStatus`: `PENDING`, `SENT`, `FAILED`.

### Entities
1. **User**: Authentication, account type (`EMPLOYEE` / `ADMIN`), and active status.
2. **Client**: External billable customer organization.
3. **Project**: Specific engagement belonging to a client.
4. **ProjectAssignment**: Temporal record linking an employee to a project (`assignedAt`, `removedAt`).
5. **ProjectRate**: Historical and current project hourly billing rates with date ranges (`effectiveFrom`, `effectiveTo`).
6. **TimeEntry**: The core identity and current state of a work log item.
7. **TimeEntryRevision**: Immutable snapshot of the data contents for each revision of a time entry.
8. **TimeEntryHistory**: Append-only log of workflow actions and state transitions with mandatory comments.
9. **TimeOffType**: Configurable leave classifications (Annual, Sick, Unpaid).
10. **TimeOffRequest**: Header date-range leave submission and approval status.
11. **TimeOffDay**: Materialized day-by-day table for rapid single-date absence lookups.
12. **Capability**: Seeded table of fixed system capabilities.
13. **CapabilityGrant**: Record of an active, expired, or revoked permission granted to a user.
14. **CapabilityGrantScope**: Scope restrictions attached to a capability grant (`USER` or `PROJECT`).
15. **AccessAuditLog**: Append-only security audit log recording permission grants, removals, and changes.
16. **EmailLog**: Complete audit log of all system email dispatch attempts and deduplication tracker.

---

## 3. Relationship Explanations

* **User to Projects (`ProjectAssignment`)**: A many-to-many relationship tracked through `ProjectAssignment`. Assignments retain their `assignedAt` and `removedAt` timestamps so historical work remains tied to past assignments, while active assignments have `removedAt IS NULL`.
* **Client to Project**: One-to-many. A client has multiple projects. Referential action `onDelete: Restrict` prevents accidental client deletion when active/historical projects exist.
* **Project to ProjectRate**: One-to-many. A project maintains a history of hourly billing rates. Exactly one rate has `effectiveTo IS NULL` (the current rate).
* **TimeEntry to Revision & History**: 
  * One `TimeEntry` has many `TimeEntryRevision` records (`[timeEntryId, revisionNumber]` unique).
  * One `TimeEntry` has many `TimeEntryHistory` records capturing state changes (`CREATE`, `SUBMIT`, `RETURN`, `APPROVE`, `REOPEN`).
* **TimeOffRequest to TimeOffDay**: One-to-many. When an employee requests a date range (e.g. Sep 10 to Sep 13), individual `TimeOffDay` records are materialized. Deleting or canceling the parent request cascades to these days.
* **Capability to CapabilityGrant to CapabilityGrantScope**:
  * `Capability` defines system abilities.
  * `CapabilityGrant` records that User A received Capability C from Administrator B.
  * `CapabilityGrantScope` attaches zero or more target boundaries. Zero scopes indicate a **GLOBAL** grant; one or more scopes limit the permission strictly to designated projects or users.

---

## 4. Text-Based ERD

```
User (id, email, accountType, isActive)
 ├──< ProjectAssignment (id, userId, projectId, assignedAt, removedAt)
 │     └──> Project (id, clientId, name, status) ──> Client (id, name, isActive)
 │           └──< ProjectRate (id, projectId, ratePerHour, effectiveFrom, effectiveTo)
 │
 ├──< TimeEntry (id, userId, projectId, workDate, durationMinutes, status, approvedRateSnapshot)
 │     ├──< TimeEntryRevision (id, timeEntryId, revisionNumber, workDate, durationMinutes, description, billingRateSnapshot)
 │     └──< TimeEntryHistory (id, timeEntryId, action, previousStatus, newStatus, performedById, comment)
 │
 ├──< TimeOffRequest (id, userId, timeOffTypeId, startDate, endDate, status, decidedById)
 │     ├──> TimeOffType (id, name, isActive)
 │     └──< TimeOffDay (id, timeOffRequestId, userId, date, status)
 │
 ├──< CapabilityGrant (id, userId, capabilityId, grantedById, expiresAt, revokedAt)
 │     ├──> Capability (id, code, description)
 │     └──< CapabilityGrantScope (id, grantId, scopeType, targetUserId, targetProjectId)
 │
 ├──< AccessAuditLog (id, action, actorId, targetUserId, capabilityCode, grantId, details)
 └──< EmailLog (id, recipientUserId, emailType, referenceDate, status, attemptedAt)
```

---

## 5. Billing-Rate Strategy

### Financial Precision
Floating-point primitives (`FLOAT`, `DOUBLE`) introduce binary fraction rounding errors that are unacceptable in invoicing. Billing rates are stored using PostgreSQL `Decimal(10, 2)` (supporting values up to £99,999,999.99 with exact cent precision).

### Effective Date Range Pattern
Project rates are tracked in `ProjectRate` using `effectiveFrom` and `effectiveTo`:
* When a project rate changes from £50/hr to £70/hr on July 1, 2026:
  * The existing rate's `effectiveTo` is updated to `2026-06-30 23:59:59`.
  * A new `ProjectRate` record is created with `effectiveFrom = 2026-07-01 00:00:00` and `effectiveTo = null`.

### Approved Rate Snapshots
To guarantee that historical financial reports can be reproduced identically even if rates or projects are reconfigured, `TimeEntry` captures `approvedRateSnapshot` (`Decimal(10, 2)`) at the exact moment an administrator approves the entry. Furthermore, `TimeEntryRevision` records `billingRateSnapshot` for auditability.

---

## 6. Time Storage Strategy

* **Integer Minutes**: Work duration is stored as whole integer minutes (`durationMinutes`), constrained to positive multiples of 15 (e.g., 15, 30, 45, 60, 75, etc.).
* **Why Not Decimals?** Storing hours as decimals (e.g. 0.3333 or 1.25) leads to conversion ambiguities, rounding inaccuracies across sums, and floating-point comparison bugs in SQL.
* **Validation Support**: Whole minutes make server-side validation trivial:
  * `durationMinutes > 0`
  * `durationMinutes % 15 === 0`
  * `dailyTotalMinutes <= 1440` (24 hours).
* Displaying `1.25 hours` in the UI is a simple client-side representation (`durationMinutes / 60`).

---

## 7. Revision & History Strategy

To support the lifecycle:
`DRAFT → SUBMITTED → RETURNED (with comment) → CORRECTED → RESUBMITTED → APPROVED`

The schema separates **data state** from **workflow transitions**:
1. **`TimeEntry`**: Represents identity and current operational state.
2. **`TimeEntryRevision`**: Represents immutable versions of the payload (hours, description, work date). Revision 1 is created on draft creation. When an entry is returned and updated, Revision 2 is created.
3. **`TimeEntryHistory`**: An append-only log capturing every action (`CREATE`, `SUBMIT`, `RETURN`, `RESUBMIT`, `APPROVE`, `REOPEN`), the previous and new status, who performed the action, and mandatory comments (such as the reviewer's reason for returning the work or the admin's reason for reopening).

If an approved entry is found to have an error:
* Direct editing is blocked.
* An administrator performs an explicit `REOPEN` action with an explanatory comment.
* A `TimeEntryHistory` record is written logging the reopen event.
* A new `TimeEntryRevision` is drafted for the correction, leaving the previously approved revision intact in history.

---

## 8. Permission & Scope Strategy

### Core Principles
* The system enforces zero-trust permission resolution: capabilities are **never** trusted from a JWT claim. The JWT contains only the user's identity.
* Capabilities are evaluated dynamically against the database on each request.
* **Immediate Revocation**: Setting `revokedAt = NOW()` or letting `expiresAt` lapse terminates access instantly.

### Scope Hierarchy
* **Global Scope**: A `CapabilityGrant` with zero associated `CapabilityGrantScope` rows applies globally across all projects and users.
* **Scoped Grants**: A `CapabilityGrant` with one or more `CapabilityGrantScope` rows limits the permission:
  * `scopeType = PROJECT`: Restricts permissions (such as `REVIEW_TIME`) strictly to the specified `targetProjectId`.
  * `scopeType = USER`: Restricts permissions (such as `VIEW_OTHER_RECORDS`) strictly to the specified `targetUserId`.
* **Database Query Efficiency**: The compound index `@@index([userId, capabilityId, revokedAt, expiresAt])` enables the authorization middleware to answer *"Does this user hold capability X right now within scope Y?"* in a single indexed query.

---

## 9. Time-Off Strategy & Materialized Day Model

A time off request spans a date range (e.g., September 10 to September 13). However, business logic frequently demands answering single-day queries:
* *"Who is absent today?"*
* *"Has this employee logged time on a day they were on approved leave?"*
* Missing timesheet detection (finding missing entries while excluding approved leave days).

### Materialized `TimeOffDay`
Each `TimeOffRequest` materializes child rows in `TimeOffDay` for every calendar date in the request range.
* `TimeOffDay` contains `[userId, date, status]`.
* Indexed on `[userId, date, status]` and `[date, status]`.
* Finding if an employee is on approved leave on `2026-09-12` is a simple indexed equality lookup (`WHERE userId = ? AND date = '2026-09-12' AND status = 'APPROVED'`) without requiring complex SQL interval overlaps.

---

## 10. Index Decisions & Rationale

| Table | Index Columns | Rationale |
|---|---|---|
| `User` | `[email, isActive]` | Fast authentication lookup and active user verification. |
| `User` | `[accountType, isActive]` | Quick filtering for administrators in security checks. |
| `Project` | `[clientId, status]` | Filtering projects for client billing and active project selection. |
| `ProjectAssignment` | `[userId, projectId, removedAt]` | Primary check for whether a user is currently allowed to log time on a project (`removedAt IS NULL`). |
| `ProjectAssignment` | `[projectId, removedAt]` | Efficient listing of all team members actively assigned to a project. |
| `ProjectRate` | `[projectId, effectiveFrom, effectiveTo]` | Rapid resolution of applicable hourly rate for any given date. |
| `TimeEntry` | `[userId, workDate]` | Essential for employee timesheet views ("My Week", "Record Time"). |
| `TimeEntry` | `[projectId, workDate]` | Project timesheet aggregations and billing reports. |
| `TimeEntry` | `[status, workDate]` | Admin review queues ("All pending entries this week"). |
| `TimeEntry` | `[userId, status, workDate]` | Employee status breakdowns and submission completeness queries. |
| `TimeEntryRevision` | `[timeEntryId, revisionNumber]` (Unique) | Guarantees ordered, non-conflicting content revisions per entry. |
| `TimeEntryHistory` | `[timeEntryId, createdAt]` | Chronological replay of workflow events for audit logs. |
| `TimeOffDay` | `[userId, date, status]` | Point-in-time absence verification and missing timesheet exclusions. |
| `CapabilityGrant` | `[userId, capabilityId, revokedAt, expiresAt]` | Real-time authorization check evaluating active grants on every API request. |
| `EmailLog` | `[recipientUserId, emailType, referenceDate, attemptedAt]` | Prevents duplicate missing-timesheet reminder emails from being sent twice in a single day. |

---

## 11. Foreign-Key & Delete Policies

| Relation | Action | Rationale |
|---|---|---|
| `Project -> Client` | `Restrict` | Prevents deleting a client when associated projects exist. Clients must be marked inactive (`isActive = false`) rather than physically deleted. |
| `ProjectAssignment -> User` | `Restrict` | Prevents deleting a user who has historical project assignment records. |
| `ProjectAssignment -> Project` | `Restrict` | Prevents deleting a project with assignment history. |
| `ProjectRate -> Project` | `Restrict` | Prevents deleting a project with financial rate history. |
| `TimeEntry -> User` | `Restrict` | Preserves all historical timesheet records for compliance; users are disabled via `isActive = false`. |
| `TimeEntry -> Project` | `Restrict` | Projects with recorded time cannot be deleted; they must be transitioned to `CLOSED`. |
| `TimeEntryRevision -> TimeEntry` | `Restrict` | Content revisions must never be orphaned or partially deleted. |
| `TimeEntryHistory -> TimeEntry` | `Restrict` | Preserves immutable workflow transition logs. |
| `TimeOffRequest -> User` | `Restrict` | Protects leave records for HR compliance. |
| `TimeOffDay -> TimeOffRequest` | `Cascade` | `TimeOffDay` is a materialized child table. If a request is deleted or purged, its daily projection must clean up automatically. |
| `CapabilityGrantScope -> CapabilityGrant` | `Cascade` | Scope records exist solely as parameters of a grant; removing a grant automatically cleans up its scopes. |
| `EmailLog -> User` | `SetNull` | If a user record is ever anonymized or removed in GDPR processes, historical email delivery logs remain intact for auditing. |

---

## 12. Schema Review Answers

**1. Where does the billing rate belong, and what happens when it changes?**  
The billing rate belongs in a dedicated `ProjectRate` history table linked to the `Project`, defined with `effectiveFrom` and `effectiveTo` timestamps. When a project's rate changes, the current rate's `effectiveTo` is stamped with the transition timestamp and a new `ProjectRate` record is created. Approved work entries preserve an immutable snapshot in `TimeEntry.approvedRateSnapshot`, guaranteeing that past approved financial totals never fluctuate.

**2. How does the system know which projects a user may record against?**  
The system inspects `ProjectAssignment` for an active link where `userId` matches the employee, `projectId` matches the target project, and `removedAt IS NULL`. Additionally, the system verifies that the target `Project.status` is `ACTIVE`. If an assignment has `removedAt` set or the project is `CLOSED`, recording time is rejected.

**3. What happens when someone leaves a project?**  
When an employee leaves a project, the corresponding `ProjectAssignment` record is updated with `removedAt = NOW()`. The row is retained to preserve historical validity of past work, but all future time entry validation checks fail because no active assignment (`removedAt IS NULL`) exists.

**4. How is duration stored and why?**  
Duration is stored as an integer number of whole minutes (`durationMinutes`), constrained to positive values divisible by 15. Storing whole integers prevents floating-point inaccuracies, simplifies database arithmetic and validations (`dailyMinutes <= 1440`), and seamlessly maps to standard 0.25-hour timesheet increments.

**5. How do we preserve: submitted → returned → corrected → submitted again?**  
The lifecycle is preserved by decoupling the current entry state (`TimeEntry`) from its content revisions (`TimeEntryRevision`) and workflow history (`TimeEntryHistory`). When an entry is returned, a history record captures the reviewer's mandatory comment and status change; when the employee corrects the entry, a new incremented revision (`revisionNumber = 2`) is inserted, leaving the previous revision and return history completely intact.

**6. If an approved entry is wrong, do we change it or replace/revise it?**  
We never overwrite an approved entry directly. An administrator must perform an explicit `REOPEN` action, which records a history entry with a mandatory explanation and reverts the status to allow corrections. The employee then publishes a new `TimeEntryRevision` which undergoes the submission and review cycle once more.

**7. How can we prove what the original approved entry contained?**  
Every approved entry is backed by an immutable `TimeEntryRevision` row stamped with the revision number, exact minutes, project, date, description, and billing rate snapshot at the time of submission. By inspecting `TimeEntryRevision` alongside `TimeEntryHistory`, an auditor can reconstruct the exact payload of any version that was previously approved.

**8. What stops the same work from being counted twice in billing reports?**  
Billing reports query the `TimeEntry` parent table filtering strictly for `status = 'APPROVED'`. Revisions and history entries are not aggregated in billing queries; only the single authoritative `TimeEntry` row with its approved duration and rate snapshot is counted.

**9. Which columns need indexes and why?**  
`TimeEntry` requires composite indexes on `[userId, workDate]`, `[projectId, workDate]`, and `[status, workDate]` because timesheets, project billing, and review queues always filter by date combined with person, project, or approval state. `CapabilityGrant` requires `[userId, capabilityId, revokedAt, expiresAt]` for instantaneous permission verification on every request. `TimeOffDay` indexes `[userId, date, status]` to make single-day absence lookups instantaneous.

**10. What happens if someone tries to delete a project containing historical time?**  
The database blocks the deletion because the foreign key between `TimeEntry` and `Project` is defined with `onDelete: Restrict`. Projects containing historical records cannot be deleted; instead, administrators must transition their status to `CLOSED` to prevent new entries while safeguarding historical data.

**11. Should time entries and time-off requests use one table or separate tables? Explain.**  
They must use separate tables (`TimeEntry` and `TimeOffRequest`) because their domain semantics, attributes, and lifecycles diverge significantly. Time entries represent quantifiable billable duration against client projects with monetary rates and revisions, whereas time-off represents date intervals associated with HR leave categories without billing rates or project assignments. Mixing them into one table would lead to sparse null columns and convoluted constraints.

**12. How is a date-range time-off request represented so checking one particular date stays fast?**  
While `TimeOffRequest` stores the user's high-level `startDate` and `endDate`, the system materializes individual calendar dates into a child table called `TimeOffDay`. Checking whether an employee was absent on a specific date is a high-speed indexed lookup on `TimeOffDay(userId, date, status)` rather than a slow range-overlap computation.

**13. Are capabilities stored in code, database, or both? Explain.**  
Capabilities are stored in both. The database maintains a `Capability` master table with unique codes to maintain referential integrity with grants and audit logs. The application code mirrors these stable codes via a TypeScript enum (`CapabilityCode`) so controllers and middleware can reference strongly typed constants during compile-time checks.

**14. How do scopes support global, user-specific and project-specific permissions?**  
A `CapabilityGrant` with zero records in `CapabilityGrantScope` is interpreted as GLOBAL, granting the user system-wide authority for that action. When `CapabilityGrantScope` rows are attached, the grant is constrained: rows with `scopeType = PROJECT` restrict access to specific `targetProjectId` values, while rows with `scopeType = USER` restrict access to specific `targetUserId` values.

**15. Why shouldn't authoritative capabilities simply be stored inside the JWT?**  
JWTs are stateless and cannot be invalidated before expiration without maintaining token revocation blacklists. If an administrator revokes a rogue user's access, a token containing baked-in permissions would allow the user to continue performing unauthorized actions until token expiry.

**16. How does immediate revocation work?**  
When an administrator revokes access, the API sets `revokedAt = NOW()` and records `revokedById` on the `CapabilityGrant`. Because the authorization layer checks active grants in the database on every authenticated request (`WHERE revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > NOW())`), the revocation takes effect instantly on the next API call.

**17. How does the API later answer: “What can this user do right now?”**  
The API queries `CapabilityGrant` joining `Capability` and `CapabilityGrantScope` for the user where `revokedAt IS NULL` and `(expiresAt IS NULL OR expiresAt > NOW())`. The resulting set provides the exact list of active capability codes along with any attached user/project scope IDs.

**18. How are email attempts stored?**  
Email attempts are persisted in the `EmailLog` table, recording `recipientUserId`, `recipientEmail`, `emailType`, `subject`, `relatedEntityType`, `relatedEntityId`, `referenceDate`, `status` (`PENDING`, `SENT`, `FAILED`), `errorMessage`, and `attemptedAt`. This guarantees full audibility regardless of whether the email transport succeeds or fails.

**19. How is duplicate missing-timesheet reminder sending prevented?**  
The `EmailLog` table includes a composite index on `[recipientUserId, emailType, referenceDate, attemptedAt]`. Before dispatching a reminder for missing date `D`, the service checks whether an `EmailLog` row exists for that user, date, and `emailType = MISSING_TIMESHEET` with `attemptedAt` within the current calendar day, aborting duplicate sends.

**20. How will the schema support auditability of financial records?**  
Financial auditability is guaranteed through three architectural pillars: (1) `ProjectRate` captures time-bounded billing rates with `effectiveFrom`/`effectiveTo`; (2) `TimeEntry` locks an immutable `approvedRateSnapshot` upon approval; and (3) `TimeEntryRevision` and `TimeEntryHistory` maintain an unalterable history of all versions and administrative state transitions.

---

## 13. Trade-Offs & Alternatives Considered

1. **Integer Minutes vs. Decimal Hours**: Storing decimal hours (e.g. `1.25`) was rejected due to IEEE-754 floating point inaccuracies and rounding discrepancies across multi-entry aggregations. Whole integer minutes guarantee exact precision.
2. **Materialized `TimeOffDay` vs. Date Range Queries**: Calculating absences purely through `startDate <= date AND endDate >= date` on `TimeOffRequest` causes expensive range-scans on missing timesheet reports. Materializing daily rows in `TimeOffDay` trades minimal disk space for indexed single-day lookups.
3. **Dedicated Revisions Table vs. Single Status Column**: A single status column on `TimeEntry` would overwrite historical descriptions and return reasons upon resubmission. The separate `TimeEntryRevision` and `TimeEntryHistory` structure preserves full legal and financial audit trails.
4. **Dynamic Database Grants vs. JWT Claims**: Storing capabilities in JWT claims would avoid database lookups but violate the critical requirement for immediate permission revocation. Dynamic database resolution ensures immediate access cut-offs.
