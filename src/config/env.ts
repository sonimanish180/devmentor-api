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
