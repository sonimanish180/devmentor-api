import Redis from 'ioredis';
import { env, isProduction } from '../config/env';
import { registerReadinessCheck } from '../modules/health/readiness';
import { onShutdown } from './shutdown';
import { logger } from './logger';

/**
 * Shared Redis client (one connection, cached on globalThis in dev so tsx
 * hot-reload doesn't leak connections — same reasoning as the Prisma client).
 * Used for caching now; distributed locks, pub/sub, and queues in later phases.
 */
const globalForRedis = globalThis as unknown as { redis?: Redis };

export const redis =
  globalForRedis.redis ?? new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });

if (!isProduction) globalForRedis.redis = redis;

redis.on('error', (err) => logger.error({ err }, 'Redis connection error'));

export function registerRedisHooks(): void {
  registerReadinessCheck({
    name: 'redis',
    check: async () => {
      await redis.ping();
    },
  });
  onShutdown('redis', async () => {
    await redis.quit();
  });
}
