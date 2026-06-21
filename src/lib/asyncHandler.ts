import type { RequestHandler } from 'express';

/**
 * Express 4 does not catch errors thrown in async handlers — a rejected promise
 * would otherwise hang the request. Wrap async route handlers with this so any
 * rejection is forwarded to the centralized error handler via `next(err)`.
 *
 *   router.get('/x', asyncHandler(async (req, res) => { ... }))
 */
export const asyncHandler =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
