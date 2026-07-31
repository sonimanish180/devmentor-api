import type { EachMessagePayload } from 'kafkajs';
import { kafka } from './client';
import { logger } from '../lib/logger';

export interface KafkaConsumerHandle {
  stop: () => Promise<void>;
}

/**
 * Start a consumer in its own consumer group. This is the crux of Kafka vs
 * BullMQ: TWO consumers in the SAME group split partitions between them
 * (competing — each message goes to exactly one of them, like BullMQ
 * workers). TWO consumers in DIFFERENT groups each get their OWN copy of
 * every message, independently, at their own pace. The analytics and
 * search-index consumers (Task 10.3) each use a unique `groupId` for exactly
 * that reason — neither should ever steal the other's messages.
 */
export async function startConsumer(
  groupId: string,
  topics: string[],
  onMessage: (payload: EachMessagePayload) => Promise<void>,
): Promise<KafkaConsumerHandle> {
  const consumer = kafka.consumer({ groupId });
  await consumer.connect();
  await consumer.subscribe({ topics, fromBeginning: false });

  await consumer.run({
    eachMessage: async (payload) => {
      try {
        await onMessage(payload);
      } catch (err) {
        logger.error(
          { err, groupId, topic: payload.topic, partition: payload.partition },
          'kafka consumer: handler threw — message will be retried, not silently dropped',
        );
        throw err; // rethrow: let kafkajs retry rather than advance the offset past a failed message
      }
    },
  });

  return {
    stop: async () => {
      await consumer.disconnect();
    },
  };
}
