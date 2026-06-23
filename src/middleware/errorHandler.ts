import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/AppError';
import { logger } from '../lib/logger';
import { isProduction } from '../config/env';

/**
 * The single place every error becomes an HTTP response. It renders one
 * consistent envelope:
 *   { error: { code, message, details?, requestId } }
 *
 * - AppError       → its statusCode/code/message/details.
 * - ZodError       → 400 VALIDATION_ERROR with the field issues.
 * - anything else  → 500 INTERNAL_ERROR; the real message is hidden in prod
 *                    (it could leak internals) but always logged in full.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  // If the response already started streaming, defer to Express' default handler.
  if (res.headersSent) return next(err);

  let statusCode = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong';
  let details: unknown;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof ZodError) {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = 'Invalid request';
    details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  } else if (err instanceof SyntaxError && 'body' in err) {
    // Thrown by express.json() on a malformed request body.
    statusCode = 400;
    code = 'INVALID_JSON';
    message = 'Malformed JSON in request body';
  } else if (err instanceof Error && !isProduction) {
    // Surface real messages in dev/test to speed debugging; hide them in prod.
    message = err.message;
  }

  const log = req.log ?? logger;
  if (statusCode >= 500) {
    log.error({ err }, 'Unhandled error while processing request');
  } else {
    log.warn({ code, statusCode }, message);
  }

  res.status(statusCode).json({
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      requestId: req.id,
    },
  });
};
