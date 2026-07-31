import { pino } from 'pino';
import { trace } from '@opentelemetry/api';
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
  // Ties logs to traces (Task 12.1): every log line written while a span is
  // active gets that span's traceId/spanId, so a log in Jaeger's search or a
  // log aggregator can be pivoted straight to its trace, and vice versa. A
  // `mixin` runs per log call — cheap, and returns nothing extra when no
  // span is active (a background script, a test), rather than logging empty fields.
  mixin() {
    const span = trace.getActiveSpan();
    if (!span) return {};
    const ctx = span.spanContext();
    return { traceId: ctx.traceId, spanId: ctx.spanId };
  },
});

export type Logger = typeof logger;
