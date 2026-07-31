import { startConsumer, type KafkaConsumerHandle } from '../consumer';
import { parseEnvelope } from '../envelope';
import { DOMAIN_EVENTS_TOPIC } from '../topics';
import { redis } from '../../lib/redis';
import { withEventGuard } from '../../lib/eventGuard';
import { logger } from '../../lib/logger';

const GROUP_ID = 'search-index-consumer';
const GUARD_TTL_SECONDS = 30 * 24 * 3600;

/**
 * A SCAFFOLD ahead of Phase 11's real search feature — it subscribes in its
 * own consumer group (so it never competes with the analytics consumer for
 * messages, even though both read the exact same topic) and logs what it
 * would index. Phase 11 replaces the log line with real writes to a search
 * index; the wiring — its own group, its own idempotency, reading the same
 * stream as every other consumer — doesn't change.
 */
export function startSearchIndexConsumer(): Promise<KafkaConsumerHandle> {
  return startConsumer(GROUP_ID, [DOMAIN_EVENTS_TOPIC], async ({ message }) => {
    const envelope = parseEnvelope(message.value);
    if (!envelope) {
      logger.warn('search-index consumer: dropped a malformed or unrecognized message');
      return;
    }

    const result = await withEventGuard(redis, `kafka:${GROUP_ID}:${envelope.eventId}`, GUARD_TTL_SECONDS, async () => {
      logger.info({ eventId: envelope.eventId, type: envelope.type }, 'search-index: would update search index (stub — Phase 11)');
    });

    if (result === 'skipped-duplicate') {
      logger.info({ eventId: envelope.eventId }, 'search-index: already processed this event — skipping duplicate');
    }
  });
}
