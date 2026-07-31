import { startConsumer, type KafkaConsumerHandle } from '../consumer';
import { parseEnvelope } from '../envelope';
import { DOMAIN_EVENTS_TOPIC } from '../topics';
import { redis } from '../../lib/redis';
import { withEventGuard } from '../../lib/eventGuard';
import { logger } from '../../lib/logger';

const GROUP_ID = 'analytics-consumer';
const GUARD_TTL_SECONDS = 30 * 24 * 3600;

/**
 * A stand-in for a real analytics pipeline (a warehouse load, an event
 * stream to a BI tool). It reads EVERY domain event — its whole reason to
 * exist on Kafka rather than the "events" BullMQ queue is that it's a
 * second, independent reader of the same stream the XP/notification
 * subscribers already consume from BullMQ, with no risk of competing with
 * them for messages (different transport, different consumer group).
 */
export function startAnalyticsConsumer(): Promise<KafkaConsumerHandle> {
  return startConsumer(GROUP_ID, [DOMAIN_EVENTS_TOPIC], async ({ message }) => {
    const envelope = parseEnvelope(message.value);
    if (!envelope) {
      logger.warn('analytics consumer: dropped a malformed or unrecognized message');
      return;
    }

    // Kafka gives NO producer-side dedupe across relay restarts (unlike
    // BullMQ's jobId) — this guard is load-bearing here, not optional.
    const result = await withEventGuard(redis, `kafka:${GROUP_ID}:${envelope.eventId}`, GUARD_TTL_SECONDS, async () => {
      logger.info({ eventId: envelope.eventId, type: envelope.type }, 'analytics: recorded event');
      // A real implementation would ship this to a warehouse/BI sink here.
    });

    if (result === 'skipped-duplicate') {
      logger.info({ eventId: envelope.eventId }, 'analytics: already recorded this event — skipping duplicate');
    }
  });
}
