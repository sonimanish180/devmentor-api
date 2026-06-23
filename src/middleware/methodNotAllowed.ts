import type { RequestHandler } from 'express';
import { AppError } from '../lib/AppError';

/**
 * 405 handler for a known path hit with an unsupported method. Mounted with
 * `router.all(path, ...)` AFTER the real method handlers, so a defined resource
 * answers POST/DELETE/etc. with a precise 405 (+ the standard `Allow` header)
 * instead of a misleading 404. Truly unknown paths still fall through to 404.
 */
export function methodNotAllowed(allowed: string[]): RequestHandler {
  return (_req, res, next) => {
    res.set('Allow', allowed.join(', '));
    next(
      new AppError(`Method not allowed. Allowed: ${allowed.join(', ')}`, {
        statusCode: 405,
        code: 'METHOD_NOT_ALLOWED',
      }),
    );
  };
}
