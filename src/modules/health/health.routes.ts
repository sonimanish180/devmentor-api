import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { runReadinessChecks } from './readiness';

export const healthRouter = Router();

const startedAt = Date.now();

/**
 * Liveness — "is the process alive?" No dependency checks. An orchestrator
 * (k8s) or load balancer uses this to decide whether to RESTART the process.
 * Must stay cheap and always answer while the event loop is running.
 */
healthRouter.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  });
});

/**
 * Readiness — "can I serve traffic right now?" Runs registered dependency
 * checks (DB, cache…). Returns 503 when not ready so the load balancer pulls
 * this instance OUT OF ROTATION without killing it (e.g. during a transient
 * DB blip or while warming up). Currently no checks are registered, so the
 * service reports ready as soon as it's up.
 */
healthRouter.get(
  '/ready',
  asyncHandler(async (_req, res) => {
    const { healthy, checks } = await runReadinessChecks();
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ready' : 'not_ready',
      checks,
    });
  }),
);
