import { pino } from 'pino';
import { env } from '../config/env';

/**
 * The application logger. We log structured JSON (not console.log) so logs are
 * machine-parseable and searchable once shipped to an aggregator. The level is
 * driven by config; secrets are redacted so they can never leak into logs.
 *
 * In dev you can pipe output through `pino-pretty` for readability:
 *   pnpm dev | npx pino-pretty
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.token',
    ],
    remove: true,
  },
  // Drop default pid/hostname noise in dev; a prod log pipeline can re-add host metadata.
  base: undefined,
});

export type Logger = typeof logger;
