import { logger } from './lib/logger';
import { redis } from './lib/redis';
import { startEmailWorker } from './queues/email.worker';

/**
 * The worker process entrypoint (`pnpm worker`). Runs separately from the API
 * so background jobs scale independently and never share the request event loop.
 */
const workers = [startEmailWorker()];
logger.info({ workers: workers.map((w) => w.name) }, 'worker process started');

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'worker shutting down — draining active jobs');
  await Promise.all(workers.map((w) => w.close())); // waits for in-flight jobs to finish
  await redis.quit();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
