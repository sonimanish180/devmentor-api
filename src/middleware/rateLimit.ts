import rateLimit from 'express-rate-limit';
import { AppError } from '../lib/AppError';

/**
 * Rate limit for auth endpoints — throttles credential stuffing / brute force.
 * On limit we forward our 429 AppError so the response uses the shared envelope.
 *
 * NOTE: this is an in-memory limiter (per-process). A distributed, Redis-backed
 * limiter that works across replicas arrives in Phase 4/5.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 20, // per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => next(AppError.tooManyRequests('Too many attempts, please try again later')),
});
