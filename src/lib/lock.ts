import { randomUUID } from 'node:crypto';
import { redis } from './redis';
import { AppError } from './AppError';

/**
 * A best-effort distributed lock on Redis, for cross-request critical sections
 * that must run once at a time (e.g. "only one active quiz attempt per user").
 *
 * Acquire with `SET key token NX PX ttl` (atomic: set-if-absent with expiry).
 * The random token means release only deletes OUR lock — via a small Lua script
 * that compares-then-deletes atomically, so we never free a lock that already
 * expired and was re-acquired by someone else. The PX expiry is a safety net so
 * a crashed holder can't deadlock the key forever.
 *
 * This is a single-instance lock (good enough here). True multi-node safety is
 * the full Redlock algorithm across independent Redis nodes.
 */
const RELEASE_IF_OWNER = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

export async function withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const lockKey = `lock:${key}`;
  const token = randomUUID();

  const acquired = await redis.set(lockKey, token, 'PX', ttlMs, 'NX');
  if (!acquired) {
    throw AppError.conflict('Resource is busy, please retry');
  }

  try {
    return await fn();
  } finally {
    // Release only if we still own the lock (best effort).
    try {
      await redis.eval(RELEASE_IF_OWNER, 1, lockKey, token);
    } catch {
      /* lock will expire via TTL */
    }
  }
}
