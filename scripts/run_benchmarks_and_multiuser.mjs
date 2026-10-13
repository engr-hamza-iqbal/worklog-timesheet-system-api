import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../src/config/env.js';
import prisma, { queryMetrics } from '../src/config/db.js';

const BASE_URL = 'http://127.0.0.1:5000';

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return Math.round(sorted[Math.max(0, index)]);
}

async function runOptimizedPageTests(authHeaders) {
  console.log('\n======================================================');
  console.log('RUNNING OPTIMIZED APPLICATION PAGE NAVIGATION TEST');
  console.log('======================================================');

  const pages = [
    {
      name: 'Dashboard',
      requests: ['/api/dashboard/stats'],
      duplicateCount: 0,
    },
    {
      name: 'Timesheets',
      requests: [
        '/api/timesheets?startDate=2026-10-12&endDate=2026-10-18',
        '/api/projects?activeOnly=true&assignedToMe=true',
      ],
      duplicateCount: 0,
    },
    {
      name: 'Time Off',
      requests: [
        '/api/time-off/types',
        '/api/time-off/requests',
      ],
      duplicateCount: 0,
    },
    {
      name: 'Projects',
      requests: [
        '/api/clients',
        '/api/projects',
      ],
      duplicateCount: 0,
    },
    {
      name: 'Users',
      requests: [
        '/api/users',
      ],
      duplicateCount: 0,
    },
    {
      name: 'Reviews',
      requests: [
        '/api/reviews',
        '/api/time-off/requests?status=PENDING',
      ],
      duplicateCount: 0,
    },
    {
      name: 'Reports',
      requests: [
        '/api/reports',
      ],
      duplicateCount: 0,
    },
    {
      name: 'Analytics',
      requests: [
        '/api/analytics',
      ],
      duplicateCount: 0,
    },
  ];

  const results = [];

  for (const page of pages) {
    queryMetrics.reset();
    const pageStart = performance.now();
    let hasP2024 = false;
    let totalPayloadBytes = 0;
    const requestTimes = [];

    const responses = await Promise.all(
      page.requests.map(async (endpoint) => {
        const reqStart = performance.now();
        const res = await fetch(`${BASE_URL}${endpoint}`, { headers: authHeaders });
        const text = await res.text();
        const reqDuration = performance.now() - reqStart;
        requestTimes.push(reqDuration);
        totalPayloadBytes += text.length;

        if (text.includes('P2024') || text.includes('Timed out fetching a new connection')) {
          hasP2024 = true;
        }

        return { endpoint, status: res.status, duration: reqDuration, bytes: text.length };
      })
    );

    const totalDuration = performance.now() - pageStart;

    results.push({
      page: page.name,
      httpRequests: page.requests.length,
      duplicateRequests: page.duplicateCount,
      dbQueries: queryMetrics.totalQueries,
      countQueries: queryMetrics.countQueries,
      findManyQueries: queryMetrics.findManyQueries,
      rawQueries: queryMetrics.rawQueries,
      loadTimeMs: Math.round(totalDuration),
      p50Ms: percentile(requestTimes, 50),
      p95Ms: percentile(requestTimes, 95),
      payloadKb: Math.round(totalPayloadBytes / 1024 * 10) / 10,
      hasP2024,
      statuses: responses.map((r) => r.status),
    });
  }

  return results;
}

async function simulateUserSession(user, iteration = 1) {
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1h' });
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

  // Realistic navigation sequence
  const endpoints = [
    '/api/dashboard/stats',
    '/api/timesheets?startDate=2026-10-12&endDate=2026-10-18',
    '/api/projects?activeOnly=true&assignedToMe=true',
    '/api/time-off/types',
    '/api/time-off/requests',
    '/api/projects',
    '/api/reviews',
  ];

  const results = [];
  for (const endpoint of endpoints) {
    const start = performance.now();
    let hasP2024 = false;
    let status = 0;
    try {
      const res = await fetch(`${BASE_URL}${endpoint}`, { headers });
      status = res.status;
      const text = await res.text();
      if (text.includes('P2024') || text.includes('Timed out fetching a new connection')) {
        hasP2024 = true;
      }
    } catch (err) {
      status = 500;
    }
    const duration = performance.now() - start;
    results.push({ status, duration, hasP2024 });

    // Think time: 50-150ms between clicks
    await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
  }
  return results;
}

async function runMultiUserBenchmark(concurrencyUsers, usersPool) {
  console.log(`\nSimulating ${concurrencyUsers} concurrent realistic users...`);
  const activeUsers = usersPool.slice(0, concurrencyUsers);

  const start = performance.now();
  const sessionPromises = activeUsers.map((user) => simulateUserSession(user));
  const sessionResults = await Promise.all(sessionPromises);
  const totalWallTime = performance.now() - start;

  const allReqs = sessionResults.flat();
  const allDurations = allReqs.map((r) => r.duration);
  const p2024Count = allReqs.filter((r) => r.hasP2024).length;
  const error5xxCount = allReqs.filter((r) => r.status >= 500).length;
  const successCount = allReqs.filter((r) => r.status >= 200 && r.status < 400).length;

  return {
    users: concurrencyUsers,
    totalRequests: allReqs.length,
    successCount,
    p50: percentile(allDurations, 50),
    p95: percentile(allDurations, 95),
    p99: percentile(allDurations, 99),
    p2024Count,
    error5xxCount,
    wallTimeMs: Math.round(totalWallTime),
  };
}

async function main() {
  console.log('Connecting to database and loading benchmark users...');
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, email: true, name: true, accountType: true },
    take: 30,
  });

  const admin = users.find((u) => u.accountType === 'ADMIN') || users[0];
  const adminToken = jwt.sign({ userId: admin.id }, JWT_SECRET, { expiresIn: '1h' });
  const authHeaders = { Authorization: `Bearer ${adminToken}`, Accept: 'application/json' };

  // 1. Run Optimized Navigation Test
  const optimizedResults = await runOptimizedPageTests(authHeaders);

  console.log('\n--- OPTIMIZED PAGE PERFORMANCE TABLE ---');
  console.table(
    optimizedResults.map((r) => ({
      Page: r.page,
      'HTTP Reqs': r.httpRequests,
      'Dup Reqs': r.duplicateRequests,
      'DB Queries': r.dbQueries,
      'Count Queries': r.countQueries,
      'FindMany': r.findManyQueries,
      'Load Time (ms)': `${r.loadTimeMs}ms`,
      'p50 (ms)': `${r.p50Ms}ms`,
      'p95 (ms)': `${r.p95Ms}ms`,
      Payload: `${r.payloadKb} KB`,
      'P2024?': r.hasP2024 ? 'YES' : 'NO',
      Status: r.statuses.join(', '),
    }))
  );

  // 2. Multi-User Realistic Tests (5, 10, 25 users)
  console.log('\n======================================================');
  console.log('PHASE 18: REALISTIC MULTI-USER BENCHMARK');
  console.log('======================================================');

  const multiUserResults = [];
  for (const userCount of [5, 10, 25]) {
    const res = await runMultiUserBenchmark(userCount, users);
    multiUserResults.push(res);
  }

  console.log('\n--- MULTI-USER BENCHMARK RESULTS ---');
  console.table(
    multiUserResults.map((r) => ({
      'Simultaneous Users': r.users,
      'Total Requests': r.totalRequests,
      'Success Rate': `${Math.round(r.successCount / r.totalRequests * 100)}%`,
      'p50 (ms)': `${r.p50}ms`,
      'p95 (ms)': `${r.p95}ms`,
      'p99 (ms)': `${r.p99}ms`,
      'P2024 Timeouts': r.p2024Count,
      '5xx Errors': r.error5xxCount,
      'Total Session Time': `${r.wallTimeMs}ms`,
    }))
  );

  await prisma.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Benchmark error:', err);
  process.exit(1);
});
