import crypto from 'node:crypto';
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

// In-memory store for active OTP verification records
// Key: normalizedEmail -> Value: { code, expiresAt, attempts, lastSentAt }
const otpStore = new Map();
const resetOtpStore = new Map();

// Periodic cleanup of expired OTPs every 5 minutes
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [email, record] of otpStore.entries()) {
    if (now > record.expiresAt) {
      otpStore.delete(email);
    }
  }
  for (const [email, record] of resetOtpStore.entries()) {
    if (now > record.expiresAt) {
      resetOtpStore.delete(email);
    }
  }
}, 5 * 60 * 1000);

if (cleanupInterval.unref) {
  cleanupInterval.unref();
}

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
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 10000,
    });
  } else {
    // In dev or test without credentials, use jsonTransport
    transporter = nodemailer.createTransport({
      jsonTransport: true,
    });
  }
  return transporter;
}

export function buildOtpEmailHtml({ code, expiresInMinutes = 10 }) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; color: #1e293b;">
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="display: inline-block; padding: 12px; background: #eff6ff; border-radius: 16px; margin-bottom: 12px;">
          <span style="font-size: 24px;">⏱️</span>
        </div>
        <h2 style="margin: 0 0 6px 0; font-size: 22px; font-weight: 700; color: #0f172a;">Verify Your Email</h2>
        <p style="margin: 0; font-size: 14px; color: #64748b;">
          Please use the verification code below to verify your email address and complete your registration.
        </p>
      </div>

      <div style="background: #f8fafc; border: 1.5px dashed #cbd5e1; border-radius: 10px; padding: 22px; text-align: center; margin: 20px 0;">
        <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; display: block; margin-bottom: 8px;">
          One-Time Verification Code
        </span>
        <span style="font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #2563eb; display: inline-block;">
          ${code}
        </span>
      </div>

      <div style="margin-top: 20px; padding: 12px 16px; background: #fefce8; border-left: 4px solid #eab308; border-radius: 6px; font-size: 13px; color: #854d0e;">
        <strong>Expiration:</strong> This verification code expires in <strong>${expiresInMinutes} minutes</strong>. If you did not request this verification, please disregard this email.
      </div>

      <p style="margin-top: 28px; font-size: 12px; color: #94a3b8; text-align: center; border-top: 1px solid #f1f5f9; padding-top: 16px;">
        WorkLog Timesheet System &bull; Automated Security Notification
      </p>
    </div>
  `;
}

/**
 * Send an OTP verification code to the target email.
 * Expires in 10 minutes (600,000 ms).
 */
export async function sendOtp(email) {
  if (!email || !email.trim()) {
    const error = new Error('Email is required.');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalizedEmail)) {
    const error = new Error('A valid email address is required.');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  // Check if an account already exists with this email
  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true },
  });

  if (existingUser) {
    const error = new Error('An account with this email address already exists.');
    error.statusCode = 409;
    error.code = 'EMAIL_ALREADY_EXISTS';
    throw error;
  }

  // Cooldown check: 45 seconds minimum between requests for the same email
  const existingRecord = otpStore.get(normalizedEmail);
  const now = Date.now();
  if (existingRecord && now - existingRecord.lastSentAt < 45 * 1000) {
    const waitSeconds = Math.ceil((45 * 1000 - (now - existingRecord.lastSentAt)) / 1000);
    const error = new Error(`Please wait ${waitSeconds} seconds before requesting a new verification code.`);
    error.statusCode = 429;
    error.code = 'OTP_COOLDOWN';
    throw error;
  }

  // Generate a secure 6-digit numeric OTP
  const code = crypto.randomInt(100000, 999999).toString();
  const expiresInMinutes = 10;
  const expiresAt = now + expiresInMinutes * 60 * 1000;

  // Store in memory
  otpStore.set(normalizedEmail, {
    code,
    expiresAt,
    attempts: 0,
    lastSentAt: now,
  });

  // Dispatch email
  const subject = `Your WorkLog Verification Code: ${code}`;
  const html = buildOtpEmailHtml({ code, expiresInMinutes });

  try {
    const client = getTransporter();
    const mailPromise = client.sendMail({
      from: EMAIL_FROM,
      to: normalizedEmail,
      subject,
      html,
    });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('SMTP dispatch timed out after 10000ms')), 10000)
    );
    await Promise.race([mailPromise, timeoutPromise]);
  } catch (err) {
    console.error('Failed to send OTP email via SMTP:', err.message);
    transporter = null;
    // Don't fail the request in dev/test if SMTP has issues
    if (NODE_ENV === 'production') {
      const error = new Error('Failed to deliver verification code. Please try again later.');
      error.statusCode = 500;
      error.code = 'EMAIL_SEND_FAILED';
      throw error;
    }
  }

  // Always log in development/test so local testing is effortless
  if (NODE_ENV !== 'production') {
    console.log(`\n======================================================`);
    console.log(`[AUTH OTP] Email Verification Code for: ${normalizedEmail}`);
    console.log(`[AUTH OTP] Code: ${code} (Expires in ${expiresInMinutes} minutes)`);
    console.log(`======================================================\n`);
  }

  return {
    email: normalizedEmail,
    expiresInSeconds: expiresInMinutes * 60,
    expiresAt: new Date(expiresAt).toISOString(),
    devOtp: NODE_ENV !== 'production' ? code : undefined,
  };
}

/**
 * Verify an OTP without consuming it.
 */
export function verifyOtp(email, code) {
  if (!email || !code) {
    const error = new Error('Email and verification code are required.');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const cleanCode = code.toString().trim();

  const record = otpStore.get(normalizedEmail);
  if (!record) {
    const error = new Error('No verification code found for this email. Please request a new code.');
    error.statusCode = 400;
    error.code = 'OTP_NOT_FOUND';
    throw error;
  }

  if (Date.now() > record.expiresAt) {
    otpStore.delete(normalizedEmail);
    const error = new Error('Verification code has expired. Please request a new code.');
    error.statusCode = 400;
    error.code = 'OTP_EXPIRED';
    throw error;
  }

  if (record.attempts >= 5) {
    otpStore.delete(normalizedEmail);
    const error = new Error('Too many invalid attempts. This verification code has been invalidated. Please request a new one.');
    error.statusCode = 400;
    error.code = 'OTP_TOO_MANY_ATTEMPTS';
    throw error;
  }

  if (record.code !== cleanCode) {
    record.attempts += 1;
    const remainingAttempts = 5 - record.attempts;
    const error = new Error(
      remainingAttempts > 0
        ? `Invalid verification code. ${remainingAttempts} attempt(s) remaining.`
        : 'Invalid verification code. Code has been invalidated.'
    );
    error.statusCode = 400;
    error.code = 'INVALID_OTP';
    throw error;
  }

  return true;
}

/**
 * Consume an OTP once used for registration.
 */
export function consumeOtp(email, code) {
  verifyOtp(email, code);
  otpStore.delete(email.trim().toLowerCase());
  return true;
}

/**
 * Clear an OTP manually (e.g. for testing)
 */
export function clearOtp(email) {
  otpStore.delete(email.trim().toLowerCase());
}

/**
 * Build HTML template for password reset OTP email
 */
export function buildPasswordResetEmailHtml({ code, expiresInMinutes = 10 }) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; color: #1e293b;">
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="display: inline-block; padding: 12px; background: #eff6ff; border-radius: 16px; margin-bottom: 12px;">
          <span style="font-size: 24px;">🔑</span>
        </div>
        <h2 style="margin: 0 0 6px 0; font-size: 22px; font-weight: 700; color: #0f172a;">Reset Your Password</h2>
        <p style="margin: 0; font-size: 14px; color: #64748b;">
          We received a request to reset your password. Use the verification code below to set a new password.
        </p>
      </div>

      <div style="background: #f8fafc; border: 1.5px dashed #cbd5e1; border-radius: 10px; padding: 22px; text-align: center; margin: 20px 0;">
        <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; display: block; margin-bottom: 8px;">
          Password Reset Code
        </span>
        <span style="font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #2563eb; display: inline-block;">
          ${code}
        </span>
      </div>

      <div style="margin-top: 20px; padding: 12px 16px; background: #fefce8; border-left: 4px solid #eab308; border-radius: 6px; font-size: 13px; color: #854d0e;">
        <strong>Expiration:</strong> This verification code expires in <strong>${expiresInMinutes} minutes</strong>. If you did not request this password reset, please ignore this email.
      </div>

      <p style="margin-top: 28px; font-size: 12px; color: #94a3b8; text-align: center; border-top: 1px solid #f1f5f9; padding-top: 16px;">
        WorkLog Timesheet System &bull; Automated Security Notification
      </p>
    </div>
  `;
}

/**
 * Send an OTP verification code for password reset.
 * Target account must exist and be active.
 * Expires in 10 minutes.
 */
export async function sendPasswordResetOtp(email) {
  if (!email || !email.trim()) {
    const error = new Error('Email is required.');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalizedEmail)) {
    const error = new Error('A valid email address is required.');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  // Check if an account exists with this email
  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, isActive: true },
  });

  if (!existingUser) {
    const error = new Error('No account found with this email address.');
    error.statusCode = 404;
    error.code = 'USER_NOT_FOUND';
    throw error;
  }

  if (!existingUser.isActive) {
    const error = new Error('This account has been deactivated. Please contact an administrator.');
    error.statusCode = 403;
    error.code = 'ACCOUNT_DEACTIVATED';
    throw error;
  }

  // Cooldown check: 45 seconds minimum between requests for the same email
  const existingRecord = resetOtpStore.get(normalizedEmail);
  const now = Date.now();
  if (existingRecord && now - existingRecord.lastSentAt < 45 * 1000) {
    const waitSeconds = Math.ceil((45 * 1000 - (now - existingRecord.lastSentAt)) / 1000);
    const error = new Error(`Please wait ${waitSeconds} seconds before requesting a new verification code.`);
    error.statusCode = 429;
    error.code = 'OTP_COOLDOWN';
    throw error;
  }

  // Generate a secure 6-digit numeric OTP
  const code = crypto.randomInt(100000, 999999).toString();
  const expiresInMinutes = 10;
  const expiresAt = now + expiresInMinutes * 60 * 1000;

  // Store in memory
  resetOtpStore.set(normalizedEmail, {
    code,
    expiresAt,
    attempts: 0,
    lastSentAt: now,
  });

  // Dispatch email
  const subject = `Your WorkLog Password Reset Code: ${code}`;
  const html = buildPasswordResetEmailHtml({ code, expiresInMinutes });

  try {
    const client = getTransporter();
    const mailPromise = client.sendMail({
      from: EMAIL_FROM,
      to: normalizedEmail,
      subject,
      html,
    });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('SMTP dispatch timed out after 10000ms')), 10000)
    );
    await Promise.race([mailPromise, timeoutPromise]);
  } catch (err) {
    console.error('Failed to send password reset OTP email via SMTP:', err.message);
    transporter = null;
    if (NODE_ENV === 'production') {
      const error = new Error('Failed to deliver password reset code. Please try again later.');
      error.statusCode = 500;
      error.code = 'EMAIL_SEND_FAILED';
      throw error;
    }
  }

  // Always log in development/test so local testing is effortless
  if (NODE_ENV !== 'production') {
    console.log(`\n======================================================`);
    console.log(`[PASSWORD RESET OTP] Code for: ${normalizedEmail}`);
    console.log(`[PASSWORD RESET OTP] Code: ${code} (Expires in ${expiresInMinutes} minutes)`);
    console.log(`======================================================\n`);
  }

  return {
    email: normalizedEmail,
    expiresInSeconds: expiresInMinutes * 60,
    expiresAt: new Date(expiresAt).toISOString(),
    devOtp: NODE_ENV !== 'production' ? code : undefined,
  };
}

/**
 * Verify a password reset OTP without consuming it.
 */
export function verifyPasswordResetOtp(email, code) {
  if (!email || !code) {
    const error = new Error('Email and verification code are required.');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const cleanCode = code.toString().trim();

  const record = resetOtpStore.get(normalizedEmail);
  if (!record) {
    const error = new Error('No password reset code found for this email. Please request a new code.');
    error.statusCode = 400;
    error.code = 'OTP_NOT_FOUND';
    throw error;
  }

  if (Date.now() > record.expiresAt) {
    resetOtpStore.delete(normalizedEmail);
    const error = new Error('Password reset code has expired. Please request a new code.');
    error.statusCode = 400;
    error.code = 'OTP_EXPIRED';
    throw error;
  }

  if (record.attempts >= 5) {
    resetOtpStore.delete(normalizedEmail);
    const error = new Error('Too many invalid attempts. This reset code has been invalidated. Please request a new one.');
    error.statusCode = 400;
    error.code = 'OTP_TOO_MANY_ATTEMPTS';
    throw error;
  }

  if (record.code !== cleanCode) {
    record.attempts += 1;
    const remainingAttempts = 5 - record.attempts;
    const error = new Error(
      remainingAttempts > 0
        ? `Invalid verification code. ${remainingAttempts} attempt(s) remaining.`
        : 'Invalid verification code. Code has been invalidated.'
    );
    error.statusCode = 400;
    error.code = 'INVALID_OTP';
    throw error;
  }

  return true;
}

/**
 * Consume a password reset OTP once used.
 */
export function consumePasswordResetOtp(email, code) {
  verifyPasswordResetOtp(email, code);
  resetOtpStore.delete(email.trim().toLowerCase());
  return true;
}

/**
 * Clear a password reset OTP manually (e.g. for testing)
 */
export function clearPasswordResetOtp(email) {
  resetOtpStore.delete(email.trim().toLowerCase());
}

export default {
  sendOtp,
  verifyOtp,
  consumeOtp,
  clearOtp,
  sendPasswordResetOtp,
  verifyPasswordResetOtp,
  consumePasswordResetOtp,
  clearPasswordResetOtp,
  buildOtpEmailHtml,
  buildPasswordResetEmailHtml,
};
