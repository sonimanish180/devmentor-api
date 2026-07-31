import { Kafka, logLevel, type Producer } from 'kafkajs';
import { env, isProduction } from '../config/env';
import { onShutdown } from '../lib/shutdown';

/**
 * One Kafka client (cached like Prisma/Redis so `tsx watch` hot-reload
 * doesn't accumulate clients). Unlike Postgres/Redis, a single KafkaJS client
 * isn't "one connection" — it multiplexes connections per-broker internally
 * — so sharing it is about not repeating broker config and metadata fetches,
 * not about a scarce connection pool.
 */
const globalForKafka = globalThis as unknown as { kafka?: Kafka };

export const kafka =
  globalForKafka.kafka ??
  new Kafka({
    clientId: 'devmentor-api',
    brokers: env.KAFKA_BROKERS.split(',').map((b) => b.trim()),
    logLevel: logLevel.NOTHING, // kafkajs is chatty by default — we log what matters ourselves
  });

if (!isProduction) globalForKafka.kafka = kafka;

/**
 * Topics are provisioned explicitly, not auto-created on first publish —
 * auto-creation makes it easy for a typo'd topic name to silently spawn a
 * useless topic instead of failing loudly. Safe to call on every boot:
 * `createTopics` is a no-op for topics that already exist.
 */
export async function ensureTopics(topics: { name: string; numPartitions: number }[]): Promise<void> {
  const admin = kafka.admin();
  await admin.connect();
  try {
    await admin.createTopics({
      topics: topics.map((t) => ({ topic: t.name, numPartitions: t.numPartitions })),
    });
  } finally {
    await admin.disconnect();
  }
}

let sharedProducer: Producer | undefined;
let connecting: Promise<void> | undefined;

/**
 * A single, long-lived producer connection — kafkajs recommends reusing one
 * rather than connecting/disconnecting per call. `idempotent: true` dedupes
 * broker-side retries WITHIN this one producer session (a network blip
 * causing kafkajs to retry a send) — it does NOT protect against the relay
 * process restarting and re-publishing an event it already sent before a
 * crash; that's a fresh producer session, outside the idempotent producer's
 * window. Consumers still must be idempotent by event id (Task 10.4).
 */
export async function getProducer(): Promise<Producer> {
  if (!sharedProducer) {
    sharedProducer = kafka.producer({ allowAutoTopicCreation: false, idempotent: true });
    onShutdown('kafkaProducer', () => sharedProducer?.disconnect());
  }
  connecting ??= sharedProducer.connect();
  await connecting;
  return sharedProducer;
}
