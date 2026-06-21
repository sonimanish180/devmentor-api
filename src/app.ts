import express, { type Express } from 'express';
import { httpLogger } from './middleware/httpLogger';
import { notFoundHandler } from './middleware/notFound';
import { errorHandler } from './middleware/errorHandler';

/**
 * Builds the Express application. Kept as a factory (not a top-level singleton)
 * so tests can spin up an isolated app instance, and so the HTTP server
 * bootstrap (server.ts) stays separate from app composition.
 *
 * Middleware order matters:
 *   1. request logging + correlation id   (so everything after is traceable)
 *   2. body parsing
 *   3. security middleware                 (helmet/CORS/rate-limit — added in Phase 3)
 *   4. routes                              (mounted in later phases)
 *   5. 404 handler                         (after routes; nothing matched)
 *   6. centralized error handler           (must be last)
 */
export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(httpLogger);
  app.use(express.json());

  // --- Security middleware mounts here in Phase 3 (helmet, CORS, rate limiting) ---
  // --- Feature routers mount here in later phases, e.g. app.use('/api/v1', apiRouter) ---

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
