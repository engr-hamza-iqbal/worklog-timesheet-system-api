import nodemailer from 'nodemailer';
import prisma from '../config/db.js';
import {
  EMAIL_FROM,
  FRONTEND_URL,
  NODE_ENV,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_SECURE,
} from '../config/env.js';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  if (SMTP_USER && SMTP_PASS) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST || 'smtp.gmail.com',
      port: SMTP_PORT || 465,
      secure: SMTP_SECURE,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });
  } else if (NODE_ENV === 'test') {
    transporter = nodemailer.createTransport({
      jsonTransport: true,
    });
  } else {
    // In dev without credentials, use jsonTransport so actions never fail and attempts are safely recorded
    transporter = nodemailer.createTransport({
      jsonTransport: true,
    });
  }
  return transporter;
}

export function referenceDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character]);
}

export function emailLink(path) {
  return `${(FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')}${path}`;
}

export async function canSendMissingTimesheetChase(userId, dateStr) {
  const targetDate = referenceDate(dateStr);
  if (!targetDate) return true;

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const existing = await prisma.emailLog.findFirst({
    where: {
      recipientUserId: userId,
      emailType: 'MISSING_TIMESHEET',
      referenceDate: targetDate,
      attemptedAt: { gte: startOfDay },
      status: { in: ['SENT', 'PENDING'] },
    },
  });

  return !existing;
}

/**
 * Standard email template builders
 */
export function buildMissingTimesheetEmail({ recipientName, missingDates }) {
  const datesList = Array.isArray(missingDates) ? missingDates : [missingDates];
  const formattedDates = datesList.map((d) => `<li>${escapeHtml(d)}</li>`).join('');
  return {
    subject: `Timesheet Reminder: Missing entries for ${datesList.join(', ')}`,
    html: `
      <div style="font-family: sans-serif; line-height: 1.5; color: #1e293b;">
        <h2 style="color: #0f172a;">Timesheet Reminder</h2>
        <p>Hi ${escapeHtml(recipientName || 'there')},</p>
        <p>Our records show that you have not recorded timesheet entries for the following working date(s):</p>
        <ul>${formattedDates}</ul>
        <p>Please record your hours or submit any pending time-off request promptly.</p>
        <p style="margin-top: 24px;">
          <a href="${emailLink('/timesheet')}" style="background-color: #0f172a; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: 500;">
            Open Timesheet
          </a>
        </p>
      </div>
    `,
  };
}

export function buildEntryReturnedEmail({ recipientName, projectName, workDate, hours, comment }) {
  return {
    subject: `Time Entry Returned: ${projectName} (${workDate})`,
    html: `
      <div style="font-family: sans-serif; line-height: 1.5; color: #1e293b;">
        <h2 style="color: #b91c1c;">Time Entry Returned for Correction</h2>
        <p>Hi ${escapeHtml(recipientName || 'there')},</p>
        <p>Your submitted entry of <strong>${hours} hours</strong> for project <strong>${escapeHtml(projectName)}</strong> on <strong>${workDate}</strong> has been returned for review.</p>
        <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 12px; margin: 16px 0; border-radius: 4px;">
          <strong style="color: #991b1b;">Reviewer Comment:</strong>
          <p style="margin: 4px 0 0 0; color: #7f1d1d;">${escapeHtml(comment)}</p>
        </div>
        <p>Please make the required adjustments and submit again.</p>
        <p style="margin-top: 24px;">
          <a href="${emailLink('/timesheet')}" style="background-color: #0f172a; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: 500;">
            Review and Correct Entry
          </a>
        </p>
      </div>
    `,
  };
}

export function buildTimeOffDecidedEmail({ recipientName, timeOffTypeName, startDate, endDate, decision, comment }) {
  const isApproved = decision === 'APPROVED';
  return {
    subject: `Time Off Request ${decision}: ${timeOffTypeName} (${startDate} to ${endDate})`,
    html: `
      <div style="font-family: sans-serif; line-height: 1.5; color: #1e293b;">
        <h2 style="color: ${isApproved ? '#15803d' : '#b91c1c'};">Time Off Request ${isApproved ? 'Approved' : 'Declined'}</h2>
        <p>Hi ${escapeHtml(recipientName || 'there')},</p>
        <p>Your request for <strong>${escapeHtml(timeOffTypeName)}</strong> from <strong>${startDate}</strong> to <strong>${endDate}</strong> was <strong>${decision.toLowerCase()}</strong>.</p>
        ${comment ? `
        <div style="background-color: #f8fafc; border-left: 4px solid #94a3b8; padding: 12px; margin: 16px 0; border-radius: 4px;">
          <strong>Decision Comment:</strong>
          <p style="margin: 4px 0 0 0;">${escapeHtml(comment)}</p>
        </div>` : ''}
        <p style="margin-top: 24px;">
          <a href="${emailLink('/time-off')}" style="background-color: #0f172a; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: 500;">
            View Time Off Requests
          </a>
        </p>
      </div>
    `,
  };
}

export function buildTimeOffReviewRequiredEmail({ recipientName, employeeName, timeOffTypeName, startDate, endDate, reason }) {
  return {
    subject: `Action Required: Time Off Request from ${employeeName}`,
    html: `
      <div style="font-family: sans-serif; line-height: 1.5; color: #1e293b;">
        <h2 style="color: #0f172a;">Time Off Request Pending Decision</h2>
        <p>Hi ${escapeHtml(recipientName || 'there')},</p>
        <p><strong>${escapeHtml(employeeName)}</strong> has submitted a time-off request requiring your decision:</p>
        <ul>
          <li><strong>Type:</strong> ${escapeHtml(timeOffTypeName)}</li>
          <li><strong>Dates:</strong> ${startDate} to ${endDate}</li>
          <li><strong>Reason:</strong> ${escapeHtml(reason || 'None provided')}</li>
        </ul>
        <p style="margin-top: 24px;">
          <a href="${emailLink('/time-off')}" style="background-color: #0f172a; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: 500;">
            Decide Request
          </a>
        </p>
      </div>
    `,
  };
}

/**
 * Queue and dispatch an email asynchronously using Nodemailer.
 * Never delays the HTTP response and never throws an unhandled rejection.
 */
export function queueEmail({
  recipientUserId = null,
  recipientEmail,
  emailType,
  subject,
  html,
  relatedEntityType = null,
  relatedEntityId = null,
  referenceDate: reference = null,
}) {
  if (!recipientEmail) return;

  void (async () => {
    let log = null;
    try {
      log = await prisma.emailLog.create({
        data: {
          recipientUserId,
          recipientEmail,
          emailType,
          subject,
          relatedEntityType,
          relatedEntityId,
          referenceDate: referenceDate(reference),
          status: 'PENDING',
        },
      });

      const mailClient = getTransporter();

      await mailClient.sendMail({
        from: EMAIL_FROM,
        to: recipientEmail,
        subject,
        html,
      });

      await prisma.emailLog.update({
        where: { id: log.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          errorMessage: null,
        },
      });
    } catch (error) {
      if (log) {
        await prisma.emailLog
          .update({
            where: { id: log.id },
            data: { status: 'FAILED', errorMessage: error.message },
          })
          .catch(() => {});
      } else {
        console.error('Email logging failed:', error.message);
      }
    }
  })();
}

/**
 * Send a sample/test email for any of the 4 supported email types.
 */
export async function sendTestEmail({
  recipientUserId = null,
  recipientEmail,
  emailType = 'MISSING_TIMESHEET',
}) {
  const targetEmail = recipientEmail || SMTP_USER || 'engr.hamzaiqbal.pk@gmail.com';
  let emailContent;
  let type = emailType;

  switch (emailType) {
    case 'ENTRY_RETURNED':
      emailContent = buildEntryReturnedEmail({
        recipientName: 'Team Member',
        projectName: 'Client Onboarding & Timesheet',
        workDate: new Date().toISOString().slice(0, 10),
        hours: 4.5,
        comment: 'Please provide more details on technical implementation steps before re-submitting.',
      });
      break;
    case 'TIME_OFF_DECIDED':
      emailContent = buildTimeOffDecidedEmail({
        recipientName: 'Team Member',
        timeOffTypeName: 'Annual Leave',
        startDate: new Date().toISOString().slice(0, 10),
        endDate: new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10),
        decision: 'APPROVED',
        comment: 'Approved. Enjoy your time off!',
      });
      break;
    case 'TIME_OFF_REVIEW_REQUIRED':
      emailContent = buildTimeOffReviewRequiredEmail({
        recipientName: 'Manager / Reviewer',
        employeeName: 'Hamza Iqbal',
        timeOffTypeName: 'Sick Leave',
        startDate: new Date().toISOString().slice(0, 10),
        endDate: new Date().toISOString().slice(0, 10),
        reason: 'Medical consultation & recovery',
      });
      break;
    case 'MISSING_TIMESHEET':
    default:
      type = 'MISSING_TIMESHEET';
      emailContent = buildMissingTimesheetEmail({
        recipientName: 'Team Member',
        missingDates: [new Date().toISOString().slice(0, 10)],
      });
      break;
  }

  queueEmail({
    recipientUserId,
    recipientEmail: targetEmail,
    emailType: type,
    subject: `[Test] ${emailContent.subject}`,
    html: emailContent.html,
    referenceDate: new Date().toISOString().slice(0, 10),
  });

  return {
    success: true,
    message: `Test email (${type}) successfully queued for delivery to ${targetEmail}.`,
    recipient: targetEmail,
    emailType: type,
  };
}

export default {
  queueEmail,
  sendTestEmail,
  canSendMissingTimesheetChase,
  buildMissingTimesheetEmail,
  buildEntryReturnedEmail,
  buildTimeOffDecidedEmail,
  buildTimeOffReviewRequiredEmail,
  referenceDate,
  escapeHtml,
  emailLink,
};
