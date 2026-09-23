# Work Log & Timesheet System — API

Backend REST API for the Work Log & Timesheet System.

## Technology Stack
* Node.js & Express
* Prisma ORM
* PostgreSQL (Supabase)

## Email setup

Email delivery uses the Resend HTTP API so application actions do not wait on SMTP connections. Set these server-only environment variables in local development and Render:

- `RESEND_API_KEY`: Resend API key (`re_...`)
- `EMAIL_FROM`: verified sender, for example `Work Log <notifications@example.com>`
- `FRONTEND_URL`: deployed client URL used in email links

Email sends are fire-and-forget. Every attempt is recorded in `EmailLog`; provider failures are marked `FAILED` and do not fail the original approval or return action. Never put `RESEND_API_KEY` in `client/.env` or expose it through a `VITE_` variable.
