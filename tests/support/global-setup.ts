import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const STATE_FILE = path.join(__dirname, '.testcontainers-state.json');
const REPO_ROOT = path.join(__dirname, '..', '..');

/**
 * Vitest global setup (Task 13.1) — runs exactly ONCE, in a process separate
 * from any individual test file, before that test file's own imports are
 * ever resolved. That separation is what makes ephemeral, randomly-ported
 * containers workable here at all: `src/config/env.ts` validates and FREEZES
 * `DATABASE_URL`/`REDIS_URL` the first time anything imports it (Task 0.2's
 * fail-fast config) — so those values must already be correct in
 * `process.env` before any test file's import graph reaches that module.
 * A `beforeAll` inside a test file is too late; this global step is not.
 *
 * Deliberately opt-in via `RUN_DB_TESTS` — the exact same gate Tasks 5.5/9.6
 * already check with `describe.skipIf(!process.env.RUN_DB_TESTS)`. Plain
 * `pnpm test` never touches Docker, never pulls an image, and stays fast;
 * `pnpm test:integration` (== `RUN_DB_TESTS=1 vitest run`) is what actually
 * starts containers. This SUPERSEDES the old manual workflow (hand-run a dev
 * Postgres, `export TEST_USER_ID=...`) — the container, the migration, the
 * seed, and the fixture ids are now all provisioned automatically, every run,
 * from a clean slate.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  if (!process.env.RUN_DB_TESTS) {
    return async () => {}; // unit-only run — nothing was started, nothing to tear down
  }

  const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
  const { RedisContainer } = await import('@testcontainers/redis');
  const { execSync } = await import('node:child_process');
  const { PrismaClient } = await import('@prisma/client');

  const postgres = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('devmentor_test')
    .withUsername('devmentor')
    .withPassword('devmentor')
    .start();

  const redis = await new RedisContainer('redis:7-alpine').start();

  const databaseUrl = postgres.getConnectionUri();
  const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;

  // Apply the committed migration history (Task 1.4) — never `db push` — so
  // integration tests exercise the exact SQL that would run in CI/prod,
  // including the Phase 11 tsvector/GIN migration.
  execSync('pnpm exec prisma migrate deploy', {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });

  // The same idempotent seed script (Task 1.4) that populates a dev database
  // — reused so fixture data (the demo user, course, module, lessons) is
  // defined in exactly one place, not duplicated for tests.
  execSync('pnpm exec tsx prisma/seed.ts', {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

  const user = await prisma.user.findUniqueOrThrow({ where: { email: 'demo@devmentor.dev' } });
  const lesson = await prisma.lesson.findFirstOrThrow({ where: { slug: 'intro' } });

  // A short-duration quiz for Task 9.6's deadline test — not part of the
  // shared dev seed (which has no reason to know about test-only timing
  // fixtures), so it's created directly against the container here instead.
  const quiz = await prisma.quiz.upsert({
    where: { lessonId: lesson.id },
    update: {},
    create: {
      lessonId: lesson.id,
      durationSeconds: 2, // short on purpose — the deadline test sleeps past this
      contestMode: false,
      published: true,
      questions: [{ id: 'q1', prompt: '2+2?', options: ['3', '4'], correctIndex: 1, points: 1 }],
    },
  });

  await prisma.$disconnect();

  writeFileSync(
    STATE_FILE,
    JSON.stringify({
      databaseUrl,
      redisUrl,
      testUserId: user.id,
      testLessonId: lesson.id,
      testQuizId: quiz.id,
    }),
  );

  // Vitest treats whatever this function RETURNS as the teardown step, run
  // once after the whole test run finishes — closures here still have the
  // container handles in scope, so stopping them needs no extra bookkeeping.
  return async () => {
    await postgres.stop();
    await redis.stop();
    if (existsSync(STATE_FILE)) rmSync(STATE_FILE);
  };
}
