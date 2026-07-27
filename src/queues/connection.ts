import { Redis } from 'ioredis';
import { env } from '../config/env';

/**
 * BullMQ needs its own Redis connection(s) configured with
 * `maxRetriesPerRequest: null` (workers issue long-blocking commands). We give
 * the queue and each worker a dedicated connection via this factory rather than
 * sharing the app's cache client.
 */
export function createQueueConnection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}
