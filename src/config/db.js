import { PrismaClient } from '@prisma/client';

// Helper to ensure database URL has appropriate connection and pool timeouts
function getResilientDatabaseUrl() {
  const originalUrl = process.env.DATABASE_URL || '';
  if (!originalUrl) return originalUrl;

  try {
    const urlObj = new URL(originalUrl);
    if (!urlObj.searchParams.has('connect_timeout')) {
      urlObj.searchParams.set('connect_timeout', '30');
    }
    const currentPoolTimeout = parseInt(urlObj.searchParams.get('pool_timeout') || '0', 10);
    if (!currentPoolTimeout || currentPoolTimeout < 45) {
      urlObj.searchParams.set('pool_timeout', '60');
    }
    return urlObj.toString();
  } catch {
    return originalUrl;
  }
}

const resilientUrl = getResilientDatabaseUrl();

// Supabase Transaction Mode (PgBouncer) — only log warnings/errors to avoid
// console overhead from query logs, which added measurable latency in development.
const basePrisma = new PrismaClient({
  log: ['warn', 'error'],
  datasources: resilientUrl ? { db: { url: resilientUrl } } : undefined,
  transactionOptions: {
    timeout: 30000,
    maxWait: 10000,
  },
});

function isTransientConnectionError(error) {
  if (!error) return false;
  return (
    error.name === 'PrismaClientInitializationError' ||
    error.code === 'P1001' || // Can't reach database server
    error.code === 'P1002' || // Database server reached but timed out
    error.code === 'P1008' || // Operations timed out
    error.code === 'P1017' || // Server closed the connection
    (typeof error.message === 'string' &&
      (error.message.includes("Can't reach database server") ||
       error.message.includes('timed out') ||
       error.message.includes('Connection terminated unexpectedly')))
  );
}

// Resilient query extension: auto-retry once on transient connection/initialization drops
const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        try {
          return await query(args);
        } catch (firstError) {
          if (isTransientConnectionError(firstError)) {
            console.warn(
              `[Prisma Resilience] Transient DB connection hiccup on ${model}.${operation}. Retrying in 1.5s...`
            );
            await new Promise((resolve) => setTimeout(resolve, 1500));
            return await query(args);
          }
          throw firstError;
        }
      },
    },
  },
});

export default prisma;

