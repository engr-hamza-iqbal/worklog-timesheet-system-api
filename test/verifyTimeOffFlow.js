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
      headers: { 'Content-Type': 'application/json', ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  };
  const login = async (email) => (await request('/api/auth/login', { method: 'POST', body: { email, password: PASSWORD } })).body.data.token;
  const assert = (condition, message) => { if (!condition) throw new Error(message); };

  const day = new Date();
  day.setUTCDate(day.getUTCDate() + 400 + Math.floor(Math.random() * 100));
  const startDate = day.toISOString().slice(0, 10);
  day.setUTCDate(day.getUTCDate() + 1);
  const endDate = day.toISOString().slice(0, 10);

  try {
    const adminToken = await login('admin@worklog.local');
    const bobToken = await login('bob@worklog.local');
    const carolToken = await login('carol@worklog.local');
    const evaToken = await login('eva@worklog.local');
    const types = await request('/api/time-off/types', { token: bobToken });
    assert(types.status === 200 && types.body.data.length > 0, 'Time-off types are unavailable.');
    const typeId = types.body.data[0].id;

    const created = await request('/api/time-off/requests', { method: 'POST', token: bobToken, body: { timeOffTypeId: typeId, startDate, endDate, reason: 'Family appointment' } });
    assert(created.status === 201 && created.body.data.days.length === 2, 'Valid time-off request failed to materialize its days.');
    const requestId = created.body.data.id;

    const reversed = await request('/api/time-off/requests', { method: 'POST', token: bobToken, body: { timeOffTypeId: typeId, startDate: endDate, endDate: startDate, reason: 'Invalid range' } });
    assert(reversed.status === 400, 'Reversed time-off dates were accepted.');

    const overlap = await request('/api/time-off/requests', { method: 'POST', token: bobToken, body: { timeOffTypeId: typeId, startDate, endDate, reason: 'Overlapping request' } });
    assert(overlap.status === 409, 'Overlapping time-off request was accepted.');

    const selfDecision = await request(`/api/time-off/requests/${requestId}/decide`, { method: 'POST', token: bobToken, body: { decision: 'APPROVED' } });
    assert(selfDecision.status === 403, 'Employee could decide their own time-off request.');

    const carolQueue = await request('/api/time-off/requests?status=PENDING', { token: carolToken });
    assert(carolQueue.status === 200 && carolQueue.body.data.some((item) => item.id === requestId), 'Global DECIDE_TIME_OFF user could not see another employee request.');

    const evaDecision = await request(`/api/time-off/requests/${requestId}/decide`, { method: 'POST', token: evaToken, body: { decision: 'APPROVED' } });
    assert(evaDecision.status === 403, 'User without DECIDE_TIME_OFF could decide a request.');

    const cancelled = await request(`/api/time-off/requests/${requestId}/cancel`, { method: 'POST', token: bobToken });
    assert(cancelled.status === 200 && cancelled.body.data.status === 'CANCELLED', 'Employee could not cancel their pending request.');

    const second = await request('/api/time-off/requests', { method: 'POST', token: bobToken, body: { timeOffTypeId: typeId, startDate, endDate, reason: 'Second family appointment' } });
    assert(second.status === 201, 'A cancelled time-off period could not be requested again.');
    const approved = await request(`/api/time-off/requests/${second.body.data.id}/decide`, { method: 'POST', token: adminToken, body: { decision: 'APPROVED' } });
    assert(approved.status === 200 && approved.body.data.status === 'APPROVED', `Administrator could not approve a pending request: ${approved.status} ${JSON.stringify(approved.body)}`);

    console.log('Time-off flow verification passed.');
  } finally {
    server.close();
    await prisma.$disconnect();
  }
}

runTests().catch((error) => { console.error(error); process.exitCode = 1; });
