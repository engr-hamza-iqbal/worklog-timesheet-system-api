import http from 'http';
import app from '../src/app.js';
import prisma from '../src/config/db.js';

const PASSWORD = 'Password123!';

async function runTests() {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://localhost:${server.address().port}`;
  const createdEntryIds = [];

  const request = async (path, options = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  };
  const assert = (condition, message) => { if (!condition) throw new Error(message); };

  try {
    const login = await request('/api/auth/login', {
      method: 'POST',
      body: { email: 'bob@worklog.local', password: PASSWORD },
    });
    assert(login.status === 200, 'Could not log in history test user.');
    const token = login.body.data.token;

    const projects = await request('/api/projects?activeOnly=true', { token });
    const project = projects.body.data.find((item) => item.name === 'Acme Core Platform');
    assert(project, 'History test project is missing.');

    const workDate = new Date();
    workDate.setUTCDate(workDate.getUTCDate() - 2);
    const date = workDate.toISOString().slice(0, 10);
    const created = await request('/api/timesheets', {
      method: 'POST',
      token,
      body: { projectId: project.id, workDate: date, durationMinutes: 45, description: 'History endpoint regression fixture' },
    });
    assert(created.status === 201, `History fixture creation failed: ${created.status}`);
    createdEntryIds.push(created.body.data.id);

    const filtered = await request('/api/timesheets/history?page=1&pageSize=1&search=regression&sortBy=workDate&sortOrder=desc', { token });
    assert(filtered.status === 200, `History query failed: ${filtered.status}`);
    assert(filtered.body.data.pagination.total === 1, 'History search did not return exactly the fixture.');
    assert(filtered.body.data.entries[0].description.includes('regression'), 'History result returned the wrong entry.');

    const invalid = await request('/api/timesheets/history?pageSize=101', { token });
    assert(invalid.status === 400 && invalid.body.error.code === 'VALIDATION_ERROR', 'Invalid history pagination was accepted.');

    console.log('History flow verification passed.');
  } finally {
    server.close();
    if (createdEntryIds.length > 0) {
      await prisma.timeEntry.updateMany({ where: { id: { in: createdEntryIds } }, data: { deletedAt: new Date() } });
    }
    await prisma.$disconnect();
  }
}

runTests().then(() => process.exit(0)).catch((error) => { console.error(error); process.exitCode = 1; });
