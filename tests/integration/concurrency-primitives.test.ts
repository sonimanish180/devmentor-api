import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

/**
 * Consolidates concurrency-primitive coverage (Task 13.3) under the Task
 * 13.1 harness. `tests/concurrency.test.ts` already proves the REPOSITORY
 * layer's DB-level idempotency (a composite-PK unique constraint) by calling
 * `completeLesson` directly; this file adds the two things that were still
 * untested: the `Idempotency-Key` MIDDLEWARE's own replay behavior (Task
 * 5.1), proven through real sequential HTTP requests rather than a direct
 * function call, and a direct, isolated test of the distributed lock
 * primitive (Task 5.4's `withLock`) — used since Phase 9 (quiz attempt
 * start) but never exercised on its own until now.
 */
describe.skipIf(!process.env.RUN_DB_TESTS)('Concurrency primitives', () => {
  async function registerAndAuth() {
    const { createApp } = await import('../../src/app');
    const app = createApp();
    const email = `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: 'correct horse battery staple' });
    return { app, accessToken: res.body.accessToken as string };
  }

  it('Idempotency-Key middleware replays the ORIGINAL response for a sequential retry, verbatim', async () => {
    const { app, accessToken } = await registerAndAuth();
    const lessonId = process.env.TEST_LESSON_ID!;
    const key = randomUUID();

    const first = await request(app)
      .post(`/api/v1/progress/lessons/${lessonId}/complete`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', key)
      .send();

    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ alreadyCompleted: false });
    expect(first.headers['idempotent-replay']).toBeUndefined(); // nothing to replay yet, first time through

    // A retry with the SAME key, sent only after the first request has fully
    // completed — the sequential-retry case this middleware is actually built
    // for (its own doc comment concedes true simultaneity is a different
    // guard entirely — see the next test).
    const replay = await request(app)
      .post(`/api/v1/progress/lessons/${lessonId}/complete`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', key)
      .send();

    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.status).toBe(first.status); // verbatim replay of the cached response
    expect(replay.body).toEqual(first.body); // not a fresh "alreadyCompleted:true" — the ORIGINAL body
  });

  it('TRUE concurrency (same Idempotency-Key, fired simultaneously) is guarded by the DB constraint, not the middleware', async () => {
    const { app, accessToken } = await registerAndAuth();
    const lessonId = process.env.TEST_LESSON_ID!;
    const key = randomUUID();

    // Ten simultaneous requests sharing one Idempotency-Key: all ten can miss
    // the Redis cache before any one response commits back to it, so the
    // middleware itself guarantees nothing here — the repository's
    // LessonCompletion composite-PK unique constraint (P2002) is what
    // actually enforces exactly-once XP.
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app)
          .post(`/api/v1/progress/lessons/${lessonId}/complete`)
          .set('Authorization', `Bearer ${accessToken}`)
          .set('Idempotency-Key', key)
          .send(),
      ),
    );

    const fresh = responses.filter((r) => r.body.alreadyCompleted === false);
    const already = responses.filter((r) => r.body.alreadyCompleted === true);

    expect(fresh).toHaveLength(1); // exactly one request actually awarded XP
    expect(already).toHaveLength(9);
    expect(fresh[0]!.status).toBe(201);
    for (const r of already) expect(r.status).toBe(200);
  });

  it('withLock (Task 5.4) lets exactly one of N concurrent callers proceed; the rest get 409 CONFLICT', async () => {
    const { withLock } = await import('../../src/lib/lock');
    const key = `test-lock:${randomUUID()}`;

    const results = await Promise.allSettled(Array.from({ length: 10 }, () => withLock(key, 2000, async () => 'ran')));

    const fulfilled = results.filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(9);
    for (const r of rejected) {
      expect(r.reason).toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    }
  });
});
