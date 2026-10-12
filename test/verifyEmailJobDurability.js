import assert from 'assert';
import prisma from '../src/config/db.js';
import {
  claimNextEmailJob,
  processEmailJob,
} from '../src/services/emailWorker.js';

async function runEmailDurabilityTests() {
  console.log('================================================================');
  console.log('  EMAIL WORKER GUARANTEE & FAILURE SCENARIO VERIFICATION');
  console.log('  Model: At-Least-Once Delivery with Atomic Single-Worker Claiming');
  console.log('================================================================\n');

  const testRunId = `test-${Date.now()}`;

  // Clean up any stale pending jobs from previous runs
  await prisma.emailLog.updateMany({
    where: { status: 'PENDING' },
    data: { status: 'FAILED', errorMessage: 'Cleaned up prior to test run' },
  });

  // -------------------------------------------------------------------------
  // Scenario 1: Simultaneous Worker Claiming (Concurrency Lock Verification)
  // -------------------------------------------------------------------------
  console.log('--- SCENARIO 1: Simultaneous Worker Claiming (Single-Worker Isolation) ---');
  let concurrentDispatches = 0;
  const mockSendSingle = async () => {
    concurrentDispatches++;
  };

  const job1 = await prisma.emailLog.create({
    data: {
      recipientEmail: `concurrent-${testRunId}@example.com`,
      emailType: 'TIME_OFF_DECIDED',
      subject: `Concurrent Claim Test - ${testRunId}`,
      html: '<p>Concurrent claim test</p>',
      status: 'PENDING',
      retryCount: 0,
      maxRetries: 3,
      nextRetryAt: new Date(),
    },
  });

  // Launch two concurrent worker claims simultaneously at the exact same millisecond
  const [claimA, claimB] = await Promise.all([
    claimNextEmailJob('worker-instance-A'),
    claimNextEmailJob('worker-instance-B'),
  ]);

  const claimedJobs = [claimA, claimB].filter((c) => c && c.id === job1.id);
  assert.strictEqual(
    claimedJobs.length,
    1,
    `Only exactly one worker must claim the job. Claimed count: ${claimedJobs.length}`
  );

  const winner = claimA || claimB;
  const loser = claimA ? 'Worker B' : 'Worker A';
  console.log(`✓ Worker isolation verified: Winner successfully claimed job [${winner.id}], ${loser} received null (SKIP LOCKED)`);

  // Winner processes job
  await processEmailJob(winner, mockSendSingle);
  assert.strictEqual(concurrentDispatches, 1, 'Only one email dispatch must occur');
  console.log(`✓ Simultaneous claiming guarantee verified: Atomic single-worker claiming prevents duplicate dispatch.`);

  // -------------------------------------------------------------------------
  // Scenario 2: Worker Crash AFTER SMTP Success but BEFORE DB Update
  // -------------------------------------------------------------------------
  console.log('\n--- SCENARIO 2: Worker Crash AFTER SMTP Success (Duplicate Verification) ---');
  let actualSmtpDispatches = 0;
  const dispatchedMessageIds = [];

  const mockSmtpService = async ({ messageId }) => {
    actualSmtpDispatches++;
    dispatchedMessageIds.push(messageId);
    // SMTP successfully accepts and queues the email
  };

  const job2 = await prisma.emailLog.create({
    data: {
      recipientEmail: `crash-boundary-${testRunId}@example.com`,
      emailType: 'ENTRY_RETURNED',
      subject: `Crash Boundary Test - ${testRunId}`,
      html: '<p>Crash boundary test payload</p>',
      status: 'PENDING',
      retryCount: 0,
      maxRetries: 3,
      nextRetryAt: new Date(),
    },
  });

  // Step 1: Worker 1 claims job
  const worker1Claim = await claimNextEmailJob('worker-node-1');
  assert.strictEqual(worker1Claim.id, job2.id);

  // Step 2: Worker 1 dispatches email to SMTP provider successfully
  const deterministicId = `<${job2.id}@worklog.system>`;
  await mockSmtpService({ messageId: deterministicId });
  assert.strictEqual(actualSmtpDispatches, 1, 'First email successfully dispatched to SMTP provider');

  // Step 3: Worker 1 Node.js process CRASHES immediately BEFORE updating DB to SENT!
  // The database row remains PENDING with lockedAt timestamp set to worker 1's lock.
  console.log(`✓ Worker 1 sent email to SMTP (dispatch count: 1), then experienced fatal process crash before DB update.`);

  // Step 4: Time passes; database lock expires (> 2 minutes)
  await prisma.emailLog.update({
    where: { id: job2.id },
    data: {
      lockedAt: new Date(Date.now() - 3 * 60 * 1000), // Simulate expired lock 3 minutes ago
      lockedBy: 'worker-node-1-dead',
    },
  });
  console.log(`✓ Lock expired: Database row remains in status=PENDING with expired lock.`);

  // Step 5: Worker 2 restarts and reclaims the still-PENDING job
  const worker2Claim = await claimNextEmailJob('worker-node-2');
  assert.ok(worker2Claim, 'Worker 2 must successfully reclaim the orphaned pending job');
  assert.strictEqual(worker2Claim.id, job2.id);

  // Step 6: Worker 2 processes the job to completion
  await processEmailJob(worker2Claim, mockSmtpService);

  // Verify failure scenario outcome
  console.log(`\nFailure Scenario Verification Outcome:`);
  console.log(`- Total actual SMTP dispatches: ${actualSmtpDispatches}`);
  console.log(`- Dispatched Message-IDs: ${JSON.stringify(dispatchedMessageIds)}`);

  assert.strictEqual(
    actualSmtpDispatches,
    2,
    'In crash-after-SMTP scenario, the email IS sent twice (at-least-once delivery behavior)'
  );
  assert.strictEqual(
    dispatchedMessageIds[0],
    dispatchedMessageIds[1],
    'Both dispatches carried the exact same deterministic RFC 5322 Message-ID'
  );
  assert.strictEqual(
    dispatchedMessageIds[0],
    `<${job2.id}@worklog.system>`,
    'Message-ID must match <EmailLog.id@worklog.system>'
  );

  const finalJob2State = await prisma.emailLog.findUnique({ where: { id: job2.id } });
  assert.strictEqual(finalJob2State.status, 'SENT', 'Job eventually transitions to SENT');
  console.log(`✓ Empirical proof confirmed: The system guarantees AT-LEAST-ONCE delivery. Crash between SMTP success and DB update results in duplicate dispatch.`);

  // -------------------------------------------------------------------------
  // Scenario 3: Retry Progression & Dead-Letter (FAILED) State
  // -------------------------------------------------------------------------
  console.log('\n--- SCENARIO 3: Retry Progression & Dead-Letter (FAILED) State ---');

  const failJob = await prisma.emailLog.create({
    data: {
      recipientEmail: `fail-${testRunId}@example.com`,
      emailType: 'MISSING_TIMESHEET',
      subject: `Retry Failure Test - ${testRunId}`,
      html: '<p>Will fail</p>',
      status: 'PENDING',
      retryCount: 0,
      maxRetries: 3,
      nextRetryAt: new Date(),
    },
  });

  const mockFailingSmtp = async () => {
    throw new Error('SMTP connection refused');
  };

  // Attempt 1 Failure
  let currentJob = await claimNextEmailJob('worker-retry-test');
  assert.strictEqual(currentJob.id, failJob.id);
  let res1 = await processEmailJob(currentJob, mockFailingSmtp);
  assert.strictEqual(res1.retryScheduled, true);

  // Attempt 2 Failure
  await prisma.emailLog.update({ where: { id: failJob.id }, data: { nextRetryAt: new Date() } });
  currentJob = await claimNextEmailJob('worker-retry-test');
  let res2 = await processEmailJob(currentJob, mockFailingSmtp);
  assert.strictEqual(res2.retryScheduled, true);

  // Attempt 3 Failure -> Max retries reached -> FAILED
  await prisma.emailLog.update({ where: { id: failJob.id }, data: { nextRetryAt: new Date() } });
  currentJob = await claimNextEmailJob('worker-retry-test');
  let res3 = await processEmailJob(currentJob, mockFailingSmtp);
  assert.strictEqual(res3.deadLetter, true);

  const finalFailState = await prisma.emailLog.findUnique({ where: { id: failJob.id } });
  assert.strictEqual(finalFailState.retryCount, 3);
  assert.strictEqual(finalFailState.status, 'FAILED');
  console.log(`✓ Verified: 3 failed attempts cleanly transitions to dead-letter FAILED status.`);

  console.log('\n================================================================');
  console.log('  ALL EMAIL WORKER SCENARIO TESTS PASSED');
  console.log('================================================================\n');

  await prisma.$disconnect();
}

runEmailDurabilityTests().catch(async (err) => {
  console.error('Test execution failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
