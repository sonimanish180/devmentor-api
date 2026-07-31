# ADR-0014: Testing strategy — Testcontainers over mocks, k6 for load, coverage as a CI gate

- Status: Accepted
- Date: 2026-09-02
- Phase: 13 — Testing & Quality
- Deciders: DevMentor team

## Problem

By Phase 12 the codebase has real concurrency guarantees (OCC, distributed locks, idempotency, transactional
outbox), real timing guarantees (server-authoritative quiz deadlines), and real security guarantees (refresh
rotation, reuse detection, RBAC) — but the only tests exercising any of it (`tests/concurrency.test.ts`,
`tests/quiz-concurrency.test.ts`, Tasks 5.5/9.6) are gated behind a `RUN_DB_TESTS` flag a developer has to
satisfy by hand: run a local Postgres, `export TEST_USER_ID=...`. That doesn't reproduce, doesn't run in CI,
and drifts silently. Separately, nothing proves the actual HTTP surface (routing, middleware, cookies)
behaves as documented, nothing proves the system holds up under realistic concurrent *load* rather than a
small fixed-N race, and nothing stops a regression from merging unnoticed.

## Options considered

**Test double strategy:**
1. **Mock Prisma/Redis** for anything DB/cache-touching — fast, zero infra, but structurally cannot prove a
   real `FOR UPDATE SKIP LOCKED` query, a real composite-PK unique-violation race, or a real `SET NX` lock
   behave as claimed. A mock can only prove the code CALLS the right function, never that the function's
   real behavior under real concurrency matches the claim.
2. **A shared, hand-run dev database for CI too** — real behavior, but not reproducible, not disposable, and
   state leaks between runs/PRs unless someone remembers to reset it.
3. **Testcontainers**: real Postgres/Redis, started fresh and disposed of per test run, driven from
   application code rather than CI-specific YAML. (chosen)

**Load testing tool:**
1. **k6** — purpose-built for ramping-VU load tests with built-in latency percentiles and pass/fail
   thresholds; a separate runtime from Node, which is a real seam but keeps load-test scripting simple.
   (chosen)
2. **A hand-rolled Node script firing concurrent requests** — no new tool, but reimplements percentile
   calculation, ramping, and threshold-based pass/fail — all things k6 already does well.
3. **Artillery / Locust** — comparable capability to k6; k6's `Trend`/`Rate` custom metrics and threshold
   syntax mapped cleanly onto this project's existing SLO framing (Task 12.3), which tipped the choice.

**CI enforcement:**
1. **Tests run, nobody enforces a bar** — status quo; a regression can merge as long as the (optional) test
   command wasn't run.
2. **Coverage tracked but not gated (informational only)** — visibility without teeth; coverage erodes slowly
   and nobody notices until it's very low.
3. **Coverage thresholds as a hard CI gate** (`vitest run --coverage` exits non-zero below threshold) — a
   real bar, low ceremony (no separate parsing script), automatically enforced on every push/PR. (chosen)

## Decision

**Testcontainers**, wired through Vitest's two-stage `globalSetup`/`setupFiles` lifecycle specifically to
work around `src/config/env.ts`'s freeze-on-first-import design (Task 0.2): `global-setup.ts` starts
disposable Postgres + Redis containers (gated on the existing `RUN_DB_TESTS` flag — unit tests never touch
Docker), applies the real migration history (`prisma migrate deploy`), runs the SAME idempotent seed script
used for local dev, and writes connection info + fixture ids to a state file; `setup-env.ts` reads that file
into `process.env` before each test file's own imports resolve. `pnpm test` stays fast and infra-free;
`pnpm test:integration` now fully automates what used to be manual setup.

**supertest**, against the real `createApp()` factory (Task 2.3), for auth-lifecycle and authz integration
tests (Task 13.2) — genuine HTTP requests through genuine middleware, including a direct, isolated proof of
`requireRole`'s 401-vs-403 contract, which had no real caller anywhere in the codebase to exercise it
otherwise. Task 13.2 also surfaced and fixed a real bug: the auth rate limiter (Task 3.6) is a shared,
in-process singleton that the test suite's own legitimate traffic could trip — fixed with a `NODE_ENV==='test'`
skip, the same instinct as excluding health/metrics probes from tracing and RED metrics (Phase 12).

**k6** for load testing (Task 13.4), targeting the quiz start→submit flow and lesson completion — the two
write paths with the most invested concurrency-safety effort — with pass/fail thresholds set to the *exact
same numbers* as the Availability/Latency SLOs (Task 12.3), so the load test actually validates the promise
rather than a separately-invented, looser bar. k6 is architecturally distinct from every other test in this
repo (its own runtime, real network calls against an already-running process) and cannot be wired into the
Testcontainers harness at all.

**A hard coverage gate in CI** (`.github/workflows/ci.yml`, Task 13.5): lint, typecheck (both `src/` and,
newly, `tests/` via `tsconfig.test.json`), then the full unit+integration suite with coverage thresholds
enforced by `vitest run --coverage`'s own exit code. No `services:` block for Postgres/Redis — Testcontainers
talks directly to the Docker daemon `ubuntu-latest` already ships, so the exact same command behaves
identically on a laptop and in CI, with infrastructure defined in exactly one place.

## Consequences

- **+** DB/Redis-backed tests are now fully reproducible and CI-capable — no hand-run dev database, no
  manually-exported fixture ids, same command on a laptop and in CI.
- **+** The HTTP surface (routing, cookies, middleware ordering) is now actually tested, not just the
  service-layer functions underneath it — and a real gap (`requireRole` never wired to a real route) was
  surfaced and closed with a dedicated test rather than silently left unverified.
- **+** A load test's thresholds are pinned to the same numbers as the SLOs they're meant to validate,
  so passing the load test actually means something about the SLO, not just about the load test itself.
- **+** Coverage regressions and test failures now block a merge automatically, rather than depending on a
  developer remembering to run something.
- **−** Testcontainers requires Docker wherever tests run — a constraint this exact environment cannot
  satisfy (see the environment note below), and one more thing a new contributor's machine needs installed.
- **−** `k6` is a genuinely separate tool/runtime from the rest of this stack — no shared code, no shared
  CI step with the vitest suite, a real seam a contributor has to learn once.
- **−** Coverage thresholds were set without ever having run the suite even once in this environment (see
  below) — they are a deliberately modest placeholder, not a calibrated target, and should be revisited the
  first time CI actually reports real numbers.
- **Revisit when:** Kafka-touching code needs integration coverage (deliberately out of scope for Task 13.1's
  harness, to keep it tractable — a `@testcontainers/kafka` module exists for this when it's warranted); when
  k6 results suggest the SLO thresholds themselves need revisiting rather than the code; or when coverage
  numbers from a real CI run make the current thresholds either trivially easy (raise them) or immediately
  failing (investigate why, don't just lower them).

## Environment note

Every file in this phase — the Testcontainers harness, the auth/concurrency integration tests, the k6
script, the CI workflow, and this ADR — was written and reviewed in a sandbox where the shell has been
non-functional since partway through Phase 7 and where Docker has never been runnable at all (a standing
limitation since Phase 0.7). This phase's very purpose is to finally validate Phases 7–12's substantial
unverified backlog, but the tests themselves have never once executed here, including on the very first
`pnpm test` run of the newly-added `tests/support/setup-env.ts`/`global-setup.ts` files. This is now SEVEN
consecutive phases (7 through 13) built without any execution in this sandbox. A host-side pass — starting
with the simplest possible check, `pnpm install && pnpm test` (unit tests only, no Docker needed) — is now
the single highest-priority next step before any further phase is attempted.
