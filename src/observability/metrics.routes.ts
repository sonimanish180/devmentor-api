import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler';
import { registry } from './metrics';

/**
 * The scrape endpoint Prometheus polls (Task 12.2). Unauthenticated and
 * outside rate limiting — same reasoning as `/health`/`/ready` (Task 0.5):
 * it's an infra endpoint hit frequently by a trusted scraper, not a client
 * feature, and gating it behind auth would just mean teaching Prometheus a
 * credential to leak instead of solving a real problem.
 */
export const metricsRouter = Router();

metricsRouter.get(
  '/metrics',
  asyncHandler(async (_req, res) => {
    res.set('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  }),
);
