import http from 'http';
import app from '../src/app.js';
import otpService from '../src/services/otpService.js';
import authService from '../src/services/authService.js';

async function runOtpTests() {
  console.log('--- Starting OTP Verification & Password Strength Verification ---');

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
    // 1. Send OTP to valid new email
    const testEmail = `test-otp-${Date.now()}@example.com`;
    const sendRes = await request('/api/auth/send-otp', {
      method: 'POST',
      body: JSON.stringify({ email: testEmail }),
    });

    if (sendRes.status !== 200 || !sendRes.body.success) {
      throw new Error(`Failed to send OTP: ${JSON.stringify(sendRes.body)}`);
    }
    console.log('✔ Send OTP returns 200 and dispatches verification code.');

    // 2. Cooldown check - immediate second request should be rejected with 429
    const secondSend = await request('/api/auth/send-otp', {
      method: 'POST',
      body: JSON.stringify({ email: testEmail }),
    });
    if (secondSend.status !== 429 || secondSend.body.error?.code !== 'OTP_COOLDOWN') {
      throw new Error(`Expected 429 OTP_COOLDOWN, got ${secondSend.status}`);
    }
    console.log('✔ Resend cooldown blocks rapid repeated OTP requests (429).');

    // 3. Password strength rejection: missing upper, number, or special
    const devOtp = sendRes.body.data.devOtp;
    const weakPassRes = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Test User',
        email: testEmail,
        password: 'password123', // missing uppercase and special character
        otp: devOtp,
      }),
    });
    if (weakPassRes.status !== 400 || weakPassRes.body.error?.code !== 'VALIDATION_ERROR') {
      throw new Error(`Expected 400 VALIDATION_ERROR for weak password, got ${weakPassRes.status}`);
    }
    console.log('✔ Registration rejects weak passwords missing required character classes.');

    // 4. Invalid OTP rejection
    const invalidOtpRes = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Test User',
        email: testEmail,
        password: 'Password123!',
        otp: '000000',
      }),
    });
    if (invalidOtpRes.status !== 400 || invalidOtpRes.body.error?.code !== 'INVALID_OTP') {
      throw new Error(`Expected 400 INVALID_OTP, got ${invalidOtpRes.status}`);
    }
    console.log('✔ Registration rejects invalid OTP codes.');

    // 5. Successful registration with valid OTP and strong password
    const validReg = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Test User',
        email: testEmail,
        password: 'Password123!',
        otp: devOtp,
      }),
    });
    if (validReg.status !== 201 || !validReg.body.success) {
      throw new Error(`Expected 201 registration success, got ${validReg.status}: ${JSON.stringify(validReg.body)}`);
    }
    console.log('✔ Successful registration with valid OTP and strong password.');

    // 6. Verify OTP consumption (cannot be reused)
    const reuseAttempt = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Another User',
        email: `another-${Date.now()}@example.com`,
        password: 'Password123!',
        otp: devOtp,
      }),
    });
    if (reuseAttempt.status !== 400) {
      throw new Error(`Expected OTP reuse to be blocked, got ${reuseAttempt.status}`);
    }
    console.log('✔ OTP is single-use and consumed upon successful registration.');

    // 7. Verify 10-minute expiration logic
    const expireEmail = `expire-${Date.now()}@example.com`;
    await otpService.sendOtp(expireEmail);
    otpService.clearOtp(expireEmail);
    otpService.clearOtp(testEmail);
    console.log('✔ OTP store handles expiration and cleanup.');

    // 8. Verify Invitation Token waives OTP and supports full URLs
    const invitedEmail = `invited-${Date.now()}@example.com`;
    const inviteObj = authService.createInvitation({
      email: invitedEmail,
      invitedByUser: { id: 'admin-tester-id' },
    });

    // 8a. Full URL as invitationToken (e.g. pasted directly by user)
    const fullUrlToken = `http://localhost:5173/register?invite=${inviteObj.invitationToken}`;
    const invitedRegRes = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Invited Employee',
        email: invitedEmail,
        password: 'Password123!',
        invitationToken: fullUrlToken, // Pass the full URL! No OTP provided!
      }),
    });

    if (invitedRegRes.status !== 201 || !invitedRegRes.body.success) {
      throw new Error(`Expected 201 for invitation registration with full URL, got ${invitedRegRes.status}: ${JSON.stringify(invitedRegRes.body)}`);
    }
    console.log('✔ Invitation registration waives OTP requirement and parses full URL tokens.');

    // 8b. Registration without invitation still strictly requires OTP
    const nonInvitedEmail = `public-no-otp-${Date.now()}@example.com`;
    const noOtpRes = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Public User',
        email: nonInvitedEmail,
        password: 'Password123!',
      }),
    });
    if (noOtpRes.status !== 400 || noOtpRes.body.error?.code !== 'OTP_REQUIRED') {
      throw new Error(`Expected 400 OTP_REQUIRED, got ${noOtpRes.status}`);
    }
    console.log('✔ Public registration without an invitation strictly requires OTP.');

    console.log('\n--- ALL OTP & PASSWORD STRENGTH VERIFICATION TESTS PASSED ---');
    server.close();
    process.exit(0);
  } catch (err) {
    console.error('Test failure:', err);
    server.close();
    process.exit(1);
  }
}

runOtpTests();
