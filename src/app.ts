import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { httpLogger } from './middleware/httpLogger';
import { metricsMiddleware } from './middleware/metrics';
import { authRateLimiter } from './middleware/rateLimit';
import { healthRouter } from './modules/health/health.routes';
import { metricsRouter } from './observability/metrics.routes';
import { apiRouter } from './api/router';
import { notFoundHandler } from './middleware/notFound';
import { errorHandler } from './middleware/errorHandler';

/**
 * Builds the Express application. Kept as a factory (not a top-level singleton)
 * so tests can spin up an isolated app instance, and so the HTTP server
 * bootstrap (server.ts) stays separate from app composition.
 *
 * Middleware order matters:
 *   1. security headers (helmet) + CORS
 *   2. request logging + correlation id, then RED metrics recording (Task 12.2)
 *   3. body + cookie parsing
 *   4. health probes + /metrics (unauthenticated, un-rate-limited)
 *   5. rate limiting on sensitive routes, then the versioned API
 *   6. 404 handler, then the centralized error handler (must be last)
 */
export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind a load balancer/proxy in prod (correct client IP for rate limiting)

  // Security headers + browser origin allow-list (credentials for the refresh cookie).
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));

  app.use(httpLogger);
  app.use(metricsMiddleware);
  app.use(express.json());
  app.use(cookieParser());

  // Health/readiness probes and the Prometheus scrape endpoint — all three
  // are infra endpoints: unauthenticated and outside rate limiting.
  app.use(healthRouter);
  app.use(metricsRouter);

  // Version index for discovery.
  app.get('/api', (_req, res) => res.json({ versions: ['v1'], current: '/api/v1' }));

  // Throttle auth endpoints (brute-force / credential stuffing) before the API.
  app.use('/api/v1/auth', authRateLimiter);

  // Versioned API surface.
  app.use('/api/v1', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
