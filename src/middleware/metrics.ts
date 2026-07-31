import type { RequestHandler } from 'express';
import { httpRequestsTotal, httpRequestDurationSeconds, httpRequestsInProgress } from '../observability/metrics';

/**
 * Records the RED metrics (Task 12.2) for every request. Mounted early in
 * `createApp()`, same as `httpLogger` (Task 0.3) — same shape, different
 * destination: one writes a structured log line per request, this one
 * updates in-memory counters a scraper later reads via `/metrics`.
 */
export const metricsMiddleware: RequestHandler = (req, res, next) => {
  // Skip the scrape endpoint itself and the liveness/readiness probes: they
  // run every few seconds forever and would otherwise dominate the request
  // count/duration series with infrastructure noise instead of real traffic.
  if (req.path === '/metrics' || req.path === '/health' || req.path === '/ready') {
    return next();
  }

  const method = req.method;
  httpRequestsInProgress.inc({ method });
  const stopTimer = httpRequestDurationSeconds.startTimer({ method });

  res.once('finish', () => {
    httpRequestsInProgress.dec({ method });

    // Label by the matched ROUTE TEMPLATE (e.g. "/api/v1/courses/:slug"), never
    // the raw URL. The raw URL has unbounded cardinality — one label value per
    // distinct id anyone ever requests — which would make this metric grow
    // forever and eventually blow up Prometheus's memory. `req.route` is only
    // populated once Express has matched a route, so unmatched requests
    // (404s) fall back to a single bucket instead of leaking the raw path.
    const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : 'unmatched';
    const labels = { method, route, status: String(res.statusCode) };

    httpRequestsTotal.inc(labels);
    stopTimer(labels);
  });

  next();
};
