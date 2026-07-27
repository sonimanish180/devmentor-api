import { describe, it, expect } from 'vitest';
import { occUpdate } from '../src/lib/occ';

/**
 * Unit tests for the optimistic-concurrency helper. These run anywhere (no
 * infra). The DB/Redis-backed integration tests below are gated behind
 * RUN_DB_TESTS so `pnpm test` stays fast locally and runs the full suite in CI
 * (where Postgres + Redis are available — see Phase 13 for the harness).
 */
describe('occUpdate', () => {
  it('resolves when the versioned update affected a row', async () => {
    await expect(occUpdate(async () => ({ count: 1 }))).resolves.toBeUndefined();
  });

  it('throws 409 when 0 rows matched (a concurrent write won)', async () => {
    await expect(occUpdate(async () => ({ count: 0 }))).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
    });
  });
});

/**
 * Integration: fire N parallel completions of the same lesson and assert XP is
 * awarded EXACTLY ONCE (the composite-PK + transaction guarantee). Requires a
 * live Postgres + Redis and a seeded lesson.
 *
 *   RUN_DB_TESTS=1 pnpm test
 */
describe.skipIf(!process.env.RUN_DB_TESTS)('completeLesson under concurrency', () => {
  it('awards XP exactly once for parallel duplicate requests', async () => {
    const { completeLesson, getProgress } = await import('../src/modules/progress/progress.repository');
    const userId = process.env.TEST_USER_ID!;
    const lessonId = process.env.TEST_LESSON_ID!;

    const before = await getProgress(userId);
    const results = await Promise.all(Array.from({ length: 10 }, () => completeLesson(userId, lessonId)));
    const after = await getProgress(userId);

    // Exactly one request should report a fresh award; the rest are no-ops.
    const awarded = results.filter((r) => !r.alreadyCompleted);
    expect(awarded).toHaveLength(1);
    expect(after.totalXP - before.totalXP).toBe(awarded[0]!.xpAwarded);
  });
});
