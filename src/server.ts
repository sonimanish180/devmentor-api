import 'dotenv/config';
// MUST come before any import that transitively requires express/ioredis/
// prisma (createApp does) — auto-instrumentation patches those modules at
// `require` time, so tracing has to start first. See src/observability/tracing.ts.
import { shutdownTracing } from './observability/tracing';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { registerPrismaHooks } from './lib/prisma';
import { registerRedisHooks } from './lib/redis';
import { onShutdown, runShutdownHooks } from './lib/shutdown';
import { emailQueue } from './queues/email.queue';
import { eventsQueue } from './queues/events.queue';
import { startRealtimeGateway } from './realtime/gateway';
import { startQueueDepthPoller, startOutboxLagPoller } from './observability/metrics';
import { prisma } from './lib/prisma';

/**
 * HTTP server bootstrap + graceful shutdown.
 *
 * On SIGTERM/SIGINT (e.g. a deploy rolling the container, or Ctrl-C) we:
 *   1. stop accepting new connections (`server.close`),
 *   2. let in-flight requests finish, nudging idle keep-alive sockets closed,
 *   3. close registered resources (DB, Redis, queues — added in later phases),
 *   4. exit cleanly — or force-exit if something hangs past the deadline.
 *
 * This avoids dropping requests mid-flight when an orchestrator replaces the
 * instance, which is essential for zero-downtime deploys.
 */
const FORCE_EXIT_MS = 10_000;

registerPrismaHooks(); // DB readiness check + graceful disconnect
registerRedisHooks(); // Redis readiness check + graceful quit
onShutdown('emailQueue', () => emailQueue.close()); // close the producer queue on shutdown
onShutdown('tracing', shutdownTracing); // flush buffered spans before exit

// Queue depth (Task 12.2) — sampled here in the API process rather than the
// worker: both processes hold a `Queue` client for the same underlying
// Redis-backed queue, and this poller only ever READS job counts, never
// `.add()`s. Keeping it on the API means `/metrics` (also served here) can
// report worker-layer saturation without the worker needing its own HTTP
// server just to expose one gauge.
const queueDepthPoller = startQueueDepthPoller({ email: emailQueue, events: eventsQueue });
onShutdown('queueDepthPoller', () => {
  queueDepthPoller.stop();
});

// Outbox lag (Task 12.3) — freshness signal for the two independent relay
// cursors introduced in Phase 10 (`dispatchedAt` for BullMQ, `kafkaDispatchedAt`
// for Kafka). Reuses the app's existing Prisma singleton (Task 1.1).
const outboxLagPoller = startOutboxLagPoller(prisma);
onShutdown('outboxLagPoller', () => {
  outboxLagPoller.stop();
});

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'devmentor-api listening');
});

// Realtime WebSocket gateway (Phase 8) — a scaffold behind a flag. Off by
// default: no WS server, no extra Redis pub/sub connection, until a feature
// actually needs live push. `startRealtimeGateway` needs the http.Server
// instance itself (to attach the WS upgrade handler), so it's wired here.
if (env.REALTIME_ENABLED) {
  const realtimeGateway = startRealtimeGateway(server);
  onShutdown('realtimeGateway', () => realtimeGateway.stop());
  logger.info('realtime gateway enabled (WebSocket + Redis pub/sub)');
}

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return; // ignore repeated signals
  shuttingDown = true;
  logger.info({ signal }, 'Received shutdown signal — draining');

  // Safety net: never hang forever waiting on a stuck connection.
  const forceTimer = setTimeout(() => {
    logger.error({ timeoutMs: FORCE_EXIT_MS }, 'Drain timed out — forcing exit');
    process.exit(1);
  }, FORCE_EXIT_MS);
  forceTimer.unref();

  // Stop accepting new connections; callback fires once in-flight requests end.
  server.close(async (err) => {
    if (err) logger.error({ err }, 'Error while closing HTTP server');
    await runShutdownHooks();
    clearTimeout(forceTimer);
    logger.info('Shutdown complete');
    process.exit(err ? 1 : 0);
  });

  // Close idle keep-alive sockets so `server.close` isn't held open by them
  // (active requests are allowed to finish). Available on Node 18.2+.
  server.closeIdleConnections?.();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — exiting');
  process.exit(1);
});
