import dotenv from 'dotenv';

dotenv.config();

export const PORT = process.env.PORT || 5000;
export const NODE_ENV = process.env.NODE_ENV || 'development';
export const DATABASE_URL = process.env.DATABASE_URL;
export const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-jwt-secret-key-12345';
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
export const FRONTEND_URL = process.env.FRONTEND_URL;
export const CORS_ORIGIN = process.env.CORS_ORIGIN || process.env.FRONTEND_URL || '*';
export const RESEND_API_KEY = process.env.RESEND_API_KEY;
export const EMAIL_FROM = process.env.EMAIL_FROM || 'Work Log <onboarding@resend.dev>';
export const SMTP_HOST = process.env.SMTP_HOST || (process.env.RESEND_API_KEY ? 'smtp.resend.com' : null);
export const SMTP_PORT = Number(process.env.SMTP_PORT) || 465;
export const SMTP_USER = process.env.SMTP_USER || (process.env.RESEND_API_KEY ? 'resend' : null);
export const SMTP_PASS = process.env.SMTP_PASS || process.env.RESEND_API_KEY || null;
export const SMTP_SECURE = process.env.SMTP_SECURE === 'true' || SMTP_PORT === 465;

export default {
  PORT,
  NODE_ENV,
  DATABASE_URL,
  JWT_SECRET,
  JWT_EXPIRES_IN,
  FRONTEND_URL,
  CORS_ORIGIN,
  RESEND_API_KEY,
  EMAIL_FROM,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_SECURE,
};
