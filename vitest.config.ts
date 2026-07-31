import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration (Task 13.1). Previously vitest ran with zero config at
 * all — this wires up the two things Phase 13 actually needs: a global setup
 * that can stand up disposable Postgres/Redis containers for the
 * `RUN_DB_TESTS`-gated integration tests already written in Phases 5 and 9,
 * and coverage collection for the CI gate (Task 13.5).
 */
export default defineConfig({
  test: {
    environment: 'node',

    // Runs ONCE before any test file's module graph is touched — see
    // tests/support/global-setup.ts for why that separation matters (env.ts
    // freezes DATABASE_URL/REDIS_URL the first time anything imports it).
    globalSetup: ['./tests/support/global-setup.ts'],

    // Runs before EACH test file, in that file's own context, before its
    // imports resolve — see tests/support/setup-env.ts.
    setupFiles: ['./tests/support/setup-env.ts'],

    // Container-backed integration tests (start an attempt, wait out a
    // deadline, run N parallel writes) are slower than pure unit tests by
    // nature — a generous default keeps them from flaking under CI load
    // without needing a per-test override.
    testTimeout: 30_000,
    hookTimeout: 60_000,

    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      // Entrypoints wire up process-level concerns (signal handlers, listen())
      // that integration tests exercise indirectly, not the kind of branchy
      // logic unit coverage numbers are meaningful for.
      exclude: ['src/**/*.d.ts', 'src/server.ts', 'src/worker.ts'],
      // The CI gate (Task 13.5): `vitest run --coverage` exits non-zero if
      // these aren't met, which is the entire enforcement mechanism — no
      // separate scripting needed. Deliberately modest starting numbers, not
      // an aspirational target: this sandbox has never been able to execute
      // this suite even once (see ADR-0014's environment note), so there is
      // no real coverage number to calibrate against yet. Treat these as a
      // gate that exists and is non-trivial, to be tightened once a real CI
      // run reports actual numbers — not as a carefully-tuned figure.
      thresholds: {
        lines: 50,
        statements: 50,
        functions: 50,
        branches: 40,
      },
    },
  },
});
