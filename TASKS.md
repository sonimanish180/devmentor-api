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

## Phase 0 — Foundations & Project Setup  · ✅ Complete

### Task 0.1 — Initialize the project · ✅ Done
- **Prompt:** "Create `devmentor-api` baseline: `package.json` (pnpm + scripts), `tsconfig.json` (strict, CommonJS), `.gitignore`, `.env.example`, `eslint.config.mjs`, and the `src/{config,lib,middleware,modules,events}` + `tests` + `docs/adr` folder skeleton."
- **What was done:** Created `package.json` (Express + zod + pino; tsx/vitest/eslint dev deps; scripts: dev/build/start/worker/typecheck/lint/test), `tsconfig.json` (ES2022, CommonJS, strict, `noUncheckedIndexedAccess`), `.gitignore`, `.env.example` (with a forward map of later-phase vars), `eslint.config.mjs` (flat config + typescript-eslint), and the module folder skeleton with `.gitkeep`s.
- **Course update:** None yet (no teachable runtime concept). First lessons land in Task 0.8.

### Task 0.2 — Config loader with env validation · ✅ Done
- **Prompt:** "Add `src/config/env.ts`: load env, validate with zod (NODE_ENV, PORT, LOG_LEVEL), fail fast with a clear error on invalid/missing config, and export a typed, frozen `env` object."
- **What was done:** Added `src/config/env.ts` — a zod schema for `NODE_ENV` (enum, default `development`), `PORT` (`z.coerce.number().int().positive().max(65535)`, default `4000`), and `LOG_LEVEL` (enum, default `info`). `loadEnv()` uses `safeParse`; on failure it prints each invalid/missing field and `process.exit(1)` (fail fast); on success it returns a `Object.freeze`'d, typed `env`. Also exports `isProduction` / `isTest`. Verified in an isolated project: `tsc --noEmit` passes, defaults resolve (4000/development/info), invalid values (`PORT=-3`, `LOG_LEVEL=loud`) print clear errors and exit 1, valid overrides work. Removed `src/config/.gitkeep`.
- **Course update:** ✅ Lesson drafted in `docs/course-notes.md` → *12-Factor Config & Fail-Fast Validation* (wired into the app track at Task 0.8).

### Task 0.3 — Structured logging + request IDs · ✅ Done
- **Prompt:** "Add `src/lib/logger.ts` (pino) and `pino-http` request logging with a per-request correlation id propagated on `req`/responses."
- **What was done:** Added `src/lib/logger.ts` — a pino logger at `env.LOG_LEVEL` with secret **redaction** (authorization/cookie/set-cookie headers, `*.password`, `*.token`). Added `src/middleware/httpLogger.ts` — `pino-http` with `genReqId` that reuses an incoming `x-request-id` or generates a UUID, **echoes it on the response header**, and binds it to `req.id`/`req.log`; `customLogLevel` maps 5xx→error, 4xx→warn, else info. Verified in an isolated project: `tsc --noEmit` passes; runtime test confirms a generated id is echoed and `body.id === x-request-id`, an inbound `x-request-id: trace-abc-123` is reused, and request/response lines are structured JSON sharing the id. Removed `src/lib/.gitkeep` and `src/middleware/.gitkeep`.
- **Course update:** ✅ Lesson drafted in `docs/course-notes.md` → *Structured Logging & Correlation IDs* (wired into the app track at Task 0.8).

### Task 0.4 — Express app factory + error handling · ✅ Done
- **Prompt:** "Add `src/app.ts` building the Express app (json, security middleware placeholders), an `AppError` class, a centralized error handler returning a consistent JSON envelope, and a 404 handler."
- **What was done:** Added `src/lib/AppError.ts` (typed operational error with `statusCode`/`code`/`details`/`isOperational` + static helpers: badRequest/unauthorized/forbidden/notFound/conflict/tooManyRequests/internal), `src/lib/asyncHandler.ts` (forwards async rejections to `next`), `src/middleware/notFound.ts` (unmatched routes → 404 `AppError`), `src/middleware/errorHandler.ts` (renders one envelope `{ error: { code, message, details?, requestId } }`; maps `AppError` + `ZodError`; unknown errors → 500 with message hidden when `NODE_ENV=production`; logs 5xx as error / 4xx as warn via `req.log`), and `src/app.ts` (`createApp()` factory with deliberate middleware order: httpLogger → json → [security later] → routes → notFound → errorHandler; `x-powered-by` disabled). Verified: `tsc --noEmit` passes; live run shows `/ok`→200, `/bad`→400 (BAD_REQUEST + details), `/boom`→500 (generic message in prod, real error logged), `/async`→409, `/nope`→404 — all with a `requestId`.
- **Course update:** ✅ Lesson drafted in `docs/course-notes.md` → *App Composition & a Consistent Error Model* (wired into the app track at Task 0.8).

### Task 0.5 — Health & readiness endpoints · ✅ Done
- **Prompt:** "Add `/health` (liveness) and `/ready` (dependency checks — stubbed now, extended as Postgres/Redis are added) endpoints."
- **What was done:** Added `src/modules/health/readiness.ts` — a dependency-free **check registry** (`registerReadinessCheck`, `runReadinessChecks`) that runs checks in parallel and reports per-dependency up/down. Added `src/modules/health/health.routes.ts` — `GET /health` (liveness: status/uptime/timestamp, no deps) and `GET /ready` (runs the registry; **503 `not_ready`** if any check fails, else 200 `ready`). Mounted `healthRouter` early in `createApp()` (before future auth/rate-limit). Verified: `tsc --noEmit` passes; live run shows `/health`→200, `/ready`→200 with no checks, and `/ready`→503 once a failing `redis` check is registered (with `{postgres: up, redis: down}` detail). Removed `src/modules/.gitkeep`.
- **Course update:** ✅ Lesson drafted in `docs/course-notes.md` → *Liveness vs Readiness Probes* (wired into the app track at Task 0.8).

### Task 0.6 — Server entrypoint + graceful shutdown · ✅ Done
- **Prompt:** "Add `src/server.ts` that starts the HTTP server and handles SIGTERM/SIGINT by draining in-flight requests before exit; wire `pnpm dev`."
- **What was done:** Added `src/lib/shutdown.ts` — a LIFO shutdown-hook registry (`onShutdown`/`runShutdownHooks`) for DB/Redis/workers to close into in later phases. Added `src/server.ts` — boots `createApp()` on `env.PORT`; on SIGTERM/SIGINT it stops accepting new connections (`server.close`), lets in-flight requests finish, calls `server.closeIdleConnections()` to free idle keep-alives, runs shutdown hooks, and exits — with a 10s force-exit safety net; also logs `unhandledRejection` and exits on `uncaughtException`. (`pnpm dev` already runs `tsx watch src/server.ts`.) Verified: `tsc --noEmit` passes; real `server.ts` serves `/health` then on SIGTERM logs "draining"→"Shutdown complete" and exits 0; a drain test showed an 827ms in-flight request **completed (200)** despite SIGTERM at ~200ms while new requests were refused, then the process exited 0.
- **Course update:** ✅ Lesson drafted in `docs/course-notes.md` → *Graceful Shutdown* (wired into the app track at Task 0.8).

### Task 0.7 — Local Docker stack · ✅ Done
- **Prompt:** "Add `docker-compose.yml` (Postgres + Redis with healthchecks), a dev `Dockerfile`, and `.dockerignore`. Confirm `docker compose up` is green."
- **What was done:** Added `docker-compose.yml` — `postgres:16-alpine` and `redis:7-alpine`, both with **healthchecks** (`pg_isready` / `redis-cli ping`), pinned versions, named volumes (`pgdata`, `redisdata`), and port mappings 5432/6379. Added a dev `Dockerfile` (node:20-alpine + corepack pnpm, layer-cached install, `pnpm dev`) and `.dockerignore` (excludes node_modules/dist/.git/.env/logs/docs). The API runs on the host in dev; full containerized stack is deferred to Phase 14.
- **Verification note:** Compose YAML validated (services, healthchecks, volumes parsed OK). **Docker isn't available in the build sandbox**, so `docker compose up` must be confirmed green on the host: `docker compose up -d && docker compose ps` → both `healthy`.
- **Course update:** ✅ Lesson drafted in `docs/course-notes.md` → *Reproducible Local Environments with Docker Compose* (wired into the app track at Task 0.8).

### Task 0.8 — ADR-0001 + create the course track · ✅ Done
- **Prompt:** "Write `docs/adr/0001-foundational-stack.md` (Express+TS, CommonJS, pnpm, modular monolith — problem/options/decision/consequences). Create `devmentor/src/data/backend-build-curriculum.ts` with the Phase 0 module (intro + the lessons above), register it in `curriculum.ts` + a home-page tab + `/docs` if relevant. Update README tracker + ADR index. `tsc --noEmit` clean."
- **What was done:** Wrote `docs/adr/0001-foundational-stack.md` (Express+TS, CommonJS, pnpm, modular monolith — full problem/options/decision/consequences). Created the **"Build a Scalable Backend (0 → 1)"** track at `devmentor/src/data/backend-build-curriculum.ts` — module `bb-foundations` with **7 lessons** (intro + config, logging, error model, health/readiness, graceful shutdown, Docker) authored from `docs/course-notes.md` in the Problem → Options → Decision → Implementation → Pitfalls → Quiz shape (10 quiz questions, ~510 XP). Registered in `curriculum.ts` (`allModules`) and the home page (new **Backend 0→1** tab + track section + stats/track count). Updated README phase tracker (Phase 0 ✅) + ADR index (ADR-0001). Verified `tsc --noEmit` passes in `devmentor`. **Phase 0 complete (8/8).**
- **Course update:** ✅ Track created + Phase 0 module live in the app.

---

## Phase 1 — Data Modeling & Persistence · ✅ Complete
- **1.1** ✅ **Done** — Add Prisma, datasource, connect to Postgres; `pnpm prisma` scripts. *What was done:* added `@prisma/client`/`prisma` deps + `db:generate`/`db:migrate`/`db:deploy`/`db:studio`/`prisma` scripts; `prisma/schema.prisma` (postgresql datasource + client generator, no models yet); `src/lib/prisma.ts` (singleton `PrismaClient` cached on `globalThis` in dev, `registerPrismaHooks()` adding a `SELECT 1` readiness check + `$disconnect` shutdown hook); made `DATABASE_URL` a required env var; activated it in `.env.example`; wired `registerPrismaHooks()` into `server.ts`. **Verify:** `tsc --noEmit` passes. ⚠️ Prisma engine binaries are blocked in the build sandbox, so run on host: `pnpm install && docker compose up -d && pnpm db:generate` then start the server and confirm `GET /ready` reports `postgres: up`. → *Lesson captured: choosing Prisma; the client singleton.*
- **1.2** ✅ **Done** — Schema: `User`, `UserStats`. *What was done:* added `User` (cuid id, unique `email`, optional `name`, `createdAt`/`updatedAt`) and `UserStats` as a **1:1** (`userId @id` + relation, `onDelete: Cascade`) holding `totalXP`/`streak`/`lastActiveDate`/`currentModule`/`currentLesson`/`updatedAt`; back-relation `stats UserStats?` on `User`. **Verify:** structural check passed (balanced braces, unique email, PK=FK 1:1, cascade, back-relation). ⚠️ Prisma engines blocked in sandbox — validate via `pnpm db:migrate` on host (creates the migration). → *Lesson captured: modeling users & derived stats (1:1).*
- **1.3** ✅ **Done** — Schema: `Course`, `Module`, `Lesson` (JSONB content blocks), `Enrollment`, `LessonCompletion`, `QuizScore`. *What was done:* normalized `Course → Module → Lesson` (cuid ids, `@@unique([courseId,slug])`/`@@unique([moduleId,slug])`, FK indexes, `order`, `published`); `Lesson.blocks` + `Lesson.quiz` as **JSONB**; `Level` enum; progress join tables `LessonCompletion` & `QuizScore` with **composite PKs** (`@@id([userId,lessonId])`) for idempotent upserts; back-relations added to `User`; cascade deletes throughout. **Verify:** structural relation/back-relation consistency check passed (8 models, 2 composite PKs, 3 `@@unique`, JSONB blocks/quiz, 9 cascades). ⚠️ Prisma engines blocked in sandbox — validate via `pnpm db:migrate` on host. → *Lesson captured: normalized structure + JSONB content + progress join tables.*
- **1.4** ✅ **Done** — Migrations + seed script (sample courses/lessons). *What was done:* added `prisma/seed.ts` — an **idempotent** seed (all upserts) creating a demo user + stats, a published `sample-backend` course → `foundations` module → two JSONB-content lessons (+quiz), an enrollment, a lesson completion, and a quiz score (exercises every table incl. composite-PK upserts). Wired seeding via `package.json` `prisma.seed` + `db:seed` script. **Verify:** package.json valid (seed config present); `seed.ts` transpiles cleanly (esbuild, `@prisma/client` external). ⚠️ Run on host: `pnpm db:migrate` (creates/applies the first migration) then `pnpm db:seed`. → *Lesson captured: migrations & idempotent seeding.*
- **1.5** ✅ **Done** — Repository layer + keyset pagination helper. *What was done:* added `src/lib/pagination.ts` (keyset/cursor pagination — opaque base64url cursor, `normalizeLimit` capped at 100/default 20, `keysetParams` fetching `limit+1` to detect `hasMore` without a COUNT, generic `buildPage`); added `src/modules/course/course.repository.ts` (`listPublishedCourses` keyset-paginated; `getCourseBySlug` using nested `include` to avoid N+1, with `select` to drop heavy JSONB `blocks` from list views). **Verify:** `pagination.ts` fully typechecks (strict) + behavioral test passed (limit cap, cursor roundtrip, hasMore/nextCursor, take=limit+1); repository transpiles cleanly (esbuild). → *Lesson captured: pagination at scale (keyset) & the N+1 problem.*
- **1.6** ✅ **Done** — **ADR-0002** (Postgres + Prisma, normalized + JSONB) + Phase 1 course module + trackers. *What was done:* wrote `docs/adr/0002-postgres-prisma-data-modeling.md` (SQL vs NoSQL, Prisma, normalized + JSONB, idempotent progress — full problem/options/decision/consequences); added the **`bb-data-modeling`** module (Phase 1) to `backend-build-curriculum.ts` with **5 lessons** (Prisma/connection, user 1:1, normalized+JSONB, migrations/seeding, pagination/N+1) authored from `course-notes.md`; auto-registered via the existing track export + home tab. Updated README phase tracker (Phase 1 ✅) + ADR index. Verified `tsc --noEmit` passes in `devmentor`. **Phase 1 complete (6/6).**

## Phase 2 — API Design & Validation · ✅ Complete
- **2.1** ✅ **Done** — REST conventions, `/api/v1` router mounting, OpenAPI setup. *What was done:* added `src/api/openapi.ts` (base OpenAPI 3.0.3 document with the shared `Error` schema + `registerPath` helper) and `src/api/router.ts` (versioned `apiRouter`: `GET /` discovery, `GET /openapi.json` contract, `GET /docs` Redoc UI from CDN — no new deps; documented REST conventions); mounted at `/api/v1` in `createApp()`. **Verify:** `tsc --noEmit` passes; live run — `/api/v1` 200 meta, `/api/v1/openapi.json` 200 (Error schema present), `/api/v1/docs` 200 html, unknown route 404 via the shared envelope with `requestId`. → *Lesson captured: versioned REST surface & the OpenAPI contract.*
- **2.2** ✅ **Done** — zod validation middleware + DTO pattern. *What was done:* added `src/middleware/validate.ts` (a `validate({ body?, query?, params? })` factory that parses all three in one pass for full error reporting, coerces and writes values back, and forwards failures to the error handler as 400 `VALIDATION_ERROR`); added `src/api/schemas.ts` with the `paginationQuery` DTO (`z.coerce.number().max(100)`) + inferred `PaginationQuery` type. **Verify:** `tsc --noEmit` passes; live run — valid POST coerced `age "30"→30` (number), invalid POST → 400 with both field errors, `?limit=25`→ number 25, `?limit=999`→ 400 (max 100). → *Lesson captured: validate at the edge & the DTO pattern.*
- **2.3** ✅ **Done** — Course catalog endpoints (list/detail) with pagination + filtering. *What was done:* added the layered course module — `course.service.ts` (business rules: published-only, 404 for missing/unpublished without leaking existence), `course.controller.ts` (thin HTTP adapters), `course.schema.ts` (`courseSlugParams` DTO), `course.openapi.ts` (registers `/courses` + `/courses/{slug}` into the contract), `course.routes.ts` (`GET /` keyset-paginated via `paginationQuery`, `GET /:slug`); mounted at `/api/v1/courses` in `api/router.ts`. **Verify:** prisma-free files typecheck; OpenAPI registration confirmed at runtime (`/courses` w/ cursor+limit params + Error-referencing 400, `/courses/{slug}`); all DB-touching files syntax-check (esbuild). ⚠️ Full typecheck + live endpoints on host after `pnpm db:generate` (then `GET /api/v1/courses`). → *Lesson captured: serving the catalog — layered endpoints.*
- **2.4** ✅ **Done** — Lesson content endpoints. *What was done:* added the `lesson` module — `lesson.repository.ts` (`getLessonById` returning full content + parent `course.published` in one `include` query), `lesson.service.ts` (visibility check → uniform 404), `lesson.controller.ts`, `lesson.schema.ts` (`lessonIdParams`), `lesson.openapi.ts` (registers `/lessons/{id}`), `lesson.routes.ts` (`GET /:id`); mounted at `/api/v1/lessons`. Catalog stays lightweight (blocks omitted via `select`); detail-by-id carries the heavy JSONB blocks/quiz. **Verify:** prisma-free files typecheck; OpenAPI `/lessons/{id}` registered (id param, Error-referencing 404); DB-touching files syntax-check. ⚠️ Live verify on host: `GET /api/v1/lessons/<id>`. → *Lesson captured: resource shape — list vs detail.*
- **2.5** ✅ **Done** — Error envelope, 404 / method-not-allowed, versioning. *What was done:* added `src/middleware/methodNotAllowed.ts` (sets `Allow` header, throws 405 `METHOD_NOT_ALLOWED`), wired `router.all(...)` after the GET handlers on course (`/`, `/:slug`) and lesson (`/:id`) routes; extended `errorHandler` to map express.json `SyntaxError` → **400 `INVALID_JSON`**; added a `GET /api` version index. **Verify:** `tsc --noEmit` passes; live run — GET 200, POST→405 (`Allow: GET`), malformed JSON→400 INVALID_JSON, `/api` index 200, unknown path→404, all in the uniform envelope. → *Lesson captured: finishing the contract edges — 405, malformed input, versioning.*
- **2.6** ✅ **Done** — **ADR-0003** (REST chosen) + Phase 2 course module + trackers. *What was done:* wrote `docs/adr/0003-rest-api-style.md` (REST vs GraphQL vs tRPC — full problem/options/decision/consequences); added the **`bb-api-design`** module (Phase 2) to `backend-build-curriculum.ts` with **5 lessons** (versioned REST/OpenAPI, validate+DTO, layered endpoints, list vs detail, contract edges) from `course-notes.md`; auto-registered via the track export + home tab. Updated README phase tracker (Phase 2 ✅) + ADR index. Verified `tsc --noEmit` passes in `devmentor`. **Phase 2 complete (6/6).**

## Phase 3 — Authentication & Security · ✅ Complete
- **3.1** ✅ **Done** — Password hashing (argon2) + credentials on `User`. *What was done:* added `argon2` dep; added nullable `passwordHash` to the `User` model; created `src/modules/auth/password.ts` (`hashPassword`/`verifyPassword` using **argon2id**, OWASP params ~19MiB/t2/p1, fails closed on malformed hash); seeded the demo user with a dev password (`password123`). **Verify (full):** argon2 installed + ran in sandbox — hash is `$argon2id$…`, verify correct→true / wrong→false / garbage→false (no throw), salts random (two hashes differ); `password.ts` typechecks; schema + seed checks pass. ⚠️ Host: `pnpm install` (builds argon2 native) + `pnpm db:migrate`. → *Lesson captured: password hashing done right (argon2id).*
- **3.2** ✅ **Done** — JWT access/refresh issuance + `RefreshToken` table (hashed). *What was done:* added `jsonwebtoken` (+types); env vars `JWT_ACCESS_SECRET`/`ACCESS_TOKEN_TTL_SECONDS`/`REFRESH_TOKEN_TTL_DAYS` (+ `.env.example`); `RefreshToken` model (`tokenHash @unique`, `expiresAt`, `revokedAt`) + `User.refreshTokens`; `src/modules/auth/tokens.ts` (`signAccessToken`/`verifyAccessToken` short-lived JWT; `generateRefreshToken` opaque 256-bit + sha256 hash; `hashToken`; `refreshTokenExpiry`). **Verify (full):** typecheck passes; runtime — JWT roundtrip ok, tampered token rejected, refresh token 43-char base64url, hash sha256-hex deterministic & ≠ token, expiry ~7d; schema checks pass. ⚠️ Host: `pnpm install` + `pnpm db:migrate`. → *Lesson captured: two-token auth (access JWT + opaque hashed refresh).*
- **3.3** ✅ **Done** — `register` / `login` / `me` endpoints. *What was done:* `auth.repository.ts` (find/create user, create/find/revoke refresh tokens), `auth.service.ts` (register hashes+creates+issues tokens; login with **uniform** invalid-credentials error; getMe), `auth.schema.ts`, `auth.controller.ts` (access token in body, refresh token in **httpOnly cookie** scoped to `/api/v1/auth`; 201 on register), `auth.openapi.ts`, `auth.routes.ts`; mounted at `/api/v1/auth`. → *Lesson captured: the auth flow.*
- **3.4** ✅ **Done** — Refresh rotation + reuse detection + `logout`. *What was done:* `auth.service.refresh` rotates (revoke old → issue new) and on a **revoked-token replay** revokes **all** the user's tokens (theft response); expiry checked; `logout` revokes current; `/auth/refresh` + `/auth/logout` routes read/clear the cookie. → *Lesson captured: rotation & reuse detection.*
- **3.5** ✅ **Done** — `requireAuth` + RBAC middleware. *What was done:* `src/middleware/requireAuth.ts` (stateless Bearer JWT verify → `req.auth = { userId, role }`; `requireRole(...)`), role added to the access-token payload + `Role` enum/`User.role` in schema, `src/types/express.d.ts` augmentation; `/auth/me` guarded. **Verify (full runtime):** no token→401, USER→200 with req.auth, ADMIN-only+USER→403, ADMIN→200. → *Lesson captured: stateless auth middleware & RBAC.*
- **3.6** ✅ **Done** — Hardening: helmet, CORS (credentials), rate limiting. *What was done:* `app.ts` now uses **helmet**, **cors** (`origin: CORS_ORIGIN`, `credentials: true`), **cookie-parser**, `trust proxy`, and `authRateLimiter` (`src/middleware/rateLimit.ts`, express-rate-limit → 429 via envelope) on `/api/v1/auth`; `CORS_ORIGIN` env added. **Verify:** rate limiter → 429 after 20 hits (runtime). → *Lesson captured: security hardening.*
- **3.7** ✅ **Done** — **ADR-0004** (custom JWT vs Auth.js) + Phase 3 course module + trackers. *What was done:* wrote `docs/adr/0004-custom-jwt-auth.md`; added the **`bb-auth-security`** module (Phase 3) with **6 lessons** (password hashing, two-token auth, auth flow, rotation/reuse, RBAC, hardening) to `backend-build-curriculum.ts`; updated README + ADR index; `tsc --noEmit` passes in `devmentor`. **Verify:** whole prisma-free surface typechecks; DB-touching auth files syntax-check. ⚠️ Host: `pnpm install` + `pnpm db:migrate` (adds `role`, `RefreshToken`), then exercise register/login/refresh/me. **Phase 3 complete (7/7).**

## Phase 4 — Caching & Read Performance (Redis) · ✅ Complete
- **4.1** ✅ **Done** — Redis client + readiness wiring. *What was done:* `ioredis` dep + `REDIS_URL` env; `src/lib/redis.ts` (singleton client cached on globalThis in dev; `registerRedisHooks` → `PING` readiness + `quit` shutdown); wired in `server.ts`. → *Lesson captured: why a shared cache (not in-process).*
- **4.2** ✅ **Done** — Cache-aside wrapper + TTL + stampede protection. *What was done:* `src/lib/cache.ts` (`cacheAside(key, ttl, loader)` with per-process **single-flight** + Redis `SET NX` **lock**; `invalidate`, `invalidateByPrefix` via SCAN) + `src/lib/cacheKeys.ts`. **Verify (full runtime, ioredis-mock):** 2 reads → 1 loader call; 6 concurrent misses → 1 loader call; invalidate → reload. → *Lesson captured: cache-aside & stampede protection.*
- **4.3** ✅ **Done** — Cache catalog/lesson reads + ETags. *What was done:* `course.service`/`lesson.service` reads wrapped in `cacheAside` (list 60s, detail 300s); `src/middleware/cacheControl.ts` added to course/lesson GET routes; relies on Express weak ETag → 304. → *Lesson captured: HTTP caching (Cache-Control & ETags).*
- **4.4** ✅ **Done** — Event-based cache invalidation. *What was done:* `invalidateCourse(slug)` (detail + list prefix) and `invalidateLesson(id)` exported from the services, to be triggered by write paths / Phase 7 events; SCAN-based prefix clear. → *Lesson captured: cache invalidation.*
- **4.5** ✅ **Done** — **ADR-0005** (Redis cache-aside) + Phase 4 course module + trackers. *What was done:* wrote `docs/adr/0005-redis-cache-aside.md`; added the **`bb-caching`** module (4 lessons) to `backend-build-curriculum.ts`; README + ADR index updated; `tsc --noEmit` passes in `devmentor`. **Verify:** cache/redis files typecheck (with express); service edits syntax-check. ⚠️ Host: `pnpm install` + `docker compose up -d` (Redis) then `GET /api/v1/courses` twice (2nd served from cache; `/ready` shows `redis: up`). **Phase 4 complete (5/5).**

## Phase 5 — Concurrency & Consistency · ✅ Complete
- **5.1** ✅ **Done** — `Idempotency-Key` middleware + store. *What was done:* `src/middleware/idempotency.ts` — dedupes retried POSTs per-user via Redis (stores 2xx response keyed by user+method+path+key, replays with `Idempotent-Replay` header). Applied to `POST /progress/lessons/:id/complete`. **Verify (runtime):** 2 requests, same key → handler ran once, identical body, second replayed. → *Lesson captured: idempotency keys.*
- **5.2** ✅ **Done** — Optimistic concurrency helper (`version` → 409). *What was done:* `src/lib/occ.ts` `occUpdate(run)` → throws 409 `CONFLICT` when a versioned `updateMany` affects 0 rows (feeds Phase 9 `QuizAttempt.version`). **Verify (runtime):** count=1 ok, count=0 → 409. Unit tests in `tests/concurrency.test.ts`. → *Lesson captured: OCC.*
- **5.3** ✅ **Done** — Transactional scoring/XP + atomic increments. *What was done:* `progress` module — `completeLesson` in a `$transaction` (create completion + atomic `totalXP` increment); composite-PK unique violation → treated as "already completed" so XP is **exactly-once** under concurrency; `getProgress`; controller/routes/schema/openapi; mounted `/api/v1/progress`. → *Lesson captured: transactions & atomic increments.*
- **5.4** ✅ **Done** — Redis distributed lock. *What was done:* `src/lib/lock.ts` `withLock(key, ttlMs, fn)` — `SET NX PX` acquire + token-checked Lua release; throws 409 if busy. **Verify (runtime):** concurrent `withLock` → 1 ran, 1 conflict. → *Lesson captured: distributed locks.*
- **5.5** ✅ **Done** — Concurrency tests. *What was done:* `tests/concurrency.test.ts` — OCC unit tests (run anywhere) + a gated integration test firing **10 parallel** completes asserting exactly one XP award (`RUN_DB_TESTS=1` on host). **Verify:** primitives runtime-tested here; full suite via `pnpm test` on host. → *Lesson captured: testing concurrency.*
- **5.6** ✅ **Done** — **ADR-0006** + Phase 5 course module + trackers. *What was done:* `docs/adr/0006-concurrency-strategy.md`; **`bb-concurrency`** module (5 lessons) added to `backend-build-curriculum.ts`; README + ADR index updated; `tsc --noEmit` passes in `devmentor`; clean typecheck of the whole prisma-free surface incl. the new primitives. **Phase 5 complete (6/6).**

## Phase 6 — Async Processing & Queues (BullMQ) · ✅ Complete
- **6.1** ✅ **Done** — BullMQ queues + `src/worker.ts` entrypoint. *What was done:* `bullmq` dep; `src/queues/connection.ts` (BullMQ Redis connection, `maxRetriesPerRequest: null`); `src/queues/email.queue.ts` (`email` Queue + `enqueueWelcomeEmail`); `src/worker.ts` (separate process, graceful drain via `worker.close()`); registration now enqueues a welcome email (non-fatal); API closes the queue on shutdown. → *Lesson captured: async processing with a job queue.*
- **6.2** ✅ **Done** — Sample job + retries/backoff/dead-letter. *What was done:* queue `defaultJobOptions` — `attempts: 3`, exponential `backoff`, `removeOnComplete`, `removeOnFail` retained (failed set = DLQ); worker `failed`/`completed` listeners log outcomes. → *Lesson captured: retries, backoff & dead-letter.*
- **6.3** ✅ **Done** — Idempotent job handlers. *What was done:* `email.worker.ts` guards the side-effect with a Redis `SET NX` marker (at-least-once safe) and `enqueueWelcomeEmail` uses `jobId = welcome:<userId>` to dedupe enqueues. **Verify (runtime):** 1st→sent, retry→skipped-duplicate, other user→sent. → *Lesson captured: idempotent handlers (at-least-once).*
- **6.4** ✅ **Done** — **ADR-0007** (BullMQ now, not Kafka — with explicit Kafka graduation criteria) + Phase 6 course module (3 lessons: `bb-queues`) + trackers. **Verify:** BullMQ queue/worker/connection typecheck; auth.service + server syntax-check; `tsc --noEmit` passes in `devmentor`. ⚠️ Host: `pnpm install` + `docker compose up -d`, run `pnpm worker` alongside `pnpm dev`; register a user → worker logs "sent welcome email". **Phase 6 complete (4/4).**

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
| 0 — Foundations | 8 | 8 | ✅ Complete |
| 1 — Data modeling | 6 | 6 | ✅ Complete |
| 2 — API design | 6 | 6 | ✅ Complete |
| 3 — Auth & security | 7 | 7 | ✅ Complete |
| 4 — Caching (Redis) | 5 | 5 | ✅ Complete |
| 5 — Concurrency | 6 | 6 | ✅ Complete |
| 6 — Queues (BullMQ) | 4 | 4 | ✅ Complete |
| 7 — Events & outbox | 5 | 0 | ☐ |
| 8 — Notifications | 5 | 0 | ☐ |
| 9 — Timed quizzes | 7 | 0 | ☐ |
| 10 — Kafka | 5 | 0 | ☐ |
| 11 — Search | 4 | 0 | ☐ |
| 12 — Observability | 4 | 0 | ☐ |
| 13 — Testing | 6 | 0 | ☐ |
| 14 — Docker | 4 | 0 | ☐ |
| 15 — CI/CD & scaling | 5 | 0 | ☐ |

_Last updated: Phase 6 complete (Tasks 6.1–6.4) — BullMQ job queue + separate worker, retries/backoff/DLQ, idempotent at-least-once handlers, welcome-email offload, ADR-0007 + Phase 6 course module. Next: Phase 7 — Event-Driven Architecture & Outbox._
