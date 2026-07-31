import { describe, it, expect } from 'vitest';
import request from 'supertest';

/**
 * The simplest possible proof the Testcontainers harness (Task 13.1) actually
 * works end to end: a real HTTP request, via supertest, against the real
 * `createApp()` factory (Task 2.3 — built as a factory specifically so tests
 * could do this), hitting REAL Postgres + Redis containers via the readiness
 * route (Task 0.5). Same `RUN_DB_TESTS` gate as every other integration test
 * in this repo — plain `pnpm test` skips this file entirely.
 */
describe.skipIf(!process.env.RUN_DB_TESTS)('GET /ready (Testcontainers smoke test)', () => {
  it('reports ready once real Postgres and Redis are reachable', async () => {
    const { createApp } = await import('../../src/app');
    // `/ready`'s check registry (Task 0.5) is populated by these two calls,
    // normally made once at server boot (src/server.ts) — createApp() alone
    // builds routes/middleware only, so a test needs to register them itself,
    // same as the real bootstrap does.
    const { registerPrismaHooks } = await import('../../src/lib/prisma');
    const { registerRedisHooks } = await import('../../src/lib/redis');
    registerPrismaHooks();
    registerRedisHooks();

    const res = await request(createApp()).get('/ready');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ready' });
    expect(res.body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'postgres', status: 'up' }),
        expect.objectContaining({ name: 'redis', status: 'up' }),
      ]),
    );
  });
});
