import dotenv from 'dotenv';

dotenv.config();

export const PORT = process.env.PORT || 5000;
export const NODE_ENV = process.env.NODE_ENV || 'development';
export const DATABASE_URL = process.env.DATABASE_URL;
export const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-jwt-secret-key-12345';
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
export const FRONTEND_URL = process.env.FRONTEND_URL;
export const CORS_ORIGIN = process.env.CORS_ORIGIN || process.env.FRONTEND_URL || '*';
export const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
export const SMTP_PORT = Number(process.env.SMTP_PORT) || 465;
export const SMTP_USER = process.env.SMTP_USER || process.env.EMAIL_USER || 'engr.hamzaiqbal.pk@gmail.com';
export const SMTP_PASS = (process.env.SMTP_PASS || process.env.APP_PASSWORD || '').replace(/\s+/g, '') || null;
export const SMTP_SECURE = process.env.SMTP_SECURE === 'false' ? false : SMTP_PORT === 465 || true;
export const EMAIL_FROM = process.env.EMAIL_FROM || `Work Log <${SMTP_USER}>`;

export default {
  PORT,
  NODE_ENV,
  DATABASE_URL,
  JWT_SECRET,
  JWT_EXPIRES_IN,
  FRONTEND_URL,
  CORS_ORIGIN,
  EMAIL_FROM,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_SECURE,
};
