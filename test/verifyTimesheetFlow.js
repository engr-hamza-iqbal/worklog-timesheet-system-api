import http from 'http';
import app from '../src/app.js';
import prisma from '../src/config/db.js';

const PASSWORD = 'Password123!';
const WORK_DATE = '2026-09-22';

async function runTests() {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://localhost:${server.address().port}`;

  async function request(path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  }

  async function login(email) {
    const result = await request('/api/auth/login', { method: 'POST', body: { email, password: PASSWORD } });
    if (result.status !== 200) throw new Error(`Could not log in ${email}: ${JSON.stringify(result.body)}`);
    return result.body.data.token;
  }

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  try {
    const adminToken = await login('admin@worklog.local');
    const bobToken = await login('bob@worklog.local');
    const evaToken = await login('eva@worklog.local');
    const projects = (await request('/api/projects?activeOnly=true', { token: bobToken })).body.data;
    const core = projects.find((project) => project.name === 'Acme Core Platform');
    const mobile = projects.find((project) => project.name === 'Acme Mobile App');
    assert(core && mobile, 'Seeded active projects are missing.');

    const valid = await request('/api/timesheets', { method: 'POST', token: bobToken, body: { projectId: core.id, workDate: WORK_DATE, durationMinutes: 60, description: 'Build API tests' } });
    assert(valid.status === 201, `Valid time entry failed: ${valid.status} ${JSON.stringify(valid.body)}`);
    const bobEntryId = valid.body.data.id;

    const invalidDuration = await request('/api/timesheets', { method: 'POST', token: bobToken, body: { projectId: core.id, workDate: WORK_DATE, durationMinutes: 35, description: 'Invalid duration' } });
    assert(invalidDuration.status === 400, 'Invalid duration was accepted.');

    const unassigned = await request('/api/timesheets', { method: 'POST', token: bobToken, body: { projectId: mobile.id, workDate: WORK_DATE, durationMinutes: 15, description: 'Wrong project' } });
    assert(unassigned.status === 403, 'Unassigned project was accepted.');

    const submitted = await request('/api/timesheets/submit', { method: 'POST', token: bobToken, body: { entryIds: [bobEntryId] } });
    assert(submitted.status === 200 && submitted.body.data.submittedCount === 1, 'Entry submission failed.');

    const selfApproval = await request('/api/reviews/approve', { method: 'POST', token: bobToken, body: { entryIds: [bobEntryId] } });
    assert(selfApproval.status === 403, 'Self-approval was not blocked.');

    const adminEntry = await request('/api/timesheets', { method: 'POST', token: adminToken, body: { projectId: core.id, workDate: WORK_DATE, durationMinutes: 30, description: 'Review workflow fixture' } });
    assert(adminEntry.status === 201, 'Admin fixture entry failed.');
    const adminEntryId = adminEntry.body.data.id;
    const adminSubmit = await request('/api/timesheets/submit', { method: 'POST', token: adminToken, body: { entryIds: [adminEntryId] } });
    assert(adminSubmit.status === 200, 'Admin fixture submission failed.');

    const queue = await request('/api/reviews', { token: bobToken });
    assert(queue.status === 200 && queue.body.data.entries.some((entry) => entry.id === adminEntryId), 'Scoped reviewer could not see an in-scope entry.');
    const approved = await request('/api/reviews/approve', { method: 'POST', token: bobToken, body: { entryIds: [adminEntryId] } });
    assert(approved.status === 200, 'Scoped reviewer could not approve an in-scope entry.');

    const approvedEdit = await request(`/api/timesheets/${adminEntryId}`, { method: 'PUT', token: adminToken, body: { description: 'Attempt to alter approved record' } });
    assert(approvedEdit.status === 400, 'Approved entry was editable.');

    const evaQueue = await request('/api/reviews', { token: evaToken });
    assert(evaQueue.status === 403, 'User without REVIEW_TIME could access the review queue.');
    console.log('Timesheet flow verification passed.');
  } finally {
    server.close();
    await prisma.$disconnect();
  }
}

runTests().catch((error) => { console.error(error); process.exitCode = 1; });
