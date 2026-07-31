import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const STATE_FILE = path.join(__dirname, '.testcontainers-state.json');

/**
 * Runs before EVERY test file, in that file's own module context — critically,
 * BEFORE the test file's own imports resolve (vitest fully executes
 * `setupFiles` first). If `global-setup.ts` started real containers
 * (`RUN_DB_TESTS=1`), their connection info is read back out of the small
 * state file it wrote and injected into `process.env` right now — so when a
 * test later does `await import('../src/lib/prisma')` (the pattern Tasks
 * 5.5/9.6 already use, specifically so this top-level env write lands first),
 * `src/config/env.ts` reads the container's real, dynamically-assigned port
 * instead of a hand-run dev machine's default.
 */
if (process.env.RUN_DB_TESTS && existsSync(STATE_FILE)) {
  const state = JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as {
    databaseUrl: string;
    redisUrl: string;
    testUserId: string;
    testLessonId: string;
    testQuizId: string;
  };
  process.env.DATABASE_URL = state.databaseUrl;
  process.env.REDIS_URL = state.redisUrl;
  process.env.TEST_USER_ID = state.testUserId;
  process.env.TEST_LESSON_ID = state.testLessonId;
  process.env.TEST_QUIZ_ID = state.testQuizId;
}

// `src/config/env.ts` fails the whole process fast (Task 0.2) if these are
// missing or malformed, regardless of whether THIS particular test file
// touches the database. Fixed, obviously-fake defaults so any test that
// transitively imports `env.ts` — now or in a future Task 13.2 integration
// test — never depends on a developer's real local `.env` secrets.
process.env.NODE_ENV ??= 'test';
process.env.JWT_ACCESS_SECRET ??= 'test-only-secret-not-for-real-use-please';
process.env.DATABASE_URL ??= 'postgresql://devmentor:devmentor@localhost:5432/devmentor_test_unused';
