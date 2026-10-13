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
    // Supabase PgBouncer transaction mode: 5 connections per client process
    // Supports PRISMA_CONNECTION_LIMIT env var for benchmark testing (defaults to 5)
    const configuredLimit = process.env.PRISMA_CONNECTION_LIMIT || '5';
    urlObj.searchParams.set('connection_limit', String(configuredLimit));
    return urlObj.toString();
  } catch {
    return originalUrl;
  }
}

export const queryMetrics = {
  totalQueries: 0,
  countQueries: 0,
  findManyQueries: 0,
  rawQueries: 0,
  otherQueries: 0,
  queryTimes: [],
  reset() {
    this.totalQueries = 0;
    this.countQueries = 0;
    this.findManyQueries = 0;
    this.rawQueries = 0;
    this.otherQueries = 0;
    this.queryTimes = [];
  },
};

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
       error.message.includes('Server has closed the connection') ||
       error.message.includes('ConnectionReset') ||
       error.message.includes('forcibly closed') ||
       error.message.includes('timed out') ||
       error.message.includes('Connection terminated unexpectedly')))
  );
}

async function withResilience(fn, label) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt <= 3 && isTransientConnectionError(err)) {
        const delayMs = attempt * 1200;
        console.warn(
          `[Prisma Resilience] Transient DB connection hiccup on ${label} (attempt ${attempt}/3). Retrying in ${delayMs}ms...`
        );
        try {
          await basePrisma.$connect();
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw err;
    }
  }
}

const IDEMPOTENT_READ_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

// Resilient query extension: auto-retry with progressive backoff on transient connection drops
// STRICT SAFETY RULE: Only idempotent read operations are auto-retried.
// Mutating operations (create, update, delete, upsert) must NEVER be blindly retried
// upon lost connection, as the remote DB may have committed the mutation before socket reset.
const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        queryMetrics.totalQueries++;
        if (operation === 'count') queryMetrics.countQueries++;
        else if (operation === 'findMany') queryMetrics.findManyQueries++;
        else queryMetrics.otherQueries++;

        const start = performance.now();
        try {
          if (IDEMPOTENT_READ_OPERATIONS.has(operation)) {
            return await withResilience(() => query(args), `${model}.${operation}`);
          }
          // Non-idempotent mutations execute directly without auto-retry
          return await query(args);
        } finally {
          const duration = performance.now() - start;
          queryMetrics.queryTimes.push({ op: `${model}.${operation}`, duration });
        }
      },
    },
  },
  client: {
    async $queryRaw(...args) {
      queryMetrics.totalQueries++;
      queryMetrics.rawQueries++;
      const start = performance.now();
      try {
        return await withResilience(() => basePrisma.$queryRaw(...args), '$queryRaw');
      } finally {
        queryMetrics.queryTimes.push({ op: '$queryRaw', duration: performance.now() - start });
      }
    },
    async $queryRawUnsafe(...args) {
      queryMetrics.totalQueries++;
      queryMetrics.rawQueries++;
      const start = performance.now();
      try {
        return await withResilience(() => basePrisma.$queryRawUnsafe(...args), '$queryRawUnsafe');
      } finally {
        queryMetrics.queryTimes.push({ op: '$queryRawUnsafe', duration: performance.now() - start });
      }
    },
    async $executeRaw(...args) {
      queryMetrics.totalQueries++;
      queryMetrics.rawQueries++;
      // Mutations execute directly; do not retry raw writes
      return await basePrisma.$executeRaw(...args);
    },
    async $executeRawUnsafe(...args) {
      queryMetrics.totalQueries++;
      queryMetrics.rawQueries++;
      // Mutations execute directly; do not retry raw writes
      return await basePrisma.$executeRawUnsafe(...args);
    },
  },
});

export default prisma;

