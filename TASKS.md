# DevMentor Backend — Task Plan & Progress Tracker

This is the **single source of truth** for building `devmentor-api` 0 → 1. We work **one task at a time** and review each before moving on. Every task carries a ready-to-run **prompt**; when it's done we flip its status, fill **What was done**, and update the **course content** so learners follow the real journey.

**Companion docs:** `../devmentor-backend-course-plan.md` (curriculum + architecture), `./AGENT.md` (process + ADR template + Definition of Done), `./README.md` (overview + phase tracker + ADR index).

## How we work each task

1. Pick the next `☐ Pending` task and set it to `🟡 In progress`.
2. Run its **Prompt**. Keep PRs small; follow `AGENT.md` conventions.
3. Add/extend tests (incl. **concurrency** tests where relevant).
4. **Review** the result together.
5. On approval: set `✅ Done`, fill **What was done** (files, decisions), record any **ADR**, and do the **Course update**.
6. Update the README phase tracker + ADR index. Confirm `docker compose up` is green (from Phase 0.7+).

**Status legend:** `☐ Pending` · `🟡 In progress` · `✅ Done` · `⛔ Blocked`

**Course track:** lessons land in `devmentor/src/data/backend-build-curriculum.ts` (new "Build a Scalable Backend (0 → 1)" track, created in Task 0.8). One **module per phase**, each lesson follows **Problem → Options → Decision & Why → Implementation → Pitfalls → Quiz** (mapped to DevMentor's `LessonBlock` types).

---

## Phase 0 — Foundations & Project Setup  · 🟡 In progress

### Task 0.1 — Initialize the project · ✅ Done
- **Prompt:** "Create `devmentor-api` baseline: `package.json` (pnpm + scripts), `tsconfig.json` (strict, CommonJS), `.gitignore`, `.env.example`, `eslint.config.mjs`, and the `src/{config,lib,middleware,modules,events}` + `tests` + `docs/adr` folder skeleton."
- **What was done:** Created `package.json` (Express + zod + pino; tsx/vitest/eslint dev deps; scripts: dev/build/start/worker/typecheck/lint/test), `tsconfig.json` (ES2022, CommonJS, strict, `noUncheckedIndexedAccess`), `.gitignore`, `.env.example` (with a forward map of later-phase vars), `eslint.config.mjs` (flat config + typescript-eslint), and the module folder skeleton with `.gitkeep`s.
- **Course update:** None yet (no teachable runtime concept). First lessons land in Task 0.8.

### Task 0.2 — Config loader with env validation · ✅ Done
- **Prompt:** "Add `src/config/env.ts`: load env, validate with zod (NODE_ENV, PORT, LOG_LEVEL), fail fast with a clear error on invalid/missing config, and export a typed, frozen `env` object."
- **What was done:** Added `src/config/env.ts` — a zod schema for `NODE_ENV` (enum, default `development`), `PORT` (`z.coerce.number().int().positive().max(65535)`, default `4000`), and `LOG_LEVEL` (enum, default `info`). `loadEnv()` uses `safeParse`; on failure it prints each invalid/missing field and `process.exit(1)` (fail fast); on success it returns a `Object.freeze`'d, typed `env`. Also exports `isProduction` / `isTest`. Verified in an isolated project: `tsc --noEmit` passes, defaults resolve (4000/development/info), invalid values (`PORT=-3`, `LOG_LEVEL=loud`) print clear errors and exit 1, valid overrides work. Removed `src/config/.gitkeep`.
- **Course update:** ✅ Lesson drafted in `docs/course-notes.md` → *12-Factor Config & Fail-Fast Validation* (wired into the app track at Task 0.8).

### Task 0.3 — Structured logging + request IDs · ☐ Pending
- **Prompt:** "Add `src/lib/logger.ts` (pino) and `pino-http` request logging with a per-request correlation id propagated on `req`/responses."
- **What was done:** —
- **Course update:** Lesson — *Structured logging & correlation IDs* (why JSON logs over console.log; request tracing).

### Task 0.4 — Express app factory + error handling · ☐ Pending
- **Prompt:** "Add `src/app.ts` building the Express app (json, security middleware placeholders), an `AppError` class, a centralized error handler returning a consistent JSON envelope, and a 404 handler."
- **What was done:** —
- **Course update:** Lesson — *App composition & a consistent error model*.

### Task 0.5 — Health & readiness endpoints · ☐ Pending
- **Prompt:** "Add `/health` (liveness) and `/ready` (dependency checks — stubbed now, extended as Postgres/Redis are added) endpoints."
- **What was done:** —
- **Course update:** Lesson — *Health vs readiness probes* (why two endpoints; k8s/LB semantics).

### Task 0.6 — Server entrypoint + graceful shutdown · ☐ Pending
- **Prompt:** "Add `src/server.ts` that starts the HTTP server and handles SIGTERM/SIGINT by draining in-flight requests before exit; wire `pnpm dev`."
- **What was done:** —
- **Course update:** Lesson — *Graceful shutdown & why it matters under load balancers*.

### Task 0.7 — Local Docker stack · ☐ Pending
- **Prompt:** "Add `docker-compose.yml` (Postgres + Redis with healthchecks), a dev `Dockerfile`, and `.dockerignore`. Confirm `docker compose up` is green."
- **What was done:** —
- **Course update:** Lesson — *Reproducible local environments with Docker Compose*.

### Task 0.8 — ADR-0001 + create the course track · ☐ Pending
- **Prompt:** "Write `docs/adr/0001-foundational-stack.md` (Express+TS, CommonJS, pnpm, modular monolith — problem/options/decision/consequences). Create `devmentor/src/data/backend-build-curriculum.ts` with the Phase 0 module (intro + the lessons above), register it in `curriculum.ts` + a home-page tab + `/docs` if relevant. Update README tracker + ADR index. `tsc --noEmit` clean."
- **What was done:** —
- **Course update:** Creates the track + Phase 0 module.

---

## Phase 1 — Data Modeling & Persistence · ☐ Pending
- **1.1** Add Prisma, datasource, connect to Postgres; `pnpm prisma` scripts. → *Lesson: choosing Prisma; SQL vs NoSQL here.*
- **1.2** Schema: `User`, `UserStats`. → *Lesson: modeling users & derived stats.*
- **1.3** Schema: `Course`, `Module`, `Lesson` (JSONB content blocks), `Enrollment`, `LessonCompletion`, `QuizScore`. → *Lesson: normalized core + JSONB for flexible content.*
- **1.4** Migrations + seed script (sample courses/lessons). → *Lesson: migrations & seeding.*
- **1.5** Repository layer + keyset pagination helper. → *Lesson: the N+1 problem & pagination at scale.*
- **1.6** **ADR-0002** (Postgres + Prisma, normalized + JSONB) + Phase 1 course module + trackers.

## Phase 2 — API Design & Validation · ☐ Pending
- **2.1** REST conventions, `/api/v1` router mounting, OpenAPI setup. → *Lesson: REST vs GraphQL vs tRPC.*
- **2.2** zod validation middleware + DTO pattern. → *Lesson: validating at the edge.*
- **2.3** Course catalog endpoints (list/detail) with pagination + filtering. → *Lesson: serving large catalogs.*
- **2.4** Lesson content endpoints. → *Lesson: content delivery shape.*
- **2.5** Error envelope, 404 / method-not-allowed, versioning. → *Lesson: consistent API contracts.*
- **2.6** **ADR-0003** (REST chosen) + Phase 2 course module + trackers.

## Phase 3 — Authentication & Security · ☐ Pending
- **3.1** Password hashing (argon2) + credentials on `User`. → *Lesson: password hashing done right.*
- **3.2** JWT access/refresh issuance + `RefreshToken` table (hashed). → *Lesson: JWT internals & token design.*
- **3.3** `register` / `login` / `me` endpoints. → *Lesson: the auth flow.*
- **3.4** Refresh rotation + reuse detection + `logout`. → *Lesson: refresh rotation & theft detection.*
- **3.5** `requireAuth` + RBAC middleware. → *Lesson: authorization & RBAC.*
- **3.6** Hardening: helmet, CORS (credentials), rate limiting. → *Lesson: OWASP baseline.*
- **3.7** **ADR-0004** (custom JWT vs Auth.js) + Phase 3 course module + trackers.

## Phase 4 — Caching & Read Performance (Redis) · ☐ Pending
- **4.1** Redis client + readiness wiring. → *Lesson: why a shared cache (not in-process).*
- **4.2** Cache-aside wrapper + TTL + stampede protection. → *Lesson: caching strategies & stampede.*
- **4.3** Cache catalog/lesson reads + ETags. → *Lesson: HTTP caching at the edge.*
- **4.4** Event-based cache invalidation. → *Lesson: invalidation is the hard part.*
- **4.5** **ADR-0005** (Redis cache-aside) + Phase 4 course module + trackers.

## Phase 5 — Concurrency & Consistency · ☐ Pending
- **5.1** `Idempotency-Key` middleware + store. → *Lesson: idempotency & safe retries.*
- **5.2** Optimistic concurrency helper (`version` → 409). → *Lesson: OCC vs pessimistic locking.*
- **5.3** Transactional scoring/XP + atomic increments. → *Lesson: transactions & atomicity.*
- **5.4** Redis Redlock utility for cross-request critical sections. → *Lesson: distributed locks (and their dangers).*
- **5.5** Concurrency integration tests (parallel duplicate requests → one effect). → *Lesson: testing race conditions.*
- **5.6** **ADR-0006** (idempotency + OCC + locks) + Phase 5 course module + trackers.

## Phase 6 — Async Processing & Queues (BullMQ) · ☐ Pending
- **6.1** BullMQ queues + `src/worker.ts` entrypoint. → *Lesson: sync vs async; why a queue.*
- **6.2** Sample job + retries/backoff/dead-letter. → *Lesson: retries, backoff, DLQ.*
- **6.3** Idempotent job handlers. → *Lesson: at-least-once & idempotent consumers.*
- **6.4** **ADR-0007** (BullMQ now, not Kafka) + Phase 6 course module + trackers.

## Phase 7 — Event-Driven Architecture & Outbox · ☐ Pending
- **7.1** `OutboxEvent` table + typed event contracts. → *Lesson: the dual-write problem.*
- **7.2** Transactional event write (same tx as the change). → *Lesson: transactional outbox.*
- **7.3** Outbox relay worker → queue. → *Lesson: reliable delivery.*
- **7.4** First subscribers (award XP on `LessonCompleted`). → *Lesson: decoupling via events.*
- **7.5** **ADR-0008** (transactional outbox) + Phase 7 course module + trackers.

## Phase 8 — Notifications (multi-channel, realtime-ready) · ☐ Pending
- **8.1** `Notification` model + `Notifier` port + in-app adapter. → *Lesson: ports & adapters.*
- **8.2** Event→notification subscribers + bell/history API. → *Lesson: event-driven notifications.*
- **8.3** Realtime gateway scaffold (WebSocket + Redis pub/sub) behind a flag. → *Lesson: scaling WebSockets.*
- **8.4** Channel preferences model. → *Lesson: user notification preferences.*
- **8.5** **ADR-0009** (ports/adapters + realtime) + Phase 8 course module + trackers.

## Phase 9 — Quizzes & Timed Assessments · ☐ Pending
- **9.1** `Quiz` + `QuizAttempt` models (`deadlineAt`, `version`). → *Lesson: modeling timed attempts.*
- **9.2** Start-attempt endpoint (server-set deadline, single-active via lock). → *Lesson: server-authoritative time.*
- **9.3** Submit endpoint (deadline enforcement, idempotent, transactional scoring) → emits event. → *Lesson: safe submissions under concurrency.*
- **9.4** Sweeper job auto-finalizes expired attempts. → *Lesson: scheduled reconciliation.*
- **9.5** Contest mode + Redis sorted-set leaderboard (behind flag). → *Lesson: live leaderboards & fan-out.*
- **9.6** Concurrency + timing tests. → *Lesson: testing time & races.*
- **9.7** **ADR-0010** (server-authoritative timing) + Phase 9 course module + trackers.

## Phase 10 — Messaging at Scale (Kafka) · ☐ Pending
- **10.1** Kafka in compose + client setup. → *Lesson: log-based messaging vs queues.*
- **10.2** Outbox → Kafka producer. → *Lesson: streaming events out.*
- **10.3** Consumer group (analytics / search indexer). → *Lesson: partitions & consumer groups.*
- **10.4** Schema discipline + idempotent consumers. → *Lesson: ordering & exactly-once-ish.*
- **10.5** **ADR-0011** (Kafka graduation criteria) + Phase 10 course module + trackers.

## Phase 11 — Search & Content Delivery · ☐ Pending
- **11.1** Postgres full-text search indexes (`tsvector`). → *Lesson: FTS basics.*
- **11.2** Search endpoint (ranking + pagination). → *Lesson: relevance & ranking.*
- **11.3** Event-driven index updates (read model). → *Lesson: CQRS-lite read models.*
- **11.4** **ADR-0012** (Postgres FTS vs search engine) + Phase 11 course module + trackers.

## Phase 12 — Observability & Operations · ☐ Pending
- **12.1** OpenTelemetry tracing + correlation propagation. → *Lesson: traces & the 3 pillars.*
- **12.2** Metrics (RED/USE) + exporter. → *Lesson: what to measure.*
- **12.3** Dashboards, alerts, SLOs doc. → *Lesson: SLOs & alerting.*
- **12.4** **ADR-0013** (observability stack) + Phase 12 course module + trackers.

## Phase 13 — Testing & Quality · ☐ Pending
- **13.1** Vitest + supertest + Testcontainers setup. → *Lesson: the test pyramid.*
- **13.2** Auth lifecycle + authz integration tests. → *Lesson: integration testing.*
- **13.3** Concurrency test suite. → *Lesson: proving race-safety.*
- **13.4** k6 load test on the submission path. → *Lesson: load testing.*
- **13.5** CI coverage gate. → *Lesson: quality gates.*
- **13.6** **ADR-0014** (testing strategy) + Phase 13 course module + trackers.

## Phase 14 — Containerization (Docker) · ☐ Pending
- **14.1** Multi-stage production `Dockerfile` (non-root, slim/distroless). → *Lesson: multi-stage builds.*
- **14.2** Full `docker-compose` (api, worker, postgres, pgbouncer, redis, kafka). → *Lesson: orchestrating the stack.*
- **14.3** Image hardening + healthchecks + `.dockerignore`. → *Lesson: image security & size.*
- **14.4** **ADR-0015** (container strategy) + Phase 14 course module + trackers.

## Phase 15 — CI/CD, Deployment & Scaling · ☐ Pending
- **15.1** GitHub Actions CI (lint, typecheck, test, build image). → *Lesson: CI pipelines.*
- **15.2** PgBouncer pooling + read-replica config. → *Lesson: scaling the database.*
- **15.3** Deploy config (PaaS) + `migrate deploy` release step. → *Lesson: deploys & migrations.*
- **15.4** Zero-downtime (expand-contract) + scaling runbook. → *Lesson: zero-downtime & autoscaling.*
- **15.5** **ADR-0016** (deploy & scale) + Phase 15 course module + trackers.

---

## Milestones

- **A — Shippable MVP:** Phases 0–5 (accounts, catalog APIs, progress, caching, correct concurrency).
- **B — Reactive platform:** Phases 6–9 (queues, events/outbox, notifications, timed quizzes).
- **C — Scale & streaming:** Phases 10–11 (Kafka, search).
- **D — Production excellence:** Phases 12–15 (observability, testing/load, Docker, CI/CD & scaling).

## Progress summary

| Phase | Tasks | Done | Status |
|---|---|---|---|
| 0 — Foundations | 8 | 2 | 🟡 In progress |
| 1 — Data modeling | 6 | 0 | ☐ |
| 2 — API design | 6 | 0 | ☐ |
| 3 — Auth & security | 7 | 0 | ☐ |
| 4 — Caching (Redis) | 5 | 0 | ☐ |
| 5 — Concurrency | 6 | 0 | ☐ |
| 6 — Queues (BullMQ) | 4 | 0 | ☐ |
| 7 — Events & outbox | 5 | 0 | ☐ |
| 8 — Notifications | 5 | 0 | ☐ |
| 9 — Timed quizzes | 7 | 0 | ☐ |
| 10 — Kafka | 5 | 0 | ☐ |
| 11 — Search | 4 | 0 | ☐ |
| 12 — Observability | 4 | 0 | ☐ |
| 13 — Testing | 6 | 0 | ☐ |
| 14 — Docker | 4 | 0 | ☐ |
| 15 — CI/CD & scaling | 5 | 0 | ☐ |

_Last updated: Task 0.2 complete — config loader with fail-fast zod validation._
