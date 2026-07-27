import { logger } from './lib/logger';
import { redis } from './lib/redis';
import { startEmailWorker } from './queues/email.worker';
import { startEventsWorker } from './queues/events.worker';
import { startOutboxRelay } from './events/relay';

/**
 * The worker process entrypoint (`pnpm worker`). Runs separately from the API
 * so background jobs scale independently and never share the request event loop.
 *
 * As of Phase 7 this process also runs the outbox relay (Task 7.3) — polling
 * `OutboxEvent` and publishing to the "events" queue — and the events
 * subscriber worker (Task 7.4). Both are safe to run on multiple worker
 * replicas: the relay uses `FOR UPDATE SKIP LOCKED` so replicas never
 * double-claim a row, and the subscriber is idempotent per event id.
 */
const workers = [startEmailWorker(), startEventsWorker()];
const outboxRelay = startOutboxRelay();
logger.info({ workers: workers.map((w) => w.name) }, 'worker process started');

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'worker shutting down — draining active jobs');
  await outboxRelay.stop(); // let an in-flight relay tick finish before we stop publishing
  await Promise.all(workers.map((w) => w.close())); // waits for in-flight jobs to finish
  await redis.quit();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
