import { describe, it, expect } from 'vitest';
import request from 'supertest';

/**
 * Auth lifecycle + authz integration tests (Task 13.2). Real HTTP requests
 * via supertest, against the real `createApp()` factory — no mocked Prisma,
 * argon2, or JWT anywhere in this file. Module imports that transitively
 * touch `src/config/env.ts` are deferred with `await import(...)` INSIDE each
 * test body (never as a static top-level import), matching the convention
 * Tasks 5.5/9.6 already established and Task 13.1's lesson explains: a static
 * top-level import runs at module-collection time regardless of
 * `describe.skipIf`, which would defeat the point of gating DB-backed tests
 * behind `RUN_DB_TESTS` at all.
 */

function uniqueEmail(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

/** Pulls just the `name=value` pair out of a Set-Cookie header, discarding
 * Path/HttpOnly/SameSite/Max-Age attributes, so it can be replayed verbatim
 * as a request's `Cookie` header in a later call. */
function extractRefreshCookie(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  const cookieStr = Array.isArray(raw) ? raw[0] : raw;
  if (!cookieStr) throw new Error('expected a Set-Cookie header in the response');
  return cookieStr.split(';')[0]!;
}

/**
 * RBAC: 401 vs 403. Deliberately OUTSIDE the RUN_DB_TESTS gate below — this
 * needs no Postgres/Redis at all, just the JWT-verifying middleware chain,
 * so it runs on every plain `pnpm test` as fast, infra-free coverage. It also
 * exists because `requireRole(...)` (Task 3.5) has no real caller anywhere in
 * the codebase today (grepped: defined, documented, never wired to an actual
 * route) — this is the only place that middleware's behavior is proven at all.
 */
describe('RBAC: requireAuth vs requireRole (401 vs 403)', () => {
  it('distinguishes "no/invalid identity" (401) from "valid identity, wrong role" (403)', async () => {
    const { default: express } = await import('express');
    const { requireAuth, requireRole } = await import('../../src/middleware/requireAuth');
    const { errorHandler } = await import('../../src/middleware/errorHandler');
    const { notFoundHandler } = await import('../../src/middleware/notFound');
    const { signAccessToken } = await import('../../src/modules/auth/tokens');

    // A minimal throwaway app — just enough middleware to prove the two
    // functions actually behave as documented, independent of any real route.
    const app = express();
    app.get('/admin-only', requireAuth, requireRole('ADMIN'), (_req, res) => res.json({ ok: true }));
    app.use(notFoundHandler);
    app.use(errorHandler);

    const noToken = await request(app).get('/admin-only');
    expect(noToken.status).toBe(401);

    const userToken = signAccessToken({ sub: 'user-1', role: 'USER' });
    const wrongRole = await request(app).get('/admin-only').set('Authorization', `Bearer ${userToken}`);
    expect(wrongRole.status).toBe(403);

    const adminToken = signAccessToken({ sub: 'admin-1', role: 'ADMIN' });
    const rightRole = await request(app).get('/admin-only').set('Authorization', `Bearer ${adminToken}`);
    expect(rightRole.status).toBe(200);
  });
});

/** Runs only under `pnpm test:integration` (== RUN_DB_TESTS=1 vitest run) — see Task 13.1's harness. */
describe.skipIf(!process.env.RUN_DB_TESTS)('Auth lifecycle (register / login / refresh / logout)', () => {
  async function buildApp() {
    const { createApp } = await import('../../src/app');
    return createApp();
  }

  it('registers a new user: 201, public user shape (no passwordHash), refresh cookie set', async () => {
    const app = await buildApp();
    const email = uniqueEmail();

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: 'correct horse battery staple', name: 'Test User' });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email, name: 'Test User', role: 'USER' });
    expect(res.body.user).not.toHaveProperty('passwordHash');
    expect(res.body.accessToken).toEqual(expect.any(String));

    const cookie = extractRefreshCookie(res);
    expect(cookie).toMatch(/^refresh_token=/);
    const rawSetCookie = (res.headers['set-cookie'] as string[])[0]!;
    expect(rawSetCookie).toMatch(/HttpOnly/);
    expect(rawSetCookie).toMatch(/Path=\/api\/v1\/auth/);
  });

  it('rejects registering the same email twice with 409 CONFLICT, not a 500', async () => {
    const app = await buildApp();
    const email = uniqueEmail();
    await request(app).post('/api/v1/auth/register').send({ email, password: 'correct horse battery staple' });

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: 'a totally different password 123' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('rejects a malformed registration body with 400 VALIDATION_ERROR', async () => {
    const app = await buildApp();
    const res = await request(app).post('/api/v1/auth/register').send({ email: 'not-an-email', password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns the SAME error for an unknown email and a wrong password (no user enumeration)', async () => {
    const app = await buildApp();
    const email = uniqueEmail();
    await request(app).post('/api/v1/auth/register').send({ email, password: 'correct horse battery staple' });

    const unknownEmail = await request(app).post('/api/v1/auth/login').send({ email: uniqueEmail(), password: 'whatever' });
    const wrongPassword = await request(app).post('/api/v1/auth/login').send({ email, password: 'definitely wrong' });

    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.body.error.message).toBe(wrongPassword.body.error.message);
  });

  it('GET /me: 401 with no Bearer token, the right user with a valid one', async () => {
    const app = await buildApp();
    const email = uniqueEmail();
    const registerRes = await request(app).post('/api/v1/auth/register').send({ email, password: 'correct horse battery staple' });
    const { accessToken } = registerRes.body;

    const withoutAuth = await request(app).get('/api/v1/auth/me');
    expect(withoutAuth.status).toBe(401);

    const withAuth = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(withAuth.status).toBe(200);
    expect(withAuth.body.user.email).toBe(email);
  });

  it('/refresh rotates the token: a fresh cookie comes back, distinct from the one presented', async () => {
    const app = await buildApp();
    const email = uniqueEmail();
    const registerRes = await request(app).post('/api/v1/auth/register').send({ email, password: 'correct horse battery staple' });
    const originalCookie = extractRefreshCookie(registerRes);

    const refreshRes = await request(app).post('/api/v1/auth/refresh').set('Cookie', originalCookie);

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.accessToken).toEqual(expect.any(String));
    const rotatedCookie = extractRefreshCookie(refreshRes);
    expect(rotatedCookie).not.toBe(originalCookie);
  });

  it('/refresh with no cookie at all is a 401, not a crash', async () => {
    const app = await buildApp();
    const res = await request(app).post('/api/v1/auth/refresh');
    expect(res.status).toBe(401);
  });

  it('detects refresh-token REUSE and revokes every token for that user, not just the reused one (Task 3.4)', async () => {
    const app = await buildApp();
    const email = uniqueEmail();

    const registerRes = await request(app).post('/api/v1/auth/register').send({ email, password: 'correct horse battery staple' });
    const token1 = extractRefreshCookie(registerRes);

    const refresh1 = await request(app).post('/api/v1/auth/refresh').set('Cookie', token1);
    expect(refresh1.status).toBe(200);
    const token2 = extractRefreshCookie(refresh1);

    const refresh2 = await request(app).post('/api/v1/auth/refresh').set('Cookie', token2);
    expect(refresh2.status).toBe(200);
    const token3 = extractRefreshCookie(refresh2);

    // Replay token1 — already rotated away by refresh1. A legitimate client
    // and, in a real theft scenario, an attacker could equally be holding a
    // copy of an old token; the server can't tell which, so it treats this as
    // theft and revokes the WHOLE session tree, not just token1.
    const reuseRes = await request(app).post('/api/v1/auth/refresh').set('Cookie', token1);
    expect(reuseRes.status).toBe(401);

    // token3 was legitimately issued by refresh2 and still valid a moment
    // ago — proving it's now ALSO rejected is what proves
    // revokeAllUserRefreshTokens actually ran, not just a single-token revoke.
    const afterTheftRes = await request(app).post('/api/v1/auth/refresh').set('Cookie', token3);
    expect(afterTheftRes.status).toBe(401);
  });

  it('logout revokes the current refresh token — a refresh with it afterward fails', async () => {
    const app = await buildApp();
    const email = uniqueEmail();
    const registerRes = await request(app).post('/api/v1/auth/register').send({ email, password: 'correct horse battery staple' });
    const cookie = extractRefreshCookie(registerRes);

    const logoutRes = await request(app).post('/api/v1/auth/logout').set('Cookie', cookie);
    expect(logoutRes.status).toBe(204);

    const refreshAfterLogout = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(refreshAfterLogout.status).toBe(401);
  });
});
