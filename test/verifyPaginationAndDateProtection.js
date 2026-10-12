import http from 'http';
import app from '../src/app.js';
import prisma from '../src/config/db.js';

const PASSWORD = 'Password123!';

async function runTests() {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://localhost:${server.address().port}`;

  const request = async (path, options = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  };

  const login = async (email) =>
    (await request('/api/auth/login', { method: 'POST', body: { email, password: PASSWORD } })).body.data.token;

  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };

  console.log('--- Starting Pagination & Date Range Protection Verification ---');

  try {
    const adminToken = await login('admin@worklog.local');
    const bobToken = await login('bob@worklog.local');

    // 1. Time-Off Requests Pagination
    const timeOffPaginated = await request('/api/time-off/requests?page=1&limit=10', { token: adminToken });
    assert(timeOffPaginated.status === 200, `TimeOff pagination request failed: ${timeOffPaginated.status}`);
    assert(timeOffPaginated.body.data.page === 1, 'TimeOff page number incorrect');
    assert(timeOffPaginated.body.data.limit === 10, 'TimeOff page limit incorrect');
    assert(Array.isArray(timeOffPaginated.body.data.requests), 'TimeOff paginated requests is not an array');
    assert(typeof timeOffPaginated.body.data.total === 'number', 'TimeOff total count missing');
    console.log('✔ Time-off requests paginated endpoint returns structured pagination envelope.');

    // 2. Time-Off Requests Bounded Default
    const timeOffDefault = await request('/api/time-off/requests', { token: adminToken });
    assert(timeOffDefault.status === 200, `TimeOff default request failed: ${timeOffDefault.status}`);
    assert(Array.isArray(timeOffDefault.body.data), 'TimeOff default response is not bounded array');
    assert(timeOffDefault.body.data.length <= 50, 'TimeOff default exceeds safe limit');
    console.log('✔ Time-off requests default endpoint returns bounded array with max 50 items.');

    // 3. Users Pagination
    const usersPaginated = await request('/api/users?page=1&limit=5', { token: adminToken });
    assert(usersPaginated.status === 200, `Users pagination request failed: ${usersPaginated.status}`);
    assert(usersPaginated.body.data.page === 1, 'Users page number incorrect');
    assert(usersPaginated.body.data.limit === 5, 'Users limit incorrect');
    assert(Array.isArray(usersPaginated.body.data.users), 'Users paginated list is not an array');
    assert(typeof usersPaginated.body.data.total === 'number', 'Users total count missing');
    console.log('✔ Users paginated endpoint returns structured pagination envelope.');

    // 4. Users Bounded Default
    const usersDefault = await request('/api/users', { token: adminToken });
    assert(usersDefault.status === 200, `Users default request failed: ${usersDefault.status}`);
    assert(Array.isArray(usersDefault.body.data), 'Users default response is not bounded array');
    assert(usersDefault.body.data.length <= 50, 'Users default exceeds safe limit');
    console.log('✔ Users default endpoint returns bounded array with max 50 items.');

    // 5. Clients Pagination & Bounding
    const clientsPaginated = await request('/api/clients?page=1&limit=5', { token: adminToken });
    assert(clientsPaginated.status === 200, `Clients pagination request failed: ${clientsPaginated.status}`);
    assert(clientsPaginated.body.data.page === 1, 'Clients page incorrect');
    assert(typeof clientsPaginated.body.data.total === 'number', 'Clients total missing');
    const clientsDefault = await request('/api/clients', { token: adminToken });
    assert(Array.isArray(clientsDefault.body.data), 'Clients default is not bounded array');
    console.log('✔ Clients endpoint supports both paginated envelope and bounded default.');

    // 6. Projects Pagination & Bounding
    const projectsPaginated = await request('/api/projects?page=1&limit=5', { token: adminToken });
    assert(projectsPaginated.status === 200, `Projects pagination request failed: ${projectsPaginated.status}`);
    assert(projectsPaginated.body.data.page === 1, 'Projects page incorrect');
    assert(typeof projectsPaginated.body.data.total === 'number', 'Projects total missing');
    const projectsDefault = await request('/api/projects', { token: adminToken });
    assert(Array.isArray(projectsDefault.body.data), 'Projects default is not bounded array');
    console.log('✔ Projects endpoint supports both paginated envelope and bounded default.');

    // 7. Timesheet Calendar Date Protection: Accept valid <= 45-day range
    const validRange = await request('/api/timesheets?startDate=2026-03-01&endDate=2026-03-31', { token: bobToken });
    assert(validRange.status === 200, `Valid 31-day timesheet query failed: ${validRange.status}`);
    console.log('✔ Valid 31-day calendar query succeeds with 200.');

    // 8. Timesheet Calendar Date Protection: Reject > 45-day range
    const invalidRange = await request('/api/timesheets?startDate=2026-01-01&endDate=2026-03-15', { token: bobToken });
    assert(invalidRange.status === 400, `Excessive date range was not rejected (got ${invalidRange.status})`);
    assert(
      invalidRange.body?.error?.message?.includes('cannot exceed 45 days'),
      `Unexpected error message: ${JSON.stringify(invalidRange.body)}`
    );
    console.log('✔ Timesheet calendar query > 45 days is strictly rejected with HTTP 400.');

    // 9. Timesheet History Date Protection: Reject > 90-day range
    const invalidHistory = await request('/api/timesheets/history?startDate=2026-01-01&endDate=2026-05-01', { token: bobToken });
    assert(invalidHistory.status === 400, `Excessive history date range was not rejected (got ${invalidHistory.status})`);
    assert(
      invalidHistory.body?.error?.message?.includes('cannot exceed 90 days'),
      `Unexpected error message: ${JSON.stringify(invalidHistory.body)}`
    );
    console.log('✔ Timesheet history query > 90 days is strictly rejected with HTTP 400.');

    console.log('\n--- ALL PAGINATION & DATE PROTECTION CHECKS PASSED SUCCESSFULLY ---');
  } finally {
    server.close();
    await prisma.$disconnect();
  }
}

runTests().catch((err) => {
  console.error('Test failure:', err);
  process.exit(1);
});
