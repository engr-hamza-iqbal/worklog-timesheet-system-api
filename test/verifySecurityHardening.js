import http from 'http';
import app from '../src/app.js';
import prisma from '../src/config/db.js';
import authService, { createInvitation, verifyInvitationToken } from '../src/services/authService.js';
import { databaseIncrement } from '../src/middleware/rateLimit.js';
import { auditAndCleanRatePeriods } from '../src/utils/ratePeriodCleanup.js';
import { getAnalytics } from '../src/services/analyticsService.js';
import emailService from '../src/services/emailService.js';

async function runSecurityTests() {
  console.log('--- Starting Production Security & Hardening Verification ---');

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
    const setCookie = res.headers.get('set-cookie');
    return { status: res.status, body, headers: res.headers, setCookie };
  }

  try {
    // ── 1. Invitation Token Generation & Verification ──────────────────────────
    console.log('1. Testing Invitation and Domain Verification...');
    const dummyAdmin = { id: 'admin-123', email: 'admin@company.com' };
    const invite = createInvitation({ email: 'invitee@company.com', invitedByUser: dummyAdmin, expiresInHours: 24 });
    if (!invite.invitationToken || invite.email !== 'invitee@company.com') {
      throw new Error('createInvitation failed to produce expected invitation token.');
    }

    const decoded = verifyInvitationToken(invite.invitationToken, 'invitee@company.com');
    if (decoded.email !== 'invitee@company.com') {
      throw new Error('verifyInvitationToken failed to decode token.');
    }

    // Verify email mismatch is rejected
    let mismatchRejected = false;
    try {
      verifyInvitationToken(invite.invitationToken, 'intruder@other.com');
    } catch (e) {
      if (e.code === 'INVITATION_EMAIL_MISMATCH') mismatchRejected = true;
    }
    if (!mismatchRejected) {
      throw new Error('Expected INVITATION_EMAIL_MISMATCH error for non-matching email.');
    }
    console.log('  ✔ Invitation tokens cryptographically bind to target email and reject mismatches.');

    // ── 2. CSRF Synchronizer-Token Protection ──────────────────────────────────
    console.log('2. Testing CSRF Synchronizer-Token Protection...');
    // Login as existing seeded admin to obtain cookies
    const loginRes = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@worklog.local', password: 'Password123!' }),
    });

    if (loginRes.status !== 200 || !loginRes.body.data?.token) {
      throw new Error(`Login failed in test setup: ${JSON.stringify(loginRes.body)}`);
    }

    const cookieHeader = loginRes.setCookie;
    const sessionMatch = cookieHeader?.match(/worklog_session=([^;]+)/);
    const csrfMatch = cookieHeader?.match(/worklog_csrf_token=([^;]+)/);
    const sessionCookie = sessionMatch ? sessionMatch[1] : null;
    const csrfCookie = csrfMatch ? csrfMatch[1] : null;

    if (!sessionCookie || !csrfCookie) {
      throw new Error('Login must issue both worklog_session and worklog_csrf_token cookies.');
    }

    // A: Cookie-authenticated mutation without CSRF token header must be rejected (403 CSRF_REJECTED)
    const rejectNoCsrf = await request('/api/auth/logout', {
      method: 'POST',
      headers: {
        Cookie: `worklog_session=${sessionCookie}; worklog_csrf_token=${csrfCookie}`,
      },
    });
    if (rejectNoCsrf.status !== 403 || rejectNoCsrf.body?.error?.code !== 'CSRF_REJECTED') {
      throw new Error(`Expected 403 CSRF_REJECTED without X-CSRF-Token header, got ${rejectNoCsrf.status}`);
    }
    console.log('  ✔ Mutation with session cookie but missing X-CSRF-Token is blocked with 403 CSRF_REJECTED.');

    // B: Cookie-authenticated mutation with invalid CSRF token header must be rejected (403 CSRF_REJECTED)
    const rejectBadCsrf = await request('/api/auth/logout', {
      method: 'POST',
      headers: {
        Cookie: `worklog_session=${sessionCookie}; worklog_csrf_token=${csrfCookie}`,
        'X-CSRF-Token': 'forged_or_invalid_token',
      },
    });
    if (rejectBadCsrf.status !== 403 || rejectBadCsrf.body?.error?.code !== 'CSRF_REJECTED') {
      throw new Error(`Expected 403 CSRF_REJECTED with mismatching X-CSRF-Token, got ${rejectBadCsrf.status}`);
    }
    console.log('  ✔ Mutation with mismatching X-CSRF-Token is blocked with 403 CSRF_REJECTED.');

    // C: Cookie-authenticated mutation with matching X-CSRF-Token must succeed
    const allowValidCsrf = await request('/api/auth/logout', {
      method: 'POST',
      headers: {
        Cookie: `worklog_session=${sessionCookie}; worklog_csrf_token=${csrfCookie}`,
        'X-CSRF-Token': csrfCookie,
      },
    });
    if (allowValidCsrf.status !== 200 || !allowValidCsrf.body?.data?.loggedOut) {
      throw new Error(`Expected 200 with valid X-CSRF-Token, got ${allowValidCsrf.status}`);
    }
    console.log('  ✔ Mutation with valid double-submit X-CSRF-Token succeeds.');

    // D: Bearer token clients without session cookie are not subject to browser CSRF
    const apiBearer = loginRes.body.data.token;
    const bearerMe = await request('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${apiBearer}`,
      },
    });
    if (bearerMe.status !== 200) {
      throw new Error(`Expected 200 for pure Bearer API client, got ${bearerMe.status}`);
    }
    console.log('  ✔ API Bearer token clients remain supported without browser cookie CSRF interference.');

    // ── 3. Distributed Rate-Limit Storage ──────────────────────────────────────
    console.log('3. Testing Distributed Rate-Limit Storage...');
    const testKey = `test_limit_${Date.now()}`;
    const windowMs = 60000;
    const inc1 = await databaseIncrement(testKey, windowMs);
    const inc2 = await databaseIncrement(testKey, windowMs);

    if (!inc1 || !inc2 || inc1.count !== 1 || inc2.count !== 2) {
      throw new Error(`Database rate limit increment failed: inc1=${JSON.stringify(inc1)}, inc2=${JSON.stringify(inc2)}`);
    }
    console.log('  ✔ Database-backed distributed rate limit store performs atomic increments.');

    // ── 4. Rate-Period Continuity & Database Cleanup ───────────────────────────
    console.log('4. Testing Rate-Period Cleanup & Continuity Audit...');
    const auditReport = await auditAndCleanRatePeriods({ dryRun: false });
    if (typeof auditReport.totalProjects !== 'number') {
      throw new Error('Rate period audit failed to return audit report.');
    }
    // After audit and clean, run second pass to verify 0 remaining issues
    const secondPass = await auditAndCleanRatePeriods({ dryRun: true });
    if (secondPass.projectsWithIssues !== 0) {
      throw new Error(`Expected 0 remaining rate period issues after cleanup, found ${secondPass.projectsWithIssues}`);
    }
    console.log(`  ✔ Verified rate period continuity across ${secondPass.totalProjects} projects (0 overlaps).`);

    // ── 5. Analytics Contract Verification ─────────────────────────────────────
    console.log('5. Testing Analytics Contract Completion...');
    const analytics = await getAnalytics({
      startDate: '2020-01-01',
      endDate: '2030-12-31',
    });

    const expectedKeys = ['weekly', 'projects', 'clients', 'employees', 'statusBreakdown', 'timeOff', 'submissionTimeliness'];
    for (const key of expectedKeys) {
      if (!(key in analytics)) {
        throw new Error(`Analytics payload is missing contract field: "${key}"`);
      }
    }
    if (!analytics.submissionTimeliness.overall || typeof analytics.submissionTimeliness.overall.onTimePercentage !== 'number') {
      throw new Error('Analytics submissionTimeliness.overall is missing onTimePercentage metric.');
    }
    console.log('  ✔ Analytics contract complete: includes statusBreakdown, timeOff, and submissionTimeliness.');

    // ── 6. Missing Timesheet Reminder Deduplication ────────────────────────────
    console.log('6. Testing Reminder Idempotency...');
    const adminUser = await prisma.user.findFirst({ where: { accountType: 'ADMIN' } });
    if (adminUser) {
      const today = new Date().toISOString().slice(0, 10);
      await prisma.emailLog.deleteMany({
        where: { recipientUserId: adminUser.id, emailType: 'MISSING_TIMESHEET' },
      });

      const canSendBefore = await emailService.canSendMissingTimesheetChase(adminUser.id, today);
      if (!canSendBefore) {
        throw new Error('canSendMissingTimesheetChase should return true when no reminder exists for today.');
      }

      await emailService.reserveEmailLog({
        recipientUserId: adminUser.id,
        recipientEmail: adminUser.email,
        emailType: 'MISSING_TIMESHEET',
        subject: 'Timesheet Reminder',
        referenceDate: today,
      });

      const canSendAfter = await emailService.canSendMissingTimesheetChase(adminUser.id, today);
      if (canSendAfter) {
        throw new Error('canSendMissingTimesheetChase should return false after reminder was reserved today.');
      }
      console.log('  ✔ Reminder idempotency: duplicate reminders within same day are rejected.');
    }

    console.log('\nAll Production Security & Hardening verification checks PASSED successfully!\n');
  } finally {
    server.close();
    await prisma.$disconnect();
  }
}

runSecurityTests().catch((err) => {
  console.error('\n❌ Security Hardening Verification FAILED:', err);
  process.exit(1);
});
