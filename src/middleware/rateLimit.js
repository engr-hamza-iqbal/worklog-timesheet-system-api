const buckets = new Map();

function cleanup(now) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function createRateLimiter({ key, windowMs, max }) {
  return (req, res, next) => {
    const now = Date.now();
    cleanup(now);
    const identity = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const bucketKey = `${key}:${identity}`;
    const bucket = buckets.get(bucketKey) || { count: 0, resetAt: now + windowMs };
    bucket.count += 1;
    buckets.set(bucketKey, bucket);

    res.setHeader('RateLimit-Limit', max);
    res.setHeader('RateLimit-Remaining', Math.max(0, max - bucket.count));
    res.setHeader('RateLimit-Reset', Math.ceil(bucket.resetAt / 1000));

    if (bucket.count > max) {
      res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000));
      return res.status(429).json({
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
      });
    }

    return next();
  };
}
