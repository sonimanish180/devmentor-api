import { logger } from './lib/logger';
import { redis } from './lib/redis';
import { startEmailWorker } from './queues/email.worker';
import { startEventsWorker } from './queues/events.worker';
import { startOutboxRelay } from './events/relay';
import { startQuizSweeper } from './quiz/sweeper';
import { ensureTopics } from './kafka/client';
import { startKafkaRelay } from './events/kafkaRelay';
import { startAnalyticsConsumer } from './kafka/consumers/analyticsConsumer';
import { startSearchIndexConsumer } from './kafka/consumers/searchIndexConsumer';
import { DOMAIN_EVENTS_TOPIC, DOMAIN_EVENTS_PARTITIONS } from './kafka/topics';

/**
 * The worker process entrypoint (`pnpm worker`). Runs separately from the API
 * so background jobs scale independently and never share the request event loop.
 *
 * As of Phase 7 this process also runs the outbox relay (Task 7.3) — polling
 * `OutboxEvent` and publishing to the "events" queue — and the events
 * subscriber worker (Task 7.4). Both are safe to run on multiple worker
 * replicas: the relay uses `FOR UPDATE SKIP LOCKED` so replicas never
 * double-claim a row, and the subscriber is idempotent per event id.
 *
 * Phase 9 adds the quiz sweeper (Task 9.4) — a third independent poll loop,
 * same shape as the relay, reconciling abandoned quiz attempts.
 *
 * Phase 10 adds a SECOND, independent relay to Kafka (Task 10.2) and two
 * Kafka consumer groups (Task 10.3) reading the same `domain-events` topic
 * as full, independent copies of the stream — neither competes with the
 * BullMQ `events` queue's subscribers, nor with each other. Provisioning the
 * topic needs an `await`, so this file is now an async `main()` rather than
 * top-level synchronous starts.
 */
async function main(): Promise<void> {
  const workers = [startEmailWorker(), startEventsWorker()];
  const outboxRelay = startOutboxRelay();
  const quizSweeper = startQuizSweeper();

  await ensureTopics([{ name: DOMAIN_EVENTS_TOPIC, numPartitions: DOMAIN_EVENTS_PARTITIONS }]);
  const kafkaRelay = startKafkaRelay();
  const kafkaConsumers = await Promise.all([startAnalyticsConsumer(), startSearchIndexConsumer()]);

  logger.info({ workers: workers.map((w) => w.name) }, 'worker process started');

  let shuttingDown = false;
  async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'worker shutting down — draining active jobs');
    await outboxRelay.stop(); // let an in-flight relay tick finish before we stop publishing
    await kafkaRelay.stop();
    await quizSweeper.stop();
    await Promise.all(workers.map((w) => w.close())); // waits for in-flight jobs to finish
    await Promise.all(kafkaConsumers.map((c) => c.stop()));
    await redis.quit();
    process.exit(0);
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'worker process failed to start');
  process.exit(1);
});
