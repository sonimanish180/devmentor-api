import { Worker } from 'bullmq';
import { createQueueConnection } from './connection';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { withEventGuard } from '../lib/eventGuard';
import type { DomainEventJob } from './events.queue';
import type { LessonCompletedPayload } from '../events/contracts';

// Long enough to outlive any realistic retry/backoff window or DLQ replay.
const XP_GUARD_TTL_SECONDS = 30 * 24 * 3600;

/**
 * The first subscriber: awards XP when a `LessonCompleted` event arrives.
 * This is the piece that moved OUT of `completeLesson`'s transaction in
 * Task 7.2 — decoupled from the write path, running here instead.
 *
 * Idempotency key is the OUTBOX EVENT's id (not the lesson or user id): the
 * relay's `jobId: event:<id>` already de-dupes most double-publishes, but a
 * manual retry, a DLQ replay, or a future second subscriber reusing this
 * queue could still redeliver the same event. Guarding on `eventId` makes
 * "award this lesson's XP" safe to run more than once — the same shape of
 * fix as Task 6.3, just keyed by event instead of business id.
 */
async function handleLessonCompleted(eventId: string, payload: LessonCompletedPayload): Promise<void> {
  const result = await withEventGuard(redis, `event:xp-awarded:${eventId}`, XP_GUARD_TTL_SECONDS, async () => {
    await prisma.userStats.update({
      where: { userId: payload.userId },
      data: { totalXP: { increment: payload.xp } }, // still an atomic increment, not read-modify-write
    });
  });

  if (result === 'skipped-duplicate') {
    logger.info({ eventId }, 'LessonCompleted: XP already awarded for this event — skipping duplicate');
  } else {
    logger.info({ eventId, userId: payload.userId, xp: payload.xp }, 'awarded XP for LessonCompleted');
  }
}

export function startEventsWorker(): Worker<DomainEventJob> {
  const worker = new Worker<DomainEventJob>(
    'events',
    async (job) => {
      switch (job.data.type) {
        case 'LessonCompleted':
          await handleLessonCompleted(job.data.eventId, job.data.payload as LessonCompletedPayload);
          break;
        default:
          logger.warn(
            { type: job.data.type, eventId: job.data.eventId },
            'events worker: no subscriber registered for this event type',
          );
      }
    },
    { connection: createQueueConnection(), concurrency: 5 },
  );

  worker.on('failed', (job, err) =>
    logger.error({ jobId: job?.id, attemptsMade: job?.attemptsMade, err }, 'event job failed'),
  );
  worker.on('completed', (job) => logger.debug({ jobId: job.id }, 'event job completed'));

  return worker;
}
