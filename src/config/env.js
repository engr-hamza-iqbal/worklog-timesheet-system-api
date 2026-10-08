import dotenv from 'dotenv';

dotenv.config();

export const PORT = process.env.PORT || 5000;
export const NODE_ENV = process.env.NODE_ENV || 'development';
export const DATABASE_URL = process.env.DATABASE_URL;
const configuredJwtSecret = process.env.JWT_SECRET;
if (NODE_ENV === 'production' && !configuredJwtSecret) {
  throw new Error('JWT_SECRET must be configured in production.');
}
export const JWT_SECRET = configuredJwtSecret || 'local-development-only-jwt-secret';
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
export const ALLOW_PUBLIC_REGISTRATION = process.env.ALLOW_PUBLIC_REGISTRATION === 'true' || NODE_ENV !== 'production';
export const REGISTRATION_ALLOWED_DOMAINS = (process.env.REGISTRATION_ALLOWED_DOMAINS || '')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);
export const DISTRIBUTED_RATE_LIMIT = process.env.DISTRIBUTED_RATE_LIMIT === 'true' || (NODE_ENV === 'production' && process.env.DISTRIBUTED_RATE_LIMIT !== 'false');
export const REDIS_URL = process.env.REDIS_URL || null;
export const FRONTEND_URL = process.env.FRONTEND_URL;
export const CORS_ORIGIN = process.env.CORS_ORIGIN || process.env.FRONTEND_URL || (NODE_ENV === 'production' ? '' : '*');
if (NODE_ENV === 'production' && (!FRONTEND_URL || !CORS_ORIGIN || CORS_ORIGIN === '*' || /localhost|127\.0\.0\.1/.test(CORS_ORIGIN))) {
  throw new Error('FRONTEND_URL and a production CORS_ORIGIN must be configured without localhost or wildcard origins.');
}
export const RESEND_API_KEY = process.env.RESEND_API_KEY || null;
export const BREVO_API_KEY = process.env.BREVO_API_KEY || null;
export const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
export const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
export const SMTP_USER = process.env.SMTP_USER || process.env.EMAIL_USER || null;
export const SMTP_PASS = (process.env.SMTP_PASS || process.env.APP_PASSWORD || '').replace(/\s+/g, '') || null;
if (NODE_ENV === 'production' && !RESEND_API_KEY && !BREVO_API_KEY && (!SMTP_USER || !SMTP_PASS)) {
  throw new Error('Either RESEND_API_KEY, BREVO_API_KEY, or SMTP_USER and SMTP_PASS must be configured in production.');
}
export const SMTP_SECURE = process.env.SMTP_SECURE === undefined
  ? SMTP_PORT === 465
  : process.env.SMTP_SECURE === 'true';
export const EMAIL_FROM = process.env.EMAIL_FROM || (SMTP_USER ? `Work Log <${SMTP_USER}>` : 'Work Log <onboarding@resend.dev>');

export default {
  PORT,
  NODE_ENV,
  DATABASE_URL,
  JWT_SECRET,
  JWT_EXPIRES_IN,
  ALLOW_PUBLIC_REGISTRATION,
  REGISTRATION_ALLOWED_DOMAINS,
  DISTRIBUTED_RATE_LIMIT,
  REDIS_URL,
  FRONTEND_URL,
  CORS_ORIGIN,
  EMAIL_FROM,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_SECURE,
};
