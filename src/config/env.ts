import { z } from 'zod';

/**
 * 12-factor config: every tunable comes from the environment, is validated
 * once at boot, and is exposed as a typed, frozen object. If anything is
 * missing or malformed we fail fast with a clear message instead of crashing
 * later with a confusing runtime error.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // process.env values are always strings, so coerce + validate the range.
  PORT: z.coerce.number().int().positive().max(65535).default(4000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  // Postgres connection string (Phase 1). Required — the service is DB-backed.
  DATABASE_URL: z.string().url(),
  // Auth (Phase 3). Access tokens are signed JWTs; refresh tokens are opaque.
  JWT_ACCESS_SECRET: z.string().min(16),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900), // 15 min
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  // Allowed browser origin for CORS (the devmentor frontend).
  CORS_ORIGIN: z.string().url().default('http://localhost:3000'),
  // Redis (Phase 4) — cache, locks, and later pub/sub + queues.
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  // Realtime WebSocket gateway (Phase 8), off by default — it's a scaffold,
  // not yet load-bearing for any feature. NOTE: intentionally NOT
  // `z.coerce.boolean()` — that coerces ANY non-empty string (including the
  // literal text "false") to `true`, a classic env-flag footgun. An enum +
  // explicit transform is the safe way to parse a boolean-shaped env var.
  REALTIME_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Kafka (Phase 10) — comma-separated bootstrap brokers. Not a URL (no
  // scheme), so plain string validation, split on "," by the client.
  KAFKA_BROKERS: z.string().default('localhost:9092'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    console.error(`\nInvalid environment configuration:\n${issues}\n`);
    // Fail fast: a misconfigured process should never start.
    process.exit(1);
  }

  return Object.freeze(parsed.data);
}

/** Validated, immutable application config. Import this — never read process.env directly. */
export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
