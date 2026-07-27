import type { RequestHandler } from 'express';

/**
 * Set a Cache-Control header for client/CDN caching of public GET responses.
 * Complements the server-side Redis cache: Redis saves the DB from repeated
 * work; Cache-Control lets browsers/CDNs skip the round-trip entirely.
 *
 * Express already emits a (weak) ETag for JSON bodies and answers a matching
 * If-None-Match with 304 Not Modified, so conditional requests work for free.
 */
export const cacheControl = (seconds: number): RequestHandler => (_req, res, next) => {
  res.set('Cache-Control', `public, max-age=${seconds}`);
  next();
};
