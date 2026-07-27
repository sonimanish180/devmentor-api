import type { RequestHandler, Response } from 'express';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';

const TTL_SECONDS = 24 * 60 * 60; // remember a result for 24h

/**
 * Idempotency-Key support for state-changing POSTs.
 *
 * A client sends `Idempotency-Key: <uuid>`; if the same key is replayed (a
 * retry after a flaky network, a double-click), we return the ORIGINAL stored
 * response instead of executing the operation twice. Scoped per-user so keys
 * can't collide across accounts. Only successful (2xx) responses are stored.
 *
 * (Concurrency note: for two truly-simultaneous requests the data layer's
 * idempotent writes — unique constraints / upserts — are the real guard; this
 * middleware handles the common sequential-retry case.)
 */
export const idempotency: RequestHandler = (req, res, next) => {
  const key = req.header('Idempotency-Key');
  if (!key) return next(); // opt-in — no key, no dedupe

  const scope = req.auth?.userId ?? req.ip ?? 'anon';
  const storeKey = `idem:${scope}:${req.method}:${req.baseUrl}${req.path}:${key}`;

  redis
    .get(storeKey)
    .then((cached) => {
      if (cached) {
        const { status, body } = JSON.parse(cached) as { status: number; body: unknown };
        res.setHeader('Idempotent-Replay', 'true');
        res.status(status).json(body);
        return;
      }

      // Capture the response so a future replay can return it verbatim.
      const originalJson = res.json.bind(res);
      res.json = ((body: unknown) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          redis
            .set(storeKey, JSON.stringify({ status: res.statusCode, body }), 'EX', TTL_SECONDS, 'NX')
            .catch((err) => logger.error({ err }, 'idempotency store failed'));
        }
        return originalJson(body);
      }) as Response['json'];

      next();
    })
    .catch(next);
};
