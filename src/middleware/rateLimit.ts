import rateLimit from 'express-rate-limit';
import { AppError } from '../lib/AppError';
import { env } from '../config/env';

/**
 * Rate limit for auth endpoints — throttles credential stuffing / brute force.
 * On limit we forward our 429 AppError so the response uses the shared envelope.
 *
 * NOTE: this is an in-memory limiter (per-process). A distributed, Redis-backed
 * limiter that works across replicas arrives in Phase 4/5.
 *
 * `skip` (Task 13.2): a single integration test FILE legitimately exercises
 * register/login/refresh-rotation/reuse-detection/logout end to end — 20+
 * real HTTP requests against `/api/v1/auth/*` within seconds is normal test
 * traffic, not the credential-stuffing pattern this limiter exists to catch.
 * Short-circuiting only when `NODE_ENV==='test'` keeps dev/prod behavior
 * completely unchanged; it's the same instinct as excluding `/health`/`/ready`
 * from tracing (Task 12.1) or RED metrics (Task 12.2) — infrastructure/tooling
 * traffic that would otherwise pollute a signal meant for something else.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 20, // per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  handler: (_req, _res, next) => next(AppError.tooManyRequests('Too many attempts, please try again later')),
});
