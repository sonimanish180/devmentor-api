import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { registerPrismaHooks } from './lib/prisma';
import { registerRedisHooks } from './lib/redis';
import { runShutdownHooks } from './lib/shutdown';

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

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'devmentor-api listening');
});

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
