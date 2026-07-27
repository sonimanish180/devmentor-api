import type { Redis } from 'ioredis';

/**
 * Runs `fn` at most once per `key`, guarded by a Redis `SET NX` marker.
 *
 * Same trick as Task 6.3's welcome-email guard, pulled out and generalized:
 * BullMQ (like any real queue) gives AT-LEAST-ONCE delivery, so any job
 * handler with a real side effect — an XP increment, a sent email, a
 * charge — needs a guard like this to stay correct under retries, worker
 * crashes mid-job, or a manual DLQ replay.
 */
export async function withEventGuard(
  redis: Redis,
  key: string,
  ttlSeconds: number,
  fn: () => Promise<void>,
): Promise<'ran' | 'skipped-duplicate'> {
  const acquired = await redis.set(key, '1', 'EX', ttlSeconds, 'NX');
  if (acquired === null) return 'skipped-duplicate';
  await fn();
  return 'ran';
}
