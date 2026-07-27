import { redis } from './redis';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Per-process single-flight map: if many concurrent requests on THIS instance
 * miss the same key, only one runs the loader; the rest await its promise.
 */
const inflight = new Map<string, Promise<unknown>>();

/**
 * Cache-aside: read cache → on miss, load from source, write cache, return.
 *
 * Stampede protection is two-layered:
 *  1. in-process single-flight (above) collapses concurrent misses per instance;
 *  2. a short Redis lock (SET NX PX) so only ONE instance across the cluster
 *     rebuilds a hot key; the others briefly wait and re-read.
 *
 * A loader that throws (e.g. AppError.notFound) is NOT cached — errors propagate.
 */
export async function cacheAside<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
  const cached = await redis.get(key);
  if (cached !== null) return JSON.parse(cached) as T;

  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = load<T>(key, ttlSeconds, loader).finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

async function load<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
  const lockKey = `${key}:lock`;
  const gotLock = await redis.set(lockKey, '1', 'PX', 5000, 'NX');

  if (!gotLock) {
    // Another instance is rebuilding; give it a moment, then try the cache again.
    await sleep(100);
    const again = await redis.get(key);
    if (again !== null) return JSON.parse(again) as T;
    // else fall through and load anyway (the lock holder may have failed).
  }

  try {
    const value = await loader();
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    return value;
  } finally {
    if (gotLock) await redis.del(lockKey);
  }
}

/** Delete specific cache keys. */
export async function invalidate(...keys: string[]): Promise<void> {
  if (keys.length) await redis.del(...keys);
}

/**
 * Delete every key under a prefix using SCAN (non-blocking, cursor-based) —
 * never use KEYS in production, it blocks the server on large keyspaces.
 */
export async function invalidateByPrefix(prefix: string): Promise<void> {
  const stream = redis.scanStream({ match: `${prefix}*`, count: 100 });
  const found: string[] = [];
  for await (const batch of stream) {
    for (const key of batch as string[]) found.push(key);
  }
  if (found.length) await redis.del(...found);
}
