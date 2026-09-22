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
  : CORS_ORIGIN.split(',').map((o) => o.trim());

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests (e.g., curl, health checks, postman)
    if (!origin) return callback(null, true);

    if (allowedOrigins === '*' || allowedOrigins.includes('*')) {
      return callback(null, true);
    }

    // Check if origin is explicitly allowed or a Netlify deployment preview
    const isAllowed =
      allowedOrigins.includes(origin) ||
      origin.includes('localhost') ||
      origin.includes('127.0.0.1') ||
      /\.netlify\.app$/.test(origin);

    if (isAllowed) {
      return callback(null, true);
    }

    return callback(new Error(`CORS origin blocked: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mount all routes (/health, /api-docs, /api/auth, etc.)
app.use('/', routes);

// 404 Catch-All Handler
app.use((req, res) => {
  return sendError(res, `Route not found: ${req.method} ${req.originalUrl}`, 404, 'NOT_FOUND');
});

// Centralized Error Handler
app.use(errorHandler);

export default app;
