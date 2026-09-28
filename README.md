# Work Log & Timesheet System — API

Backend REST API for the Work Log & Timesheet System.

## Technology Stack
* Node.js & Express
* Prisma ORM
* PostgreSQL (Supabase)

## Email setup

Email delivery uses Nodemailer via SMTP (Gmail with Google App Password) so application actions deliver reliably to any registered employee or admin email. Set these server-only environment variables in local development and Render:

- `SMTP_HOST`: SMTP host (e.g. `smtp.gmail.com`)
- `SMTP_PORT`: Port (e.g. `465`)
- `SMTP_USER`: Sender email (e.g. `engr.hamzaiqbal.pk@gmail.com`)
- `SMTP_PASS` / `APP_PASSWORD`: Google App Password (16-character generated app password)
- `EMAIL_FROM`: verified sender name and address, for example `Work Log & Timesheet System <engr.hamzaiqbal.pk@gmail.com>`
- `FRONTEND_URL`: deployed client URL used in email links

Email sends are fire-and-forget and handled asynchronously. Every attempt is recorded in `EmailLog`; provider failures are marked `FAILED` and do not fail the original user action. Never put SMTP credentials in `client/.env` or expose them through `VITE_` variables.
