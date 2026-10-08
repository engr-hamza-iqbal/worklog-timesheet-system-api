import http from 'http';
import app from '../src/app.js';
import prisma from '../src/config/db.js';
import otpService from '../src/services/otpService.js';
import { resetRateLimitBuckets } from '../src/middleware/rateLimit.js';

async function runResetTests() {
  console.log('--- Starting Password Reset & Profile Verification ---');

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  async function request(path, options = {}) {
    const { headers = {}, ...rest } = options;
    const res = await fetch(`${baseUrl}${path}`, {
      ...rest,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body, headers: res.headers };
  }

  try {
    resetRateLimitBuckets();

    // Find an active user for testing
    const testUser = await prisma.user.findFirst({
      where: { email: 'bob@worklog.local' },
    });

    if (!testUser) {
      throw new Error('Test user bob@worklog.local not found in seed database.');
    }

    const testEmail = testUser.email;

    // 1. Request Password Reset OTP for non-existent email
    const nonExistent = await request('/api/auth/send-reset-otp', {
      method: 'POST',
      body: JSON.stringify({ email: 'nonexistent@example.com' }),
    });
    if (nonExistent.status !== 404) {
      throw new Error(`Expected 404 for non-existent user, got ${nonExistent.status}`);
    }
    console.log('✔ send-reset-otp returns 404 for non-existent user.');

    // 2. Request Password Reset OTP for bob@worklog.local
    const sendOtpRes = await request('/api/auth/send-reset-otp', {
      method: 'POST',
      body: JSON.stringify({ email: testEmail }),
    });
    if (sendOtpRes.status !== 200 || !sendOtpRes.body.success) {
      throw new Error(`Expected 200 for send-reset-otp, got ${sendOtpRes.status}: ${JSON.stringify(sendOtpRes.body)}`);
    }
    const devOtp = sendOtpRes.body.data.devOtp;
    if (!devOtp) {
      throw new Error('Expected devOtp to be returned in non-production mode.');
    }
    console.log('✔ send-reset-otp successfully generated and dispatched code.');

    // 3. Reset password using invalid OTP
    const badOtpRes = await request('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        email: testEmail,
        mode: 'otp',
        otp: '000000',
        newPassword: 'NewPassword123!',
      }),
    });
    if (badOtpRes.status !== 400) {
      throw new Error(`Expected 400 for bad OTP, got ${badOtpRes.status}`);
    }
    console.log('✔ reset-password rejects invalid OTP code.');

    // 4. Reset password using valid OTP
    const resetOtpSuccess = await request('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        email: testEmail,
        mode: 'otp',
        otp: devOtp,
        newPassword: 'NewPassword123!',
      }),
    });
    if (resetOtpSuccess.status !== 200 || !resetOtpSuccess.body.success) {
      throw new Error(`Expected 200 for valid OTP reset, got ${resetOtpSuccess.status}: ${JSON.stringify(resetOtpSuccess.body)}`);
    }
    console.log('✔ reset-password with OTP successfully updated user password.');

    // 5. Test login with newly set password
    const loginWithNewPass = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: testEmail,
        password: 'NewPassword123!',
      }),
    });
    if (loginWithNewPass.status !== 200 || !loginWithNewPass.body.success) {
      throw new Error(`Expected login to succeed with new password, got ${loginWithNewPass.status}`);
    }
    console.log('✔ login with newly reset password succeeded.');

    // 6. Reset password using Old Password (without OTP)
    const resetOldPassRes = await request('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        email: testEmail,
        mode: 'oldPassword',
        oldPassword: 'NewPassword123!',
        newPassword: 'Password123!', // revert back to standard demo password
      }),
    });
    if (resetOldPassRes.status !== 200 || !resetOldPassRes.body.success) {
      throw new Error(`Expected 200 for oldPassword reset, got ${resetOldPassRes.status}: ${JSON.stringify(resetOldPassRes.body)}`);
    }
    console.log('✔ reset-password with oldPassword succeeded.');

    // 7. Test login with reverted password
    const loginReverted = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: testEmail,
        password: 'Password123!',
      }),
    });
    if (loginReverted.status !== 200) {
      throw new Error(`Expected login with reverted password to succeed, got ${loginReverted.status}`);
    }
    const token = loginReverted.body.data.token;
    console.log('✔ login with reverted password succeeded.');

    // 8. Test PUT /api/auth/profile (authenticated profile update)
    const updateProfileRes = await request('/api/auth/profile', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: 'Bob Employee Updated',
      }),
    });
    if (updateProfileRes.status !== 200 || updateProfileRes.body.data.user.name !== 'Bob Employee Updated') {
      throw new Error(`Expected profile name to update, got ${JSON.stringify(updateProfileRes.body)}`);
    }
    console.log('✔ PUT /api/auth/profile successfully updated user name.');

    // Revert name back
    await request('/api/auth/profile', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: testUser.name,
      }),
    });

    // 9. Test changing password in profile using OTP
    const profileOtpSend = await request('/api/auth/send-reset-otp', {
      method: 'POST',
      body: JSON.stringify({ email: testEmail }),
    });
    const profileDevOtp = profileOtpSend.body.data.devOtp;

    const changePassOtpRes = await request('/api/auth/profile', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        mode: 'otp',
        otp: profileDevOtp,
        newPassword: 'BrandNewPass123!',
      }),
    });
    if (changePassOtpRes.status !== 200 || !changePassOtpRes.body.success) {
      throw new Error(`Expected changing password via OTP in profile to succeed, got ${JSON.stringify(changePassOtpRes.body)}`);
    }
    console.log('✔ PUT /api/auth/profile successfully updated password via OTP.');

    // Revert password back using oldPassword mode
    await request('/api/auth/profile', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        oldPassword: 'BrandNewPass123!',
        newPassword: 'Password123!',
      }),
    });

    console.log('--- ALL PASSWORD RESET AND PROFILE TESTS PASSED SUCCESSFULLY ---');
  } finally {
    server.close();
    await prisma.$disconnect();
  }
}

runResetTests().catch((err) => {
  console.error('Password reset tests failed:', err);
  process.exit(1);
});
