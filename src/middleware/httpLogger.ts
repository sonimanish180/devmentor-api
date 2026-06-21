import { randomUUID } from 'node:crypto';
import { pinoHttp } from 'pino-http';
import { logger } from '../lib/logger';

/**
 * Request logging + correlation IDs.
 *
 * Every request gets a stable id (reused from an incoming `x-request-id` if a
 * gateway/proxy already set one, otherwise generated). The id is:
 *   - echoed back on the response header `x-request-id`, and
 *   - attached as `req.id` and bound to `req.log`,
 * so every log line for a request shares the same id — the thread you pull to
 * trace one request end-to-end across the system.
 */
export const httpLogger = pinoHttp({
  logger,
  genReqId(req, res) {
    const incoming = req.headers['x-request-id'];
    const id = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
    res.setHeader('x-request-id', id);
    return id;
  },
  // Map status codes to sensible log levels.
  customLogLevel(_req, res, err) {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
});
