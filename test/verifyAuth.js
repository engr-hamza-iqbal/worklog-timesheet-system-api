import http from 'http';
import app from '../src/app.js';
import prisma from '../src/config/db.js';
import swaggerSpec from '../src/docs/swagger.js';

async function runTests() {
  console.log('--- Starting Authentication & Access Control Verification (ESM) ---');

  // Verify Swagger Spec is generated
  if (!swaggerSpec.openapi || !swaggerSpec.paths) {
    throw new Error('Swagger spec generation failed.');
  }
  console.log('✔ Swagger OpenAPI specification generated successfully.');

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  async function request(path, options = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      ...options,
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  }

  try {
    // 1. Test 404 handler
    const notFound = await request('/api/non-existent-route');
    if (notFound.status !== 404 || notFound.body.success !== false) {
      throw new Error(`Expected 404 for non-existent route, got ${notFound.status}`);
    }
    console.log('✔ 404 handler returns standardized error format.');

    // 2. Test Registration validation - missing fields
    const regInvalid = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: '', email: 'bad-email', password: '123' }),
    });
    if (regInvalid.status !== 400 || regInvalid.body.error.code !== 'VALIDATION_ERROR') {
      throw new Error(`Expected 400 VALIDATION_ERROR, got ${regInvalid.status}`);
    }
    console.log('✔ Registration validates empty name / short password correctly.');

    // 3. Test Login validation - missing fields
    const loginInvalid = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: '', password: '' }),
    });
    if (loginInvalid.status !== 400 || loginInvalid.body.error.code !== 'VALIDATION_ERROR') {
      throw new Error(`Expected 400 VALIDATION_ERROR, got ${loginInvalid.status}`);
    }
    console.log('✔ Login validates missing credentials correctly.');

    // 4. Test Protected /api/auth/me without token -> 401
    const meNoToken = await request('/api/auth/me');
    if (meNoToken.status !== 401 || meNoToken.body.error.code !== 'UNAUTHORIZED') {
      throw new Error(`Expected 401 UNAUTHORIZED, got ${meNoToken.status}`);
    }
    console.log('✔ Protected endpoint rejects unauthenticated request with 401.');

    // 5. Test Protected /api/auth/me with invalid token -> 401
    const meBadToken = await request('/api/auth/me', {
      headers: { Authorization: 'Bearer definitely.invalid.token' },
    });
    if (meBadToken.status !== 401 || meBadToken.body.error.code !== 'INVALID_TOKEN') {
      throw new Error(`Expected 401 INVALID_TOKEN, got ${meBadToken.status}`);
    }
    console.log('✔ Protected endpoint rejects malformed token with 401.');

    // 6. Test Capability Middleware without token -> 401
    const testCap = await request('/api/test/reports-access');
    if (testCap.status !== 401) {
      throw new Error(`Expected 401 for capability check without token, got ${testCap.status}`);
    }
    console.log('✔ Capability middleware rejects unauthenticated access.');

    console.log('--- ALL AUTH VERIFICATION TESTS PASSED SUCCESSFULLY (ESM) ---');
  } finally {
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
