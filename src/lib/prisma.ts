import { PrismaClient } from '@prisma/client';
import { isProduction } from '../config/env';
import { registerReadinessCheck } from '../modules/health/readiness';
import { onShutdown } from './shutdown';

/**
 * A single shared PrismaClient. Two reasons it's a singleton:
 *  - each client owns a connection pool; creating many would exhaust Postgres
 *    connections.
 *  - in dev, `tsx watch` re-imports modules on reload — caching on globalThis
 *    prevents a new client (and pool) leaking on every change.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ log: ['warn', 'error'] });

if (!isProduction) globalForPrisma.prisma = prisma;

/**
 * Wire the database into health + lifecycle. Called once during server
 * bootstrap so readiness reflects DB connectivity and the pool closes cleanly
 * on shutdown.
 */
export function registerPrismaHooks(): void {
  registerReadinessCheck({
    name: 'postgres',
    check: async () => {
      // Cheap round-trip that proves the pool can reach Postgres.
      await prisma.$queryRaw`SELECT 1`;
    },
  });
  onShutdown('prisma', async () => {
    await prisma.$disconnect();
  });
}
