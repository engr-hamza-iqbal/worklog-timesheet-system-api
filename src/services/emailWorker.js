import os from 'os';
import prisma from '../config/db.js';
import { sendEmailWithFallback } from './emailService.js';

let workerRunning = false;
let workerTimer = null;
const DEFAULT_WORKER_ID = `${os.hostname()}-${process.pid}`;

/**
 * Atomically claim a pending email job using PostgreSQL FOR UPDATE SKIP LOCKED.
 * If another worker is claiming concurrently, PostgreSQL skips the locked row.
 * If a job's lock has expired (> 2 minutes), it is considered abandoned and can be reclaimed.
 */
export async function claimNextEmailJob(workerId = DEFAULT_WORKER_ID) {
  const query = `
    WITH next_job AS (
      SELECT id FROM "EmailLog"
      WHERE status = 'PENDING'
        AND ("lockedAt" IS NULL OR "lockedAt" < NOW() - INTERVAL '2 minutes')
        AND ("nextRetryAt" IS NULL OR "nextRetryAt" <= NOW())
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "EmailLog"
    SET "lockedAt" = NOW(),
        "lockedBy" = $1,
        "attemptedAt" = NOW()
    FROM next_job
    WHERE "EmailLog".id = next_job.id
    RETURNING "EmailLog".*;
  `;

  const rows = await prisma.$queryRawUnsafe(query, workerId);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Process a single email job.
 * @param {object} job The claimed EmailLog record
 * @param {function} [sendFn] Optional mock/custom sender for testing
 */
export async function processEmailJob(job, sendFn = sendEmailWithFallback) {
  if (!job) return { processed: false, reason: 'No job' };

  try {
    const messageId = `<${job.id}@worklog.system>`;

    await sendFn({
      to: job.recipientEmail,
      subject: job.subject,
      html: job.html || `<p>${job.subject}</p>`,
      text: job.text || job.subject,
      messageId,
      emailLogId: job.id,
    });

    await prisma.emailLog.update({
      where: { id: job.id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        errorMessage: null,
      },
    });

    return { processed: true, success: true, jobId: job.id };
  } catch (err) {
    const nextRetryCount = (job.retryCount || 0) + 1;
    const maxRetries = job.maxRetries || 3;

    if (nextRetryCount >= maxRetries) {
      // Reached maximum attempts -> transition to dead-letter FAILED status
      await prisma.emailLog.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          retryCount: nextRetryCount,
          lockedAt: null,
          lockedBy: null,
          errorMessage: `Permanent failure after ${nextRetryCount} attempts: ${err.message}`,
        },
      });
      return { processed: true, success: false, deadLetter: true, jobId: job.id, error: err.message };
    } else {
      // Reschedule with backoff
      const backoffSeconds = Math.min(Math.pow(2, nextRetryCount), 60);
      const nextRetryAt = new Date(Date.now() + backoffSeconds * 1000);

      await prisma.emailLog.update({
        where: { id: job.id },
        data: {
          status: 'PENDING',
          retryCount: nextRetryCount,
          lockedAt: null,
          lockedBy: null,
          nextRetryAt,
          errorMessage: `Attempt ${nextRetryCount} failed: ${err.message}`,
        },
      });
      return { processed: true, success: false, retryScheduled: true, jobId: job.id, nextRetryAt };
    }
  }
}

/**
 * Claim and execute the next available job, if any.
 */
export async function processNextJob(workerId = DEFAULT_WORKER_ID, sendFn = sendEmailWithFallback) {
  const job = await claimNextEmailJob(workerId);
  if (!job) return null;
  return await processEmailJob(job, sendFn);
}

/**
 * Process a batch of jobs until empty or maxLimit reached.
 */
export async function drainEmailQueue(maxLimit = 50, workerId = DEFAULT_WORKER_ID, sendFn = sendEmailWithFallback) {
  let count = 0;
  while (count < maxLimit) {
    const result = await processNextJob(workerId, sendFn);
    if (!result) break;
    count++;
  }
  return count;
}

/**
 * Start the background poller worker loop.
 */
export function startEmailWorker({ pollIntervalMs = 15000, workerId = DEFAULT_WORKER_ID, sendFn = sendEmailWithFallback } = {}) {
  if (workerRunning) return;
  workerRunning = true;

  const runLoop = async () => {
    if (!workerRunning) return;
    let processedCount = 0;
    try {
      processedCount = await drainEmailQueue(10, workerId, sendFn);
    } catch (err) {
      console.error('[EmailWorker] Polling error:', err.message);
    } finally {
      if (workerRunning) {
        // If emails were processed, check again in 1s; if queue is empty, backoff to pollIntervalMs (default 15s)
        const delay = processedCount > 0 ? 1000 : Math.max(pollIntervalMs, 15000);
        workerTimer = setTimeout(runLoop, delay);
      }
    }
  };

  workerTimer = setTimeout(runLoop, 2000);
}

/**
 * Stop the background poller worker loop.
 */
export function stopEmailWorker() {
  workerRunning = false;
  if (workerTimer) {
    clearTimeout(workerTimer);
    workerTimer = null;
  }
}

/**
 * Trigger an immediate poll iteration (e.g. after queueing an email).
 */
export function triggerEmailWorker(workerId = DEFAULT_WORKER_ID, sendFn = sendEmailWithFallback) {
  setImmediate(async () => {
    try {
      await processNextJob(workerId, sendFn);
    } catch {}
  });
}
