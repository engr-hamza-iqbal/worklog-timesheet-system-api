# Deployment Guide: Render (Backend) & Netlify (Frontend) with GitHub Actions CI/CD

This guide walks you step-by-step through deploying the **Work Log & Timesheet System** using **Supabase** (PostgreSQL Database), **Render** (Node.js API), **Netlify** (React Frontend), and **GitHub Actions** (CI/CD pipeline).

---

## Architecture Overview

```
                        ┌─────────────────────────────────┐
                        │   Supabase (PostgreSQL 15)      │
                        │  - 16 Tables, 11 Enums, Indexes │
                        └──────────────▲──────────────────┘
                                       │ DATABASE_URL
                                       │
┌───────────────────────────┐    REST API / JWT     ┌───────────────────────────┐
│ Netlify (Frontend SPA)    ├──────────────────────►│ Render (Backend Web Svc)  │
│ - React 19 + Vite         │   VITE_API_URL        │ - Node.js + Express + ESM │
│ - React Router + Tailwind │                       │ - Prisma ORM + Swagger UI │
└─────────────▲─────────────┘                       └─────────────▲─────────────┘
              │                                                   │
     Git push to main                                    Git push to main
              │                                                   │
┌─────────────┴─────────────┐                       ┌─────────────┴─────────────┐
│ GitHub Actions CI (UI)    │                       │ GitHub Actions CI (API)   │
│ - Validates vite build    │                       │ - Runs Postgres service   │
│ - Runs on main push / PR  │                       │ - Tests DB & Auth flows   │
└───────────────────────────┘                       └───────────────────────────┘
```

---

## Part 1: Connect Database (Supabase)

1. Open your **[Supabase Dashboard](https://supabase.com/dashboard)** and select your project.
2. Go to **Project Settings** (gear icon) → **Database**.
3. Under **Connection string**, select the **URI** tab.
4. Copy the connection string:
   * **Connection Pooling (Port 6543)** *(recommended for cloud deployments)*:
     ```
     postgresql://postgres.[YOUR-PROJECT-REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true
     ```
   * **Direct Connection (Port 5432)**:
     ```
     postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres
     ```
   *(Note: If your password contains special characters like `@`, `!`, `#`, URL-encode them, e.g. `@` → `%40`)*.
5. In your local terminal, navigate to `server/`:
   ```powershell
   cd "c:\Users\hamza\OneDrive\Desktop\Interview Toolshed\training-20260824\Work Log & Timesheet System\server"
   ```
6. Set `DATABASE_URL` in `server/.env` to your Supabase URL, then push schema and seed:
   ```powershell
   npm run prisma db push
   npm run prisma:seed
   ```
7. Verify your tables in Supabase Dashboard → **Table Editor**.

---

## Part 2: Deploy Backend to Render

1. Go to **[Render.com](https://render.com)** and log in with your GitHub account.
2. On your Dashboard, click **New +** → **Web Service**.
3. Connect your backend repository:
   * **Repository**: `engr-hamza-iqbal/worklog-timesheet-system-api`
4. Configure the service settings:
   * **Name**: `worklog-timesheet-api` (or your preferred name)
   * **Region**: Select the region closest to your Supabase database (e.g. Oregon, Frankfurt)
   * **Branch**: `main`
   * **Root Directory**: Leave blank (root of repo)
   * **Runtime**: `Node`
   * **Build Command**: `npm install && npm run prisma:generate`
   * **Start Command**: `npm start`
   * **Instance Type**: `Free`
5. Configure **Environment Variables** (click **Add Environment Variable**):
   * `DATABASE_URL`: *Your Supabase connection string*
   * `PORT`: `5000`
   * `NODE_ENV`: `production`
   * `JWT_SECRET`: *A secure random string (e.g. `d3a7e589...`)*
   * `JWT_EXPIRES_IN`: `24h`
6. Click **Create Web Service**.
7. Render will build and launch your backend service. Once active, note your URL:
   * Example: `https://worklog-timesheet-api.onrender.com`
8. Verify it by visiting in your browser:
   * Health check: `https://worklog-timesheet-api.onrender.com/health` (should return `{"status": "healthy", "database": "connected"}`)
   * Swagger Documentation: `https://worklog-timesheet-api.onrender.com/api-docs`

---

## Part 3: Deploy Frontend to Netlify

1. Go to **[Netlify.com](https://app.netlify.com)** and log in with GitHub.
2. Click **Add new site** → **Import an existing project** → **Deploy with GitHub**.
3. Select your frontend repository:
   * **Repository**: `engr-hamza-iqbal/worklog-timesheet-system-ui`
4. Configure the build settings:
   * **Branch to deploy**: `main`
   * **Base directory**: Leave blank (root of repo)
   * **Build command**: `npm run build`
   * **Publish directory**: `dist`
5. Configure **Environment Variables**:
   * Click **Add a variable**
   * **Key**: `VITE_API_URL`
   * **Value**: Your Render backend URL (e.g. `https://worklog-timesheet-api.onrender.com`) without a trailing slash.
6. Click **Deploy worklog-timesheet-system-ui**.
7. Netlify will run the Vite build and deploy the application.
8. *(Note: `netlify.toml` is already included in the repository, configuring automatic SPA redirects `/* -> /index.html 200` so direct links to `/login` and `/dashboard` refresh cleanly without 404s).*

---

## Part 4: CI/CD Workflow with GitHub Actions

Both repositories are configured with GitHub Actions to validate code before deployments:

### Backend Workflow (`.github/workflows/ci.yml`)
* Triggers **only** on push or pull request to the `main` branch.
* Spawns a PostgreSQL container.
* Generates Prisma client, applies schema, seeds demo data, and runs automated tests (`test:auth`).

### Frontend Workflow (`.github/workflows/ci.yml`)
* Triggers **only** on push or pull request to the `main` branch.
* Installs dependencies via `npm ci` and runs `npm run build` to ensure production assets compile with zero errors.

### Continuous Deployment Flow
1. You work on your feature branch (`feature/auth-and-access-control` or `feature/auth-ui`).
2. When ready, open a **Pull Request into `main`**.
3. GitHub Actions triggers automatically and validates the build and tests.
4. Once the PR is merged into `main`:
   * GitHub Actions runs on `main` to verify the merge.
   * **Render** detects the push to `main` and deploys the backend API update.
   * **Netlify** detects the push to `main` and deploys the updated frontend UI.
