import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../src/config/env.js';
import prisma, { queryMetrics } from '../src/config/db.js';

const BASE_URL = 'http://localhost:5000';

async function main() {
  console.log('====================================================');
  console.log('PHASE 1: REPRODUCE NORMAL PAGE LOADING BASELINE');
  console.log('====================================================');

  const admin = await prisma.user.findFirst({
    where: { accountType: 'ADMIN', isActive: true },
    select: { id: true, email: true, name: true },
  });

  if (!admin) {
    console.error('No active admin user found in database!');
    process.exit(1);
  }

  console.log(`Using Admin User: ${admin.name} (${admin.email}, ID: ${admin.id})`);
  const token = jwt.sign({ userId: admin.id }, JWT_SECRET, { expiresIn: '1h' });
  const authHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };

  const pages = [
    {
      name: 'Dashboard',
      requests: [
        '/api/auth/me',
        '/api/projects?activeOnly=true',
        '/api/reviews',
        '/api/time-off/requests?status=PENDING',
      ],
      duplicateCount: 0,
    },
    {
      name: 'Timesheets',
      requests: [
        '/api/auth/me',
        '/api/timesheets?startDate=2026-10-12&endDate=2026-10-18',
        '/api/projects?activeOnly=true&assignedToMe=true',
        '/api/timesheets/history?page=1&pageSize=10',
        '/api/projects?activeOnly=true',
      ],
      duplicateCount: 1, // /api/projects called twice on initial load
    },
    {
      name: 'Time Off',
      requests: [
        '/api/auth/me',
        '/api/time-off/types',
        '/api/time-off/requests',
      ],
      duplicateCount: 0,
    },
    {
      name: 'Projects',
      requests: [
        '/api/auth/me',
        '/api/clients',
        '/api/projects',
      ],
      duplicateCount: 0,
    },
    {
      name: 'Users',
      requests: [
        '/api/auth/me',
        '/api/users',
      ],
      duplicateCount: 0,
    },
    {
      name: 'Reviews',
      requests: [
        '/api/auth/me',
        '/api/reviews',
        '/api/time-off/requests?status=PENDING',
      ],
      duplicateCount: 0,
    },
    {
      name: 'Reports',
      requests: [
        '/api/auth/me',
        '/api/reports',
        '/api/reports/missing-timesheets?date=2026-10-13',
        '/api/reports/who-is-away?date=2026-10-13',
        '/api/reports/review-queue-by-reviewer',
        '/api/users',
      ],
      duplicateCount: 0,
    },
    {
      name: 'Analytics',
      requests: [
        '/api/auth/me',
        '/api/analytics',
      ],
      duplicateCount: 0,
    },
  ];

  const results = [];

  for (const page of pages) {
    console.log(`\nTesting page: ${page.name} (${page.requests.length} parallel requests)...`);
    queryMetrics.reset();

    const pageStart = performance.now();
    let hasP2024 = false;
    let totalPayloadBytes = 0;
    const requestTimes = [];

    const requestPromises = page.requests.map(async (endpoint) => {
      const reqStart = performance.now();
      try {
        const res = await fetch(`${BASE_URL}${endpoint}`, { headers: authHeaders });
        const text = await res.text();
        const reqDuration = performance.now() - reqStart;
        requestTimes.push(reqDuration);
        totalPayloadBytes += text.length;

        if (text.includes('P2024') || text.includes('Timed out fetching a new connection')) {
          hasP2024 = true;
          console.error(`[P2024 DETECTED] on ${endpoint}: ${text.slice(0, 150)}`);
        }

        if (!res.ok) {
          console.warn(`[HTTP ${res.status}] ${endpoint}: ${text.slice(0, 100)}`);
        }

        return { endpoint, status: res.status, duration: reqDuration, bytes: text.length };
      } catch (err) {
        const reqDuration = performance.now() - reqStart;
        requestTimes.push(reqDuration);
        console.error(`[FETCH ERROR] on ${endpoint}: ${err.message}`);
        if (err.message.includes('P2024')) hasP2024 = true;
        return { endpoint, status: 0, error: err.message, duration: reqDuration };
      }
    });

    const responses = await Promise.all(requestPromises);
    const totalPageDuration = performance.now() - pageStart;

    requestTimes.sort((a, b) => a - b);
    const p50 = requestTimes[Math.floor(requestTimes.length * 0.5)] || 0;
    const p95 = requestTimes[Math.floor(requestTimes.length * 0.95)] || requestTimes[requestTimes.length - 1] || 0;

    results.push({
      page: page.name,
      httpRequests: page.requests.length,
      dbQueries: queryMetrics.totalQueries,
      countQueries: queryMetrics.countQueries,
      findManyQueries: queryMetrics.findManyQueries,
      rawQueries: queryMetrics.rawQueries,
      duplicateRequests: page.duplicateCount,
      loadTimeMs: Math.round(totalPageDuration),
      p50Ms: Math.round(p50),
      p95Ms: Math.round(p95),
      payloadKb: (totalPayloadBytes / 1024).toFixed(1),
      p2024: hasP2024 ? 'YES' : 'No',
    });

    // Small pause to let DB breathe between page tests
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log('\n====================================================');
  console.log('PHASE 1 BASELINE TABLE');
  console.log('====================================================');
  console.log('| Page | HTTP Requests | DB Queries | Count Queries | Duplicate Requests | Load Time | P2024? |');
  console.log('|---|---|---|---|---|---|---|');
  for (const r of results) {
    console.log(`| ${r.page} | ${r.httpRequests} | ${r.dbQueries} | ${r.countQueries} | ${r.duplicateRequests} | ${r.loadTimeMs}ms | ${r.p2024} |`);
  }

  console.log('\nDetailed Metrics:');
  console.table(results);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Fatal benchmark error:', err);
  process.exit(1);
});
