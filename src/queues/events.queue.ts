import { Queue } from 'bullmq';
import { createQueueConnection } from './connection';

/** What actually rides in a BullMQ job for the "events" queue. */
export interface DomainEventJob {
  /** OutboxEvent.id — the idempotency key subscribers guard on (Task 7.4). */
  eventId: string;
  type: string;
  payload: unknown;
  /** Captured trace context (Task 12.1) — lets a subscriber link its processing to the originating request's trace. */
  traceCarrier?: Record<string, string> | null;
}

/**
 * The "events" queue — where the outbox relay (Task 7.3) publishes every
 * dispatched domain event. One shared queue, `jobId = event:<eventId>` so a
 * relay retry (e.g. after a crash between publish and marking the row
 * dispatched) can never enqueue the same event twice — BullMQ just returns
 * the existing job. Subscribers (Task 7.4) fan out on `job.data.type`.
 */
export const eventsQueue = new Queue<DomainEventJob>('events', {
  connection: createQueueConnection(),
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { count: 5000 }, // dead-letter set for inspection/replay
  },
});
