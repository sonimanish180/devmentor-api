import { Worker } from 'bullmq';
import { createQueueConnection } from './connection';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';
import type { WelcomeEmailJob } from './email.queue';

/**
 * Processes "email" jobs. Queues give AT-LEAST-ONCE delivery: a job may run more
 * than once (a retry after a crash mid-processing). So the handler must be
 * IDEMPOTENT — here a one-time Redis marker guards the side-effect so the same
 * welcome email is never sent twice.
 */
export function startEmailWorker(): Worker<WelcomeEmailJob> {
  const worker = new Worker<WelcomeEmailJob>(
    'email',
    async (job) => {
      const { userId, email } = job.data;

      const guard = `job:welcome:done:${userId}`;
      const first = await redis.set(guard, '1', 'EX', 7 * 24 * 3600, 'NX');
      if (first === null) {
        logger.info({ jobId: job.id, userId }, 'welcome email already sent — skipping duplicate');
        return;
      }

      // …actually send the email here (provider integration is a later phase)…
      logger.info({ jobId: job.id, email }, 'sent welcome email (stub)');
    },
    { connection: createQueueConnection(), concurrency: 5 },
  );

  worker.on('failed', (job, err) =>
    logger.error({ jobId: job?.id, attemptsMade: job?.attemptsMade, err }, 'email job failed'),
  );
  worker.on('completed', (job) => logger.debug({ jobId: job.id }, 'email job completed'));

  return worker;
}
