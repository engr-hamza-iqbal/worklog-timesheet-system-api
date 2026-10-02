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

  const login = async (email) => (await request('/api/auth/login', { method: 'POST', body: { email, password: PASSWORD } })).body.data.token;
  const assert = (condition, message) => { if (!condition) throw new Error(message); };

  try {
    const adminToken = await login('admin@worklog.local');
    const bobToken = await login('bob@worklog.local');
    const carolToken = await login('carol@worklog.local');

    const types = await request('/api/time-off/types', { token: bobToken });
    assert(types.status === 200 && types.body.data.length > 0, 'Types unavailable');
    const typeId = types.body.data[0].id;
    const bobUser = await prisma.user.findUnique({ where: { email: 'bob@worklog.local' } });

    // 1. Direct creation with past start date via API should be rejected
    const pastCreation = await request('/api/time-off/requests', {
      method: 'POST',
      token: bobToken,
      body: {
        timeOffTypeId: typeId,
        startDate: '2020-01-01',
        endDate: '2020-01-03',
        reason: 'Past holiday request',
      },
    });
    assert(pastCreation.status === 400, `Past time-off request was not rejected with 400 (got ${pastCreation.status})`);
    console.log('✓ Validation correctly rejects new time-off requests with past start dates.');

    // 2. Insert a request whose start date has passed in the database with status = 'PENDING'
    const pastReq = await prisma.timeOffRequest.create({
      data: {
        userId: bobUser.id,
        timeOffTypeId: typeId,
        startDate: new Date('2024-01-10T00:00:00.000Z'),
        endDate: new Date('2024-01-12T00:00:00.000Z'),
        reason: 'Unreviewed past request waiting for decision',
        status: 'PENDING',
        days: {
          create: [
            { userId: bobUser.id, date: new Date('2024-01-10T00:00:00.000Z'), status: 'PENDING' },
            { userId: bobUser.id, date: new Date('2024-01-11T00:00:00.000Z'), status: 'PENDING' },
            { userId: bobUser.id, date: new Date('2024-01-12T00:00:00.000Z'), status: 'PENDING' },
          ],
        },
      },
      include: { days: true },
    });

    // 3. Fetching time off requests should trigger autoExpirePendingRequests and mark it EXPIRED
    const allRequests = await request('/api/time-off/requests', { token: bobToken });
    assert(allRequests.status === 200, 'Failed to fetch requests');
    const foundExpired = allRequests.body.data.find((r) => r.id === pastReq.id);
    assert(foundExpired, 'Past request not found in requests list');
    assert(foundExpired.status === 'EXPIRED', `Expected past request to have status EXPIRED, got ${foundExpired.status}`);

    // Verify DB days are also EXPIRED
    const daysInDb = await prisma.timeOffDay.findMany({ where: { timeOffRequestId: pastReq.id } });
    assert(daysInDb.every((d) => d.status === 'EXPIRED'), 'Not all time off days were updated to EXPIRED');
    console.log('✓ Pending time-off requests with past start dates automatically transition to EXPIRED along with all days.');

    // 4. Review queue for PENDING requests should NOT include the expired request
    const pendingQueue = await request('/api/time-off/requests?status=PENDING', { token: carolToken });
    assert(!pendingQueue.body.data.some((r) => r.id === pastReq.id), 'Expired request erroneously appeared in PENDING review queue.');
    console.log('✓ Expired requests are excluded from the active PENDING review queue.');

    // 5. Trying to decide an expired request should fail
    const decideExpired = await request(`/api/time-off/requests/${pastReq.id}/decide`, {
      method: 'POST',
      token: adminToken,
      body: { decision: 'APPROVED' },
    });
    assert(decideExpired.status === 400, `Expected 400 when deciding expired request, got ${decideExpired.status}`);
    console.log('✓ Reviewers are blocked from approving/declining expired time-off requests.');

    // 6. Trying to cancel an expired request should fail
    const cancelExpired = await request(`/api/time-off/requests/${pastReq.id}/cancel`, {
      method: 'POST',
      token: bobToken,
    });
    assert(cancelExpired.status === 400, `Expected 400 when cancelling expired request, got ${cancelExpired.status}`);
    console.log('✓ Employees are blocked from cancelling expired time-off requests.');

    // Clean up test request
    await prisma.timeOffDay.deleteMany({ where: { timeOffRequestId: pastReq.id } });
    await prisma.timeOffRequest.delete({ where: { id: pastReq.id } });

    console.log('\nAll expiration tracking checks passed successfully!');
  } finally {
    server.close();
    await prisma.$disconnect();
  }
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exitCode = 1;
});
