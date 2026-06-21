interface AppErrorOptions {
  statusCode?: number;
  /** Stable, machine-readable error code, e.g. "NOT_FOUND". */
  code?: string;
  /** Optional structured detail (e.g. validation issues) sent to the client. */
  details?: unknown;
  /** Underlying cause, kept for logs (never sent to the client). */
  cause?: unknown;
}

/**
 * Operational errors we throw on purpose and know how to turn into an HTTP
 * response. The central error handler renders these into a consistent JSON
 * envelope; anything that is NOT an AppError is treated as an unexpected bug
 * and rendered as a generic 500 (its message is hidden in production).
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;
  /** Marks errors we anticipated (vs. programmer bugs / unknown failures). */
  readonly isOperational = true;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.statusCode = options.statusCode ?? 500;
    this.code = options.code ?? 'INTERNAL_ERROR';
    this.details = options.details;
    Error.captureStackTrace?.(this, AppError);
  }

  static badRequest(message = 'Bad request', details?: unknown) {
    return new AppError(message, { statusCode: 400, code: 'BAD_REQUEST', details });
  }
  static unauthorized(message = 'Unauthorized') {
    return new AppError(message, { statusCode: 401, code: 'UNAUTHORIZED' });
  }
  static forbidden(message = 'Forbidden') {
    return new AppError(message, { statusCode: 403, code: 'FORBIDDEN' });
  }
  static notFound(message = 'Resource not found') {
    return new AppError(message, { statusCode: 404, code: 'NOT_FOUND' });
  }
  static conflict(message = 'Conflict', details?: unknown) {
    return new AppError(message, { statusCode: 409, code: 'CONFLICT', details });
  }
  static tooManyRequests(message = 'Too many requests') {
    return new AppError(message, { statusCode: 429, code: 'RATE_LIMITED' });
  }
  static internal(message = 'Internal server error', cause?: unknown) {
    return new AppError(message, { statusCode: 500, code: 'INTERNAL_ERROR', cause });
  }
}
