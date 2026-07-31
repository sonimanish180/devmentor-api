import { Registry, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';
import type { Queue } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';

/**
 * The Prometheus metrics registry (Task 12.2) — the second of the three
 * observability pillars alongside logs (Task 0.3) and traces (Task 12.1).
 * Traces answer "what happened to *this one* request?"; metrics answer "how
 * is the system doing *in aggregate*, right now and over time?" — the thing
 * you actually want an alert to fire on, since you can't alert on individual
 * traces without drowning in noise.
 *
 * A dedicated `Registry` (not the default global one) so tests and multiple
 * modules can't accidentally register the same metric name twice and crash
 * `prom-client` with a "metric already registered" error.
 */
export const registry = new Registry();

// Node/process-level metrics prom-client already knows how to collect for
// free: event loop lag, GC pauses, heap/RSS, open handles, CPU time. These
// are the USE (Utilization/Saturation/Errors) signals for the process
// itself — event loop lag in particular is often the earliest warning that
// a single Node process is falling behind, well before request latency
// visibly degrades.
collectDefaultMetrics({ register: registry });

/**
 * RED metrics (Rate, Errors, Duration) for the HTTP layer — the standard
 * shape for anything that serves requests. Rate + Errors both fall out of
 * one Counter sliced by `status`; Duration is a Histogram so Prometheus can
 * compute percentiles (p50/p95/p99) server-side via `histogram_quantile`,
 * which a single averaged number could never show (an average hides a slow
 * tail completely).
 */
export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests handled, labeled by method, route template, and status code.',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [registry],
});

export const httpRequestDurationSeconds = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds, labeled by method, route template, and status code.',
  labelNames: ['method', 'route', 'status'] as const,
  // Buckets biased toward typical API latency (5ms-10s) rather than
  // prom-client's generic defaults, so percentile queries stay accurate.
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

/**
 * A request-scoped Saturation signal: how many requests are in flight right
 * now, per method. Unlike the Counter/Histogram above, this can go DOWN —
 * a Gauge is the right primitive whenever a value isn't monotonic.
 */
export const httpRequestsInProgress = new Gauge({
  name: 'http_requests_in_progress',
  help: 'HTTP requests currently being handled, labeled by method.',
  labelNames: ['method'] as const,
  registers: [registry],
});

/**
 * USE (Utilization/Saturation/Errors) for the worker/queue layer — how many
 * jobs are backed up in BullMQ, by queue and by state. There is no "event"
 * to increment this on; queue depth is a property of the system's current
 * state, not a rate, so it's POLLED on an interval rather than pushed
 * (Task 12.2's example of when a Gauge must be set from a poll loop instead
 * of incremented/observed inline in request-handling code).
 */
export const queueDepth = new Gauge({
  name: 'queue_depth',
  help: 'BullMQ job count per queue and state (waiting/active/delayed/failed) — a saturation signal for the worker layer.',
  labelNames: ['queue', 'state'] as const,
  registers: [registry],
});

/**
 * Starts a poll loop that samples `getJobCounts()` for each given queue and
 * writes the result into the `queue_depth` gauge. Safe to call from any
 * process holding a `Queue` instance (it's a thin Redis client — instantiating
 * one to only ever READ counts, never `.add()`, is a normal, cheap use of it).
 *
 * A GROWING `waiting` count over time is the queue-layer equivalent of rising
 * event loop lag: consumers aren't keeping up, and it's the earliest signal
 * you'd want an alert on — well before users notice anything (Task 12.3).
 */
export function startQueueDepthPoller(queues: Record<string, Queue>, intervalMs = 5000): { stop: () => void } {
  const tick = async () => {
    for (const [name, queue] of Object.entries(queues)) {
      try {
        const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
        for (const [state, count] of Object.entries(counts)) {
          queueDepth.set({ queue: name, state }, count);
        }
      } catch (err) {
        logger.warn({ err, queue: name }, 'queue depth poll failed — skipping this tick');
      }
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref(); // never keep the process alive just for this
  void tick(); // populate immediately instead of waiting for the first interval

  return { stop: () => clearInterval(timer) };
}

/**
 * A FRESHNESS signal (Task 12.3) — a category alongside RED/USE that matters
 * specifically for async, event-driven paths: not "how fast did the request
 * answer" but "how stale is the oldest thing still waiting to be processed."
 * Sampled per outbox SINK, because Phase 10 gave `OutboxEvent` two
 * independent dispatch cursors (`dispatchedAt` for BullMQ, `kafkaDispatchedAt`
 * for Kafka) — one sink lagging (e.g. Kafka down) must be visible without
 * being averaged away by the other sink still keeping up.
 */
export const outboxOldestPendingAgeSeconds = new Gauge({
  name: 'outbox_oldest_pending_age_seconds',
  help: 'Age in seconds of the oldest not-yet-dispatched OutboxEvent row, labeled by sink (bullmq/kafka).',
  labelNames: ['sink'] as const,
  registers: [registry],
});

/**
 * Polls Postgres directly for the oldest pending row per sink. Runs from the
 * API process, which already holds a Prisma client (Task 1.1) — same
 * rationale as `startQueueDepthPoller`: reading state doesn't require
 * running the poll loop in the process that acts on it.
 */
export function startOutboxLagPoller(prisma: PrismaClient, intervalMs = 5000): { stop: () => void } {
  const tick = async () => {
    try {
      const [bullmqOldest, kafkaOldest] = await Promise.all([
        prisma.$queryRaw<{ createdAt: Date }[]>`
          SELECT "createdAt" FROM "OutboxEvent" WHERE "dispatchedAt" IS NULL ORDER BY "createdAt" ASC LIMIT 1
        `,
        prisma.$queryRaw<{ createdAt: Date }[]>`
          SELECT "createdAt" FROM "OutboxEvent" WHERE "kafkaDispatchedAt" IS NULL ORDER BY "createdAt" ASC LIMIT 1
        `,
      ]);
      const ageSeconds = (rows: { createdAt: Date }[]) =>
        rows[0] ? (Date.now() - new Date(rows[0].createdAt).getTime()) / 1000 : 0;
      outboxOldestPendingAgeSeconds.set({ sink: 'bullmq' }, ageSeconds(bullmqOldest));
      outboxOldestPendingAgeSeconds.set({ sink: 'kafka' }, ageSeconds(kafkaOldest));
    } catch (err) {
      logger.warn({ err }, 'outbox lag poll failed — skipping this tick');
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  void tick();

  return { stop: () => clearInterval(timer) };
}
