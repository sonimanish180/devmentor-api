import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { getProducer } from '../kafka/client';
import { DOMAIN_EVENTS_TOPIC } from '../kafka/topics';

const BATCH_SIZE = 20;
const POLL_INTERVAL_MS = 1000;

interface OutboxRow {
  id: string;
  type: string;
  payload: unknown;
}

/**
 * Per-user ordering is the default partition key: all of one user's events
 * land in the same partition, so any single consumer sees them in the order
 * they occurred. A consumer that instead needed strict per-entity ordering
 * (e.g. every `QuizSubmitted` for one quiz, across all users, in order)
 * would need a different key or its own topic — a real trade-off to make
 * deliberately, not a limitation to work around silently.
 */
function partitionKeyFor(payload: unknown): string {
  const userId = (payload as { userId?: unknown } | null)?.userId;
  return typeof userId === 'string' ? userId : 'unkeyed';
}

/**
 * The Kafka twin of the BullMQ outbox relay (Task 7.3): same
 * `FOR UPDATE SKIP LOCKED` shape, same at-least-once-plus-idempotent-
 * consumers philosophy — but polling its OWN cursor (`kafkaDispatchedAt`) on
 * the SAME `OutboxEvent` table the BullMQ relay also reads. Neither relay
 * knows the other exists; each independently guarantees its destination
 * eventually gets every event, at its own pace.
 */
async function relayBatch(): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<OutboxRow[]>`
      SELECT id, type, payload
      FROM "OutboxEvent"
      WHERE "kafkaDispatchedAt" IS NULL
      ORDER BY "createdAt" ASC
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    `;
    if (rows.length === 0) return 0;

    const producer = await getProducer();
    // One batched send for the whole page — fewer round-trips than one
    // send() per row, and kafkajs's idempotent producer still covers
    // broker-side retries of this one call.
    await producer.send({
      topic: DOMAIN_EVENTS_TOPIC,
      messages: rows.map((row) => ({
        key: partitionKeyFor(row.payload),
        value: JSON.stringify({ eventId: row.id, type: row.type, version: 1, payload: row.payload }),
      })),
    });

    await tx.outboxEvent.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { kafkaDispatchedAt: new Date() },
    });

    return rows.length;
  });
}

export interface KafkaRelay {
  stop: () => Promise<void>;
}

/** Same poll-loop shape as `startOutboxRelay` (Task 7.3) — an independent instance of the same idea. */
export function startKafkaRelay(): KafkaRelay {
  let stopped = false;
  let inFlight: Promise<void> | undefined;
  let timer: NodeJS.Timeout | undefined;

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      const count = await relayBatch();
      if (count > 0) logger.info({ count }, 'kafka relay: published events to domain-events');
    } catch (err) {
      logger.error({ err }, 'kafka relay: tick failed — will retry next interval');
    }
    if (!stopped) timer = setTimeout(() => void (inFlight = tick()), POLL_INTERVAL_MS);
  }

  void (inFlight = tick());

  return {
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      await inFlight;
    },
  };
}
