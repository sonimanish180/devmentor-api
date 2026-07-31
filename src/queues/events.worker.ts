import { Worker } from 'bullmq';
import { createQueueConnection } from './connection';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { withEventGuard } from '../lib/eventGuard';
import { notify } from '../notifications';
import { recordScore } from '../quiz/leaderboard';
import { runWithLinkedTrace } from '../observability/context';
import type { DomainEventJob } from './events.queue';
import type { LessonCompletedPayload, QuizSubmittedPayload } from '../events/contracts';

// Long enough to outlive any realistic retry/backoff window or DLQ replay.
const GUARD_TTL_SECONDS = 30 * 24 * 3600;

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
  const result = await withEventGuard(redis, `event:xp-awarded:${eventId}`, GUARD_TTL_SECONDS, async () => {
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

/**
 * The SECOND subscriber to the exact same `LessonCompleted` event (Task 8.2) —
 * added without touching `completeLesson`, the relay, or the first
 * subscriber at all. That's the payoff of Phase 7's outbox: reacting to a
 * domain event in a new way is purely additive. Guarded the same shape as
 * `handleLessonCompleted`, but on its own key — a redelivery that's already
 * skipped for XP purposes must still be evaluated for notification purposes
 * (and vice versa), since the two guards protect two independent side effects.
 */
async function notifyLessonCompleted(eventId: string, payload: LessonCompletedPayload): Promise<void> {
  const result = await withEventGuard(redis, `event:notified:${eventId}`, GUARD_TTL_SECONDS, async () => {
    await notify({
      userId: payload.userId,
      type: 'LessonCompleted',
      title: 'Lesson complete! 🎉',
      body: `You earned ${payload.xp} XP.`,
      data: { lessonId: payload.lessonId, xp: payload.xp },
    });
  });

  if (result === 'skipped-duplicate') {
    logger.info({ eventId }, 'LessonCompleted: notification already sent for this event — skipping duplicate');
  }
}

/**
 * Update the contest leaderboard for a `QuizSubmitted` event (Task 9.5).
 * Deliberately NOT guarded by an event-id marker like the other subscribers
 * in this file: `recordScore` uses `ZADD ... GT`, which is naturally
 * idempotent — redelivering the same event just re-asserts "at least this
 * score," a no-op if it's already recorded. Contrast with
 * `notifyQuizSubmitted` below, where re-running the side effect WOULD create
 * a duplicate row — match the idempotency strategy to whether the operation
 * is naturally idempotent, don't reach for a guard reflexively.
 */
async function updateLeaderboardOnQuizSubmitted(payload: QuizSubmittedPayload): Promise<void> {
  if (!payload.contestMode) return; // opt-in per quiz — most quizzes never touch the leaderboard
  await recordScore(payload.quizId, payload.userId, payload.score);
}

async function notifyQuizSubmitted(eventId: string, payload: QuizSubmittedPayload): Promise<void> {
  const result = await withEventGuard(redis, `event:notified:${eventId}`, GUARD_TTL_SECONDS, async () => {
    await notify({
      userId: payload.userId,
      type: 'QuizSubmitted',
      title: 'Quiz submitted!',
      body: `You scored ${payload.score} point${payload.score === 1 ? '' : 's'}.`,
      data: { quizId: payload.quizId, attemptId: payload.attemptId, score: payload.score },
    });
  });

  if (result === 'skipped-duplicate') {
    logger.info({ eventId }, 'QuizSubmitted: notification already sent for this event — skipping duplicate');
  }
}

export function startEventsWorker(): Worker<DomainEventJob> {
  const worker = new Worker<DomainEventJob>(
    'events',
    async (job) => {
      switch (job.data.type) {
        case 'LessonCompleted': {
          const payload = job.data.payload as LessonCompletedPayload;
          // Two independent subscribers react to the one event; neither knows
          // the other exists, and adding a third is one more branch here.
          //
          // Only the XP subscriber is wrapped in `runWithLinkedTrace` here —
          // a deliberately scoped first example of the pattern (Task 12.1),
          // not yet applied to every subscriber in this file. Extending it to
          // `notifyLessonCompleted`/`notifyQuizSubmitted` is the same one-line
          // wrap, left as a natural follow-up rather than done reflexively
          // everywhere in one pass.
          await Promise.all([
            runWithLinkedTrace('events-worker', 'handleLessonCompleted', job.data.traceCarrier, () =>
              handleLessonCompleted(job.data.eventId, payload),
            ),
            notifyLessonCompleted(job.data.eventId, payload),
          ]);
          break;
        }
        case 'QuizSubmitted': {
          const payload = job.data.payload as QuizSubmittedPayload;
          await Promise.all([
            updateLeaderboardOnQuizSubmitted(payload),
            notifyQuizSubmitted(job.data.eventId, payload),
          ]);
          break;
        }
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
