import { logger } from './logger';

export interface ShutdownHook {
  name: string;
  close: () => Promise<void> | void;
}

const hooks: ShutdownHook[] = [];

/**
 * Register a resource to close during graceful shutdown (DB pool, Redis,
 * queue workers…). Later phases call this so shutdown stays in one place.
 */
export function onShutdown(name: string, close: ShutdownHook['close']): void {
  hooks.push({ name, close });
}

/** Close resources in reverse registration order (LIFO, like unwinding a stack). */
export async function runShutdownHooks(): Promise<void> {
  for (const hook of [...hooks].reverse()) {
    try {
      await hook.close();
      logger.info({ hook: hook.name }, 'Closed resource');
    } catch (err) {
      logger.error({ err, hook: hook.name }, 'Error closing resource');
    }
  }
}
