import express from 'express';
import cors from 'cors';
import routes from './routes/index.js';
import errorHandler from './middleware/errorHandler.js';
import { sendError } from './utils/response.js';
import { CORS_ORIGIN, NODE_ENV } from './config/env.js';

const app = express();

// Security: Disable Express fingerprinting
app.disable('x-powered-by');

// Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Configure CORS for Netlify, Localhost, and specified frontend URLs
const allowedOrigins = CORS_ORIGIN === '*'
  ? '*'
  : CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests (e.g., curl, health checks, postman)
    if (!origin) return callback(null, true);

    if (allowedOrigins === '*' || allowedOrigins.includes('*')) {
      return callback(null, true);
    }

    const isAllowed = allowedOrigins.includes(origin) ||
      (NODE_ENV !== 'production' && (origin.includes('localhost') || origin.includes('127.0.0.1')));

    if (isAllowed) {
      return callback(null, true);
    }

    return callback(new Error(`CORS origin blocked: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'X-CSRF-Token'],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Formal synchronizer-token / double-submit CSRF protection:
// Cookie-authenticated state changes (POST, PUT, PATCH, DELETE) must include a valid matching X-CSRF-Token header.
app.use((req, res, next) => {
  const cookieHeader = req.headers.cookie || '';
  const hasSessionCookie = /(?:^|;\s*)worklog_session=/.test(cookieHeader);
  const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);

  if (hasSessionCookie && isMutation) {
    const csrfCookieMatch = cookieHeader.match(/(?:^|;\s*)worklog_csrf_token=([^;]+)/);
    const csrfCookie = csrfCookieMatch ? decodeURIComponent(csrfCookieMatch[1]) : null;
    const csrfHeader = req.headers['x-csrf-token'];

    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      return sendError(res, 'CSRF protection rejected this request. Missing or invalid CSRF token.', 403, 'CSRF_REJECTED');
    }
  }
  return next();
});

// Mount all routes (/health, /api-docs, /api/auth, etc.)
app.use('/', routes);

// 404 Catch-All Handler
app.use((req, res) => {
  return sendError(res, `Route not found: ${req.method} ${req.originalUrl}`, 404, 'NOT_FOUND');
});

// Centralized Error Handler
app.use(errorHandler);

export default app;
