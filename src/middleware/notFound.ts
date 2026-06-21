import type { RequestHandler } from 'express';
import { AppError } from '../lib/AppError';

/**
 * Runs after all routes: any unmatched path becomes a 404 AppError, so it flows
 * through the same error envelope as every other error (one consistent shape).
 */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(AppError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
};
