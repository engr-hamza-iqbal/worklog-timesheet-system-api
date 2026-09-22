# End of Day (EOD) Report: Work Log & Timesheet System

**Date:** September 21, 2026  
**Author:** Backend Architecture & Engineering Team  
**Scope Covered:** Phase 1 (Database & Schema Design) through Milestone 3 (Authentication & Access Control)  
**Repositories:**
* Backend: [`worklog-timesheet-system-api`](https://github.com/engr-hamza-iqbal/worklog-timesheet-system-api.git)
* Frontend: [`worklog-timesheet-system-ui`](https://github.com/engr-hamza-iqbal/worklog-timesheet-system-ui.git)

---

## 1. Executive Summary

Today we successfully established the foundational architecture, database schema, and security framework for the **Work Log & Timesheet System**. In full alignment with the project requirements (`req.md`, `prompt.md`, and `git-setup.md`), we:
1. Designed and validated a defensible, PostgreSQL-compatible Prisma database schema consisting of **11 Enums** and **16 Models**.
2. Converted the codebase to native **Node.js ES Modules (`"type": "module"`)** without TypeScript, utilizing pure Express and Prisma.
3. Created, pushed, and seeded a local PostgreSQL database (`worklog_db` on port 5432) and verified **Prisma Studio** integration.
4. Implemented end-to-end **JWT Authentication** and the **Dynamic Capability-Based Access Control Engine**.
5. Documented all endpoints via interactive **Swagger OpenAPI (`/api-docs`)**.
6. Maintained strict Git branch hygiene, committing all work to dedicated feature branches and opening GitHub Pull Requests.

---

## 2. Milestones Completed

| Milestone | Status | Description |
|---|---|---|
| **1. Schema Design** | Completed | Full database schema designed, verified, and accompanied by comprehensive architectural documentation answering all 20 required design review questions. |
| **2. Setup & Seeding** | Completed | Backend and frontend repositories initialized and linked to GitHub remotes. Database migrated, seeded with realistic test data, and Prisma Studio operational. |
| **3. Auth & Access Control** | Completed | Registration, login, token generation, centralized capability-checking middleware, and real-time permission resolution working end-to-end. |

---

## 3. Technology Stack Compliance

* **Backend**: Node.js v22 (native ES Modules), Express v4.21, Prisma ORM v5.22, bcryptjs, jsonwebtoken, swagger-ui-express.
* **Database**: PostgreSQL (local instance active on port 5432; Supabase production ready).
* **Frontend Base**: React 19, Vite (pure JavaScript / JSX), linked to UI remote.
* **Architecture**: Strict separation of concerns (Routes → Controllers → Services → Database via Prisma Client).

---

## 4. Database Architecture & Design Highlights

Detailed documentation available in [`docs/database-design.md`](file:///c:/Users/hamza/OneDrive/Desktop/Interview%20Toolshed/training-20260824/Work%20Log%20&%20Timesheet%20System/docs/database-design.md).

### 11 Enums
* `AccountType`: `EMPLOYEE`, `ADMIN` (strictly only two account roles; no role explosion).
* `ProjectStatus`: `ACTIVE`, `CLOSED`.
* `TimeEntryStatus`: `DRAFT`, `SUBMITTED`, `RETURNED`, `APPROVED`.
* `TimeEntryAction`: `CREATE`, `UPDATE`, `SUBMIT`, `RETURN`, `RESUBMIT`, `APPROVE`, `REOPEN`, `DELETE`.
* `TimeOffStatus`: `PENDING`, `APPROVED`, `DECLINED`, `CANCELLED`.
* `CapabilityCode`: `VIEW_OTHER_RECORDS`, `REVIEW_TIME`, `DECIDE_TIME_OFF`, `MANAGE_CLIENTS_PROJECTS`, `ASSIGN_PROJECTS`, `MANAGE_USERS`, `VIEW_REPORTS`, `VIEW_ANALYTICS`, `VIEW_BILLING`.
* `ScopeType`: `USER`, `PROJECT`.
* `AccessAuditAction`: `GRANT`, `REVOKE`, `CHANGE_SCOPE`, `CHANGE_EXPIRY`.
* `EmailType`: `MISSING_TIMESHEET`, `ENTRY_RETURNED`, `TIME_OFF_DECIDED`, `TIME_OFF_REVIEW_REQUIRED`.
* `EmailStatus`: `PENDING`, `SENT`, `FAILED`.

### 16 Core Models
1. **`User`**: Credentials, soft-activation status (`isActive`), and `AccountType`.
2. **`Client`**: Billable organizations.
3. **`Project`**: Engagements belonging to clients with `ACTIVE`/`CLOSED` state.
4. **`ProjectAssignment`**: M:N relation tracking historical assignments via `assignedAt` and `removedAt`.
5. **`ProjectRate`**: Historical hourly billing rates with `effectiveFrom` and `effectiveTo` using `Decimal(10, 2)`.
6. **`TimeEntry`**: Operational work records storing whole minutes (`durationMinutes` divisible by 15) and immutable `approvedRateSnapshot`.
7. **`TimeEntryRevision`**: Immutable snapshots of work content across revisions.
8. **`TimeEntryHistory`**: Complete audit log of state transitions and return/reopen comments.
9. **`TimeOffType`**: Configurable leave categories (Annual, Sick, Unpaid).
10. **`TimeOffRequest`**: Header leave request records.
11. **`TimeOffDay`**: Materialized day-level records for fast point-in-time absence lookups and missing timesheet exclusions.
12. **`Capability`**: Master table of the 9 fixed system capabilities.
13. **`CapabilityGrant`**: Dynamic, expirational, and immediately revocable user permissions.
14. **`CapabilityGrantScope`**: Grant boundary restrictions (`USER` or `PROJECT`).
15. **`AccessAuditLog`**: Append-only security audit trail.
16. **`EmailLog`**: Dispatch audit log with deduplication index for missing-timesheet reminders.

---

## 5. Seeded Test Data & Credentials

The database is seeded via `npm run prisma:seed`. All seeded users use the password: **`Password123!`**

| Name | Email | Role | Configured Capabilities / Scopes |
|---|---|---|---|
| **Alice Administrator** | `admin@worklog.local` | `ADMIN` | Holds all 9 capabilities globally with root administrative authority. |
| **Bob Builder** | `bob@worklog.local` | `EMPLOYEE` | Holds `VIEW_REPORTS` (Global) and `REVIEW_TIME` (Scoped strictly to *Acme Core Platform*). |
| **Carol Consultant** | `carol@worklog.local` | `EMPLOYEE` | Holds `VIEW_OTHER_RECORDS` (Scoped to *Dan Developer*) and `DECIDE_TIME_OFF` (Temporary 14-day grant). |
| **Dan Developer** | `dan@worklog.local` | `EMPLOYEE` | Formerly held `VIEW_BILLING`; now marked as revoked to test immediate access termination. |
| **Eva Engineer** | `eva@worklog.local` | `EMPLOYEE` | Standard employee account with default personal timesheet capabilities. |

---

## 6. Authentication & API Endpoints Implemented

Interactive documentation is live at `http://localhost:5000/api-docs`.

* **`POST /api/auth/register`**: Validates user payload, hashes password, assigns `EMPLOYEE` (or initial `ADMIN` if database is empty), and returns JWT.
* **`POST /api/auth/login`**: Authenticates credentials against active accounts; returns profile, JWT token, and active capabilities.
* **`GET /api/auth/me`**: Protected endpoint returning the caller's profile and real-time active capabilities and scopes matrix.
* **`POST /api/auth/logout`**: Client-side session termination confirmation.
* **`GET /health`**: Health check probe verifying API and PostgreSQL database connectivity.
* **`GET /api-docs`**: Full Swagger OpenAPI 3.0 interactive documentation.

### Zero-Trust Capability Resolution
* The authorization middleware (`requireCapability`) resolves permissions from the database on every authenticated request using the composite index `[userId, capabilityId, revokedAt, expiresAt]`.
* Tokens only store `{ userId, email, accountType }`, ensuring immediate access termination when an administrator revokes a grant.

---

## 7. How to Run the Project & Prisma Studio

Navigate to the `server/` directory:

```powershell
cd "Work Log & Timesheet System\server"
```

1. **Start the API Server (Development Mode with Auto-Reload)**:
   ```powershell
   npm run dev
   # Accessible at: http://localhost:5000
   # Swagger Docs:  http://localhost:5000/api-docs
   # Health Check:  http://localhost:5000/health
   ```

2. **Launch Prisma Studio (Database GUI)**:
   ```powershell
   npm run studio
   # Accessible at: http://localhost:5555
   ```

3. **Re-run Database Migrations / Sync**:
   ```powershell
   npm run prisma db push
   # or
   npm run prisma:migrate
   ```

4. **Re-seed the Database**:
   ```powershell
   npm run prisma:seed
   ```

5. **Run Automated Authentication Tests**:
   ```powershell
   npm run test:auth
   ```

---

## 8. Git Branches & Pull Requests

1. **Phase 1 Schema Design**:
   * Branch: `feature/phase-1-schema-design`
   * PR #1: Merged into `main`.
2. **Phase 2 & 3 Authentication and Access Control**:
   * Branch: `feature/auth-and-access-control`
   * Pushed to: `origin/feature/auth-and-access-control`
   * Pull Request URL: [`https://github.com/engr-hamza-iqbal/worklog-timesheet-system-api/pull/new/feature/auth-and-access-control`](https://github.com/engr-hamza-iqbal/worklog-timesheet-system-api/pull/new/feature/auth-and-access-control)
3. **Frontend Initial Scaffold**:
   * Branch: `feature/client-scaffold`
   * Pull Request URL: [`https://github.com/engr-hamza-iqbal/worklog-timesheet-system-ui/pull/new/feature/client-scaffold`](https://github.com/engr-hamza-iqbal/worklog-timesheet-system-ui/pull/new/feature/client-scaffold)

---

## 9. Next Steps (Tomorrow / Milestone 4)

* **Milestone 4: Administration Module**:
  * Client CRUD (create, update, archive).
  * Project management (create, update, open/close, billing rate assignment).
  * Project assignments (assign/remove employees).
  * User management (create users, update details, soft-deactivate).
  * Access management (grant/revoke capabilities, set scopes, set expiration dates, audit logging).
