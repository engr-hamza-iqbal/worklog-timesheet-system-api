import prisma from '../config/db.js';
import { EMAIL_FROM, FRONTEND_URL, RESEND_API_KEY } from '../config/env.js';

function referenceDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'\"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character]);
}

export function queueEmail({ recipientUserId = null, recipientEmail, emailType, subject, html, relatedEntityType = null, relatedEntityId = null, referenceDate: reference = null }) {
  if (!recipientEmail) return;

  void (async () => {
    let log;
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

      if (!RESEND_API_KEY || !EMAIL_FROM) {
        throw new Error('Email provider is not configured. Set RESEND_API_KEY and EMAIL_FROM.');
      }

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: EMAIL_FROM, to: [recipientEmail], subject, html }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Resend returned ${response.status}: ${detail.slice(0, 500)}`);
      }

      await prisma.emailLog.update({ where: { id: log.id }, data: { status: 'SENT', sentAt: new Date() } });
    } catch (error) {
      if (log) {
        await prisma.emailLog.update({ where: { id: log.id }, data: { status: 'FAILED', errorMessage: error.message } }).catch(() => {});
      } else {
        console.error('Email logging failed:', error.message);
      }
    }
  })();
}

export function emailLink(path) {
  return `${(FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')}${path}`;
}
