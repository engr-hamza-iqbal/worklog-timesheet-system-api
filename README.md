# Work Log & Timesheet System — Backend API

Enterprise-grade, audit-ready backend REST API for employee time tracking, timesheet approval lifecycles, capability-based access control (CBAC), historical billing rate snapshots, time-off requests, and background email dispatch.

---

## Table of Contents
- [System Architecture](#system-architecture)
- [Key Features & Business Rules](#key-features--business-rules)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Environment Variables](#environment-variables)
- [Installation & Database Setup](#installation--database-setup)
- [Running the Application](#running-the-application)
- [Seeded Demo Accounts](#seeded-demo-accounts)
- [API Documentation & Swagger UI](#api-documentation--swagger-ui)
- [Durable Email Worker Architecture](#durable-email-worker-architecture)
- [Automated Verification & Test Suite](#automated-verification--test-suite)
- [Production Deployment (Render)](#production-deployment-render)

---

## System Architecture

The API follows a layered Express.js architecture with clean separation of concerns:

```
HTTP Requests
    │
    ▼
[Middleware Layer]  ──► Rate Limiting, CORS, JWT Auth, Domain Validation
    │
    ▼
[Route Handlers]    ──► Capability Enforcement (requireCapability / requireAdmin)
    │
    ▼
[Controllers]       ──► Payload Validation (Zod/Sanitization), Status Codes
    │
    ▼
[Services]          ──► Business Logic, State Transitions, Audit Logging
    │
    ▼
[Prisma ORM]        ──► PostgreSQL Engine (Supabase Transaction & Direct Poolers)
    │
    ▼
[PostgreSQL Database]
```

---

## Key Features & Business Rules

1. **Strict 2-Role Core + Dynamic Capability-Based Access Control (CBAC)**:
   - Base roles are strictly `EMPLOYEE` or `ADMIN`.
   - Granular permissions are decoupled from roles into 9 fixed `CapabilityCode` grants:
     - `VIEW_OTHER_RECORDS`: Read other users' time logs and leave.
     - `REVIEW_TIME`: Review, approve, or return timesheets within assigned scopes.
     - `DECIDE_TIME_OFF`: Approve or decline time off requests.
     - `MANAGE_CLIENTS_PROJECTS`: Create and manage clients and projects.
     - `ASSIGN_PROJECTS`: Assign team members to projects.
     - `MANAGE_USERS`: User account administration.
     - `VIEW_REPORTS`: Access aggregate timesheet and missing-entry reports.
     - `VIEW_ANALYTICS`: Access business intelligence charts and trends.
     - `VIEW_BILLING`: Access monetary rates and billing calculations.
   - Grants support **Scoping** (Global, Project-Specific, or User-Specific) and **Time-to-Live (TTL)** with automatic expiry and instant revocation.
2. **Immutable Audit Trails**:
   - Every permission grant, revocation, scope change, and expiry modification is recorded in `AccessAuditLog`.
   - Every timesheet status transition (`DRAFT` → `SUBMITTED` → `APPROVED` / `RETURNED`) is recorded in `TimeEntryHistory`.
   - Every edited submission saves an immutable revision record in `TimeEntryRevision`.
3. **Historical Billing Rates**:
   - Project rates (`ProjectRate`) use `Decimal(10, 2)` and support date ranges (`effectiveFrom` / `effectiveTo`).
   - When a timesheet is approved, the exact effective rate is snapshotted to `TimeEntry.approvedRateSnapshot`, guaranteeing historical reporting never drifts when project rates change.
4. **Time-Off & Collision Protection**:
   - Materialized `TimeOffDay` records prevent double-booking and automatically suppress false-positive missing-timesheet chase notifications.
5. **Durable Email Worker**:
   - Atomic database-backed queue using PostgreSQL `FOR UPDATE SKIP LOCKED`.
   - Guaranteed at-least-once delivery with exponential backoff and dead-letter (`FAILED`) state.

---

## Technology Stack

- **Runtime**: Node.js (v18+) with native ES Modules (`"type": "module"`)
- **Web Framework**: Express.js 4.x
- **Database & ORM**: PostgreSQL via Prisma ORM 5.x
- **Authentication**: Stateless JSON Web Tokens (`jsonwebtoken`) & `bcryptjs`
- **Email Delivery**: `nodemailer` with fallback to Supabase Edge Function over HTTPS
- **API Documentation**: OpenAPI 3.0 via `swagger-jsdoc` & `swagger-ui-express`
- **Benchmarking**: `autocannon`

---

## Project Structure

```
server/
├── prisma/
│   ├── schema.prisma          # PostgreSQL relational schema & indexes
│   └── seed.js                # Database seed script (demo users, clients, rates)
├── src/
│   ├── config/
│   │   ├── db.js              # Prisma Client instance with disconnect handlers
│   │   ├── env.js             # Validated environment configurations
│   │   └── swagger.js         # OpenAPI 3.0 specification definition
│   ├── controllers/           # HTTP controllers for all domain entities
│   ├── middleware/
│   │   ├── auth.js            # JWT verification & in-memory token cache
│   │   ├── errorHandler.js    # Global normalized error response handler
│   │   ├── permission.js      # CBAC capability enforcement middleware
│   │   └── rateLimit.js       # Sliding-window rate limiters (auth & public routes)
│   ├── routes/                # Express route declarations with OpenAPI tags
│   ├── services/
│   │   ├── accessService.js   # Capability grants, revocation, scope checks
│   │   ├── authService.js     # User registration, login, password resets
│   │   ├── clientProjectService.js # Clients, projects, rates, assignments
│   │   ├── emailService.js    # Mail formatting, template builders, fallbacks
│   │   ├── emailWorker.js     # PostgreSQL FOR UPDATE SKIP LOCKED job poller
│   │   ├── reportService.js   # Reporting aggregation & missing-entry chaser
│   │   ├── reviewService.js   # Timesheet review queue & approval workflows
│   │   ├── timeEntryService.js# Timesheet grid operations & revision tracking
│   │   ├── timeOffService.js  # Leave requests & collision avoidance
│   │   └── userService.js     # User CRUD & profile management
│   ├── app.js                 # Express application setup, routes, and middleware
│   └── index.js               # HTTP listener, IPv4 DNS configuration & worker supervisor
├── test/                      # Comprehensive test & verification suite
├── .env.example               # Environment variables template
├── package.json               # Scripts and dependencies
└── render.yaml                # Render cloud deployment blueprint
```

---

## Prerequisites

- **Node.js**: v18.0.0 or higher
- **PostgreSQL**: A local PostgreSQL 14+ instance or cloud database (e.g., [Supabase](https://supabase.com))
- **npm** or **pnpm** / **yarn**

---

## Environment Variables

Copy `.env.example` to `.env` in the `server` root directory:

```bash
cp .env.example .env
```

| Variable | Required | Default / Example | Purpose |
|---|---|---|---|
| `PORT` | Optional | `5000` | Port for the Express HTTP server |
| `NODE_ENV` | Optional | `development` | Environment mode (`development`, `production`, `test`) |
| `DATABASE_URL` | **Yes** | `postgresql://user:pass@host:6543/postgres?pgbouncer=true` | PostgreSQL connection string (Transaction mode pooler for Supabase) |
| `DIRECT_URL` | Optional | `postgresql://user:pass@host:5432/postgres` | Direct PostgreSQL connection for Prisma migrations (`db push`) |
| `JWT_SECRET` | **Yes** | `64-character-random-hex` | Secret key used to sign and verify session JWTs |
| `JWT_EXPIRES_IN` | Optional | `24h` | Session token lifespan (e.g. `24h`, `7d`) |
| `FRONTEND_URL` | **Yes** | `http://localhost:5173` | Allowed client origin and URL used in email notification links |
| `CORS_ORIGIN` | **Yes** | `http://localhost:5173` | CORS allowed origin header |
| `ALLOW_PUBLIC_REGISTRATION` | Optional | `true` | Allows anyone to register via `/register` (set `false` for invite-only) |
| `REGISTRATION_ALLOWED_DOMAINS` | Optional | `""` | Comma-separated domain whitelist (e.g. `company.com`). Empty allows all. |
| `SMTP_HOST` | Optional | `smtp.gmail.com` | SMTP host for outbound email delivery |
| `SMTP_PORT` | Optional | `587` | SMTP port (`587` for STARTTLS, `465` for SSL) |
| `SMTP_USER` | Optional | `your-email@gmail.com` | SMTP account username / email address |
| `SMTP_PASS` | Optional | `16-char-app-password` | SMTP account password / Google App Password |
| `EMAIL_FROM` | Optional | `Work Log <no-reply@domain.com>` | Sender display name and address |
| `SUPABASE_FUNCTION_URL` | Optional | `https://<ref>.supabase.co/functions/v1/send-email` | Supabase Edge Function URL to bypass Render outbound SMTP port blocking |

---

## Installation & Database Setup

1. **Install dependencies**:
   ```bash
   cd server
   npm install
   ```

2. **Generate Prisma Client**:
   ```bash
   npm run prisma:generate
   ```

3. **Push schema to database**:
   ```bash
   npx prisma db push
   ```

4. **Seed database with initial reference data and demo accounts**:
   ```bash
   npm run prisma:seed
   ```

---

## Running the Application

### Development Mode (with hot-reload)
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

### Prisma Studio (Interactive Database GUI)
```bash
npm run prisma:studio
```
Opens Prisma Studio on `http://localhost:5555` to view and inspect all database tables.

---

## Seeded Demo Accounts

All seeded demo accounts share the standard password: `Password123!`

| Email | Role | Granted Capabilities | Purpose |
|---|---|---|---|
| `admin@worklog.local` | `ADMIN` | All capabilities (Global) | System administrator with unrestricted access |
| `bob@worklog.local` | `EMPLOYEE` | `REVIEW_TIME` (Scoped to Acme Core Platform) | Project reviewer verifying scoped review flows |
| `carol@worklog.local` | `EMPLOYEE` | `VIEW_REPORTS`, `VIEW_BILLING` | Financial / reporting specialist |
| `dan@worklog.local` | `EMPLOYEE` | `DECIDE_TIME_OFF` | Team manager deciding leave requests |
| `eva@worklog.local` | `EMPLOYEE` | *None (Standard)* | Baseline employee submitting daily work logs |

---

## API Documentation & Swagger UI

Once the server is running, interactive OpenAPI 3.0 documentation is available at:

**`http://localhost:5000/api-docs`**

### Core Route Groups
- `/api/auth`: Login, registration, profile, password reset, session refresh
- `/api/timesheets`: Weekly grid entries, submissions, revision history, and copy-previous-week
- `/api/reviews`: Reviewer queue, bulk approval, and entry returns with comments
- `/api/time-off`: Leave requests, calendar conflict checks, and manager decisions
- `/api/clients` & `/api/projects`: Client/project management and historical billing rate periods
- `/api/access`: Capability grants, scoping, revocations, and expiry management
- `/api/reports`: Aggregated hours by client/project/user, missing-entry chasers, CSV export
- `/api/analytics`: Utilization trends, overtime analytics, and billable distribution
- `/api/audit-logs`: Immutable security audit logs
- `/api/email-logs`: Outbound dispatch audit log and retry monitor

---

## Durable Email Worker Architecture

The server incorporates a database-backed background queue worker ([emailWorker.js](file:///c:/Users/hamza/OneDrive/Desktop/Interview%20Toolshed/training-20260824/Work%20Log%20&%20Timesheet%20System/server/src/services/emailWorker.js)):

1. **Atomic Job Claiming**: Uses PostgreSQL `FOR UPDATE SKIP LOCKED` inside a Common Table Expression (CTE). Competing workers concurrently claiming jobs never deadlock and never claim the same record.
2. **Crash Resilience**: If a worker crashes while processing a job, the lock expires automatically after 2 minutes, allowing surviving workers to resume the job.
3. **Exponential Backoff**: Transient SMTP network drops retry with progressive backoff (`2^attempt` seconds).
4. **Dead-Letter (`FAILED`) State**: Permanent delivery failures halt after 3 attempts and transition to `FAILED` status with full diagnostic error messages.
5. **Deterministic Message-ID**: Outbound emails include an RFC 5322 header derived from `EmailLog.id` (`<${job.id}@worklog.system>`) to assist downstream email clients in client-side deduplication.

---

## Automated Verification & Test Suite

The test suite validates authentication, business rules, timesheet state machines, and concurrency protections against a real database instance:

```bash
# Run all automated tests
npm test

# Run individual verification suites
npm run test:auth
npm run test:timesheet
npm run test:timeoff
npm run test:security
```

Key dedicated verification scripts in `server/test/`:
- `verifyEmailJobDurability.js`: Tests atomic worker claiming, crash resumption, duplicate prevention, and retry progression.
- `verifyPaginationAndDateProtection.js`: Tests pagination envelopes, safe defaults (limit 50), and calendar range restrictions (max 45/90 days).
- `runFullProductionVerification.js`: Executes `EXPLAIN (ANALYZE, BUFFERS)` across all primary queries on a real 50k+ row dataset.

---

## Production Deployment (Render)

1. The repository includes a `render.yaml` blueprint configured for zero-downtime deployment.
2. Render Free Tier blocks outbound SMTP traffic on ports 25, 465, and 587. Configure `SUPABASE_FUNCTION_URL` to route outbound emails securely over HTTPS (Port 443) to the Supabase Edge Function.
3. Node IPv4 DNS resolution is enforced in [src/index.js](file:///c:/Users/hamza/OneDrive/Desktop/Interview%20Toolshed/training-20260824/Work%20Log%20&%20Timesheet%20System/server/src/index.js#L6) via `dns.setDefaultResultOrder('ipv4first')` to prevent `ENETUNREACH` errors on dual-stack cloud containers.
