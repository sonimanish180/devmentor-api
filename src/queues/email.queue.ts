import { Queue } from 'bullmq';
import { createQueueConnection } from './connection';

export interface WelcomeEmailJob {
  type: 'welcome';
  userId: string;
  email: string;
}

/**
 * The "email" queue. Producers (the API) add jobs; a separate worker process
 * consumes them, so slow/external work (sending mail) never blocks the request.
 *
 * Default job options:
 *  - attempts + exponential backoff: transient failures retry automatically.
 *  - removeOnComplete: don't let succeeded jobs pile up.
 *  - removeOnFail (keep many): exhausted-retry jobs stay in the "failed" set for
 *    inspection/replay — BullMQ's equivalent of a dead-letter queue.
 */
export const emailQueue = new Queue<WelcomeEmailJob>('email', {
  connection: createQueueConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

/** Enqueue a welcome email. jobId = business key so re-enqueues dedupe. */
export function enqueueWelcomeEmail(data: WelcomeEmailJob) {
  return emailQueue.add('welcome', data, { jobId: `welcome:${data.userId}` });
}
