import prisma from '../config/db.js';
import { DISTRIBUTED_RATE_LIMIT } from '../config/env.js';

const buckets = new Map();

export function resetRateLimitBuckets() {
  buckets.clear();
}

function memoryCleanup(now) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function memoryIncrement(key, windowMs) {
  const now = Date.now();
  memoryCleanup(now);
  const bucket = buckets.get(key) || { count: 0, resetAt: now + windowMs };
  bucket.count += 1;
  buckets.set(key, bucket);
  return bucket;
}

let dbTableChecked = false;
let lastDbPurge = Date.now();

async function purgeExpiredDbBuckets() {
  const now = Date.now();
  if (now - lastDbPurge < 600000) return;
  lastDbPurge = now;
  try {
    await prisma.$executeRawUnsafe(`DELETE FROM "_RateLimitBucket" WHERE "resetAt" < NOW() - INTERVAL '1 hour'`);
  } catch {}
}

async function ensureRateLimitTable() {
  if (dbTableChecked) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "_RateLimitBucket" (
        "key" VARCHAR(255) PRIMARY KEY,
        "count" INTEGER NOT NULL DEFAULT 1,
        "resetAt" TIMESTAMPTZ NOT NULL,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    try {
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_rate_limit_reset_at" ON "_RateLimitBucket" ("resetAt")`);
    } catch {}
    dbTableChecked = true;
  } catch (err) {
    // If migration/DDL fails, fallback to memory
    console.warn('[RateLimit] Database bucket table check warning:', err.message);
  }
}

export async function databaseIncrement(key, windowMs) {
  await ensureRateLimitTable();
  purgeExpiredDbBuckets().catch(() => {});
  const resetAtDate = new Date(Date.now() + windowMs);
  const rows = await prisma.$queryRawUnsafe(`
    INSERT INTO "_RateLimitBucket" ("key", "count", "resetAt", "updatedAt")
    VALUES ($1, 1, $2, NOW())
    ON CONFLICT ("key") DO UPDATE
    SET
      "count" = CASE 
        WHEN "_RateLimitBucket"."resetAt" <= NOW() THEN 1 
        ELSE "_RateLimitBucket"."count" + 1 
      END,
      "resetAt" = CASE 
        WHEN "_RateLimitBucket"."resetAt" <= NOW() THEN $2 
        ELSE "_RateLimitBucket"."resetAt" 
      END,
      "updatedAt" = NOW()
    RETURNING "count", "resetAt";
  `, key, resetAtDate);

  if (rows && rows[0]) {
    return {
      count: Number(rows[0].count),
      resetAt: new Date(rows[0].resetAt).getTime(),
    };
  }
  return null;
}

export function createRateLimiter({ key, windowMs, max, store = DISTRIBUTED_RATE_LIMIT ? 'postgres' : 'memory' }) {
  return async (req, res, next) => {
    const identity = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const bucketKey = `${key}:${identity}`;
    let bucket = null;

    if (store === 'postgres' || DISTRIBUTED_RATE_LIMIT) {
      try {
        bucket = await databaseIncrement(bucketKey, windowMs);
      } catch (err) {
        // Fallback to memory on transient DB issue
        bucket = memoryIncrement(bucketKey, windowMs);
      }
    } else {
      bucket = memoryIncrement(bucketKey, windowMs);
    }

    if (!bucket) {
      bucket = memoryIncrement(bucketKey, windowMs);
    }

    const now = Date.now();
    res.setHeader('RateLimit-Limit', max);
    res.setHeader('RateLimit-Remaining', Math.max(0, max - bucket.count));
    res.setHeader('RateLimit-Reset', Math.ceil(bucket.resetAt / 1000));

    if (bucket.count > max) {
      res.setHeader('Retry-After', Math.ceil(Math.max(0, bucket.resetAt - now) / 1000));
      return res.status(429).json({
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
      });
    }

    return next();
  };
}
