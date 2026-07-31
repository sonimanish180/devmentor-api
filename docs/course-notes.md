# Course content — captured as we build

Running capture of teachable content, **one entry per completed task**, in the lesson shape
**Problem → Options → Decision & Why → Implementation → Pitfalls → Quiz**. At **Task 0.8** these
are wired into the DevMentor app as the "Build a Scalable Backend (0 → 1)" track
(`devmentor/src/data/backend-build-curriculum.ts`); from Phase 1 on, each phase's final task does the
same for its module. This file is the source so nothing decided "on the go" is lost.

---

## Phase 0 — Foundations

### Lesson (Task 0.2): 12-Factor Config & Fail-Fast Validation

**The Problem.** A server reads settings from the environment (`process.env.PORT`, secrets, URLs).
Reading `process.env` ad-hoc, scattered across the code, causes three failures: (1) values are always
`string | undefined`, so a missing var becomes a confusing crash *deep* in a request, not at boot;
(2) typos (`PROT`) fail silently; (3) there's no single place to see what config the app needs.

**Options on the table.**
- *Read `process.env` directly where needed* — zero setup, but unsafe and untyped; misconfig surfaces late.
- *dotenv only* — loads `.env`, but still no validation or types.
- *Schema validation at boot (zod/envalid)* — one typed, validated module; fails fast with a clear message. More code up front.

**Decision & Why.** Validate the whole environment **once at startup with zod** and export a typed,
frozen `env` object that the rest of the app imports. A misconfigured process should never start —
"fail fast" turns a 2 a.m. production mystery into an obvious boot error. Cost (a small schema) is
trivial next to the debugging it saves.

**Implementation.**
```ts
// src/config/env.ts
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(4000), // env values are strings → coerce
  LOG_LEVEL: z.enum(['fatal','error','warn','info','debug','trace','silent']).default('info'),
});
function loadEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) { console.error(/* formatted issues */); process.exit(1); } // fail fast
  return Object.freeze(parsed.data);
}
export const env = loadEnv();
```

**Pitfalls.** Env values are strings — remember `z.coerce.number()` for ports/timeouts. Freeze the
object so config can't be mutated at runtime. Never import `process.env` elsewhere — always import `env`.
Keep `.env.example` in sync (it's part of the Definition of Done).

**Quiz idea.** *Why validate config at boot instead of where it's used?* → To fail fast: a missing/invalid
value stops startup with a clear error, instead of crashing unpredictably mid-request later.

### Lesson (Task 0.3): Structured Logging & Correlation IDs

**The Problem.** `console.log` produces unstructured text that's painful to search, filter, or ship to a
log platform — and when many requests run concurrently, their log lines interleave with no way to tell
which line belongs to which request. Debugging "what happened to *that* request?" becomes guesswork.

**Options on the table.**
- *`console.log` everywhere* — zero setup, but unstructured, no levels, unsearchable, leaks secrets easily.
- *A structured logger (pino/winston)* — JSON output, log levels, redaction; small setup cost.
- *Logger + per-request correlation id* — additionally stitches every line of one request together via a shared id; the gold standard for tracing.

**Decision & Why.** Use **pino** (fast, JSON-first) for structured logs at a config-driven level, with
**secret redaction**, plus **pino-http** to log each request/response and attach a **correlation id**.
The id is reused from an incoming `x-request-id` (so it survives across a gateway/other services) or
generated, then echoed on the response and bound to `req.log`. One id ties a whole request together —
the single most useful thing when debugging production.

**Implementation.**
```ts
// src/lib/logger.ts — JSON logs, level from env, secrets redacted
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token'], remove: true },
});

// src/middleware/httpLogger.ts — request logging + correlation id
export const httpLogger = pinoHttp({
  logger,
  genReqId(req, res) {
    const incoming = req.headers['x-request-id'];
    const id = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
    res.setHeader('x-request-id', id);   // echo it back
    return id;                            // becomes req.id, bound to req.log
  },
  customLogLevel: (_req, res, err) => (res.statusCode >= 500 || err ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
});
```

**Pitfalls.** Never log credentials — configure `redact` up front. Always *reuse* an inbound
`x-request-id` instead of overwriting it, so traces survive across services. Use `req.log` (the
child logger with the id bound), not the root `logger`, inside request handlers. JSON is hard to read by
eye in dev — pipe through `pino-pretty`, don't switch back to `console.log`.

**Quiz idea.** *Why attach a correlation id to every request?* → So all log lines for one request share an
id and can be traced together, even when many requests run concurrently and across service hops.

### Lesson (Task 0.4): App Composition & a Consistent Error Model

**The Problem.** Without a deliberate error strategy, every route invents its own error shape
(`res.status(400).send('bad')` here, a thrown string there), async errors silently hang the request, and
a stray exception can leak a stack trace or a database DSN to the client. Clients can't handle errors
programmatically, and you can't trace failures.

**Options on the table.**
- *Handle errors inline in each route* — flexible but inconsistent, repetitive, and easy to leak internals.
- *A single centralized error-handling middleware + an error envelope* — one shape, one place to log/scrub.
- *…plus a typed `AppError`* — routes throw intent (`AppError.notFound()`); the handler renders it. Clear separation of "expected" vs "unexpected" failures.

**Decision & Why.** A **factory** (`createApp()`) composes middleware in a deliberate order, a typed
**`AppError`** carries `statusCode`/`code`/`details`, and **one error handler** renders a single envelope
`{ error: { code, message, details?, requestId } }`. Unknown (non-`AppError`) errors become a generic 500
whose real message is **hidden in production** but always logged. A `notFound` handler turns unmatched
routes into the same envelope, and `asyncHandler` forwards rejected promises to the handler.

**Implementation.**
```ts
// AppError: throw intent from anywhere
throw AppError.badRequest('email is required', [{ field: 'email' }]);

// One handler renders every error consistently
res.status(statusCode).json({ error: { code, message, details, requestId: req.id } });
// unknown errors → 500, message hidden when NODE_ENV=production

// async routes never hang:
router.get('/x', asyncHandler(async (req, res) => { ... }));

// middleware order in createApp(): logger → json → (security) → routes → notFound → errorHandler
```

**Pitfalls.** The error handler **must** be registered last and have the 4-arg signature
`(err, req, res, next)` or Express won't treat it as one. Check `res.headersSent` and defer to `next(err)`
if the response already started. Never echo raw error messages/stacks to clients in production. Express 4
won't catch async throws — wrap with `asyncHandler` (or migrate to Express 5).

**Quiz idea.** *Why hide the message of an unknown 500 error in production but not an `AppError`?* →
`AppError`s are deliberate, client-safe messages; an unknown error's message may leak internals (paths,
DSNs, stack), so it's replaced with a generic message and only written to server logs.

### Lesson (Task 0.5): Liveness vs Readiness Probes

**The Problem.** Orchestrators (Kubernetes) and load balancers need to ask the service two *different*
questions: "should I **restart** this process?" and "should I **send it traffic** right now?" A single
`/health` that also checks the database conflates them — a brief DB blip would make the probe fail and
the orchestrator would needlessly **kill and restart** a perfectly alive process, often making an outage
worse.

**Options on the table.**
- *One `/health` that checks everything* — simple, but restarts on transient dependency failures; no way to "drain" gracefully.
- *Separate liveness and readiness probes* — liveness = process alive (restart if not); readiness = dependencies OK (pull from rotation, don't kill).
- *Readiness with a pluggable check registry* — modules register their own checks (DB, cache) as they're added, so the probe grows without edits.

**Decision & Why.** Expose **`/health` (liveness)** — dependency-free, always answers while the event
loop runs — and **`/ready` (readiness)** — runs a **registry** of dependency checks and returns **503**
when any is down so the LB removes the instance from rotation without restarting it. The registry keeps
the health module dependency-free; Postgres (Phase 1) and Redis (Phase 4) will `registerReadinessCheck`.

**Implementation.**
```ts
// readiness.ts — modules push their own checks
registerReadinessCheck({ name: 'postgres', check: async () => { await db.query('SELECT 1'); } });

// health.routes.ts
router.get('/health', (_q, res) => res.json({ status: 'ok', uptimeSeconds, timestamp }));
router.get('/ready', async (_q, res) => {
  const { healthy, checks } = await runReadinessChecks();
  res.status(healthy ? 200 : 503).json({ status: healthy ? 'ready' : 'not_ready', checks });
});
```
Mounted **early** in `createApp()` so probes stay unauthenticated and outside rate limiting.

**Pitfalls.** Don't put dependency checks in liveness — a flaky DB shouldn't trigger restarts. Readiness
must return a non-2xx (503) when unhealthy, not 200 with a flag, so the LB acts on the status code. Keep
probes cheap (no heavy queries) since they run frequently. Leave them unauthenticated and un-rate-limited.

**Quiz idea.** *Your DB has a 5-second blip. Which probe should fail, and what happens?* → `/ready` fails
(503) so the load balancer stops sending traffic; `/health` stays 200 so the process is **not** restarted,
and traffic resumes automatically once the DB recovers.

### Lesson (Task 0.6): Graceful Shutdown

**The Problem.** Deploys, autoscaling, and crashes constantly stop processes. When an orchestrator
replaces an instance it sends **SIGTERM**. If the process dies instantly, every in-flight request is
dropped (users see 502s) and open resources (DB connections, queue jobs) are abandoned mid-work — the
opposite of zero-downtime. The default Node behavior on SIGTERM is to exit immediately.

**Options on the table.**
- *Do nothing* — instant exit on SIGTERM; drops in-flight requests on every deploy.
- *`server.close()` on SIGTERM* — stop accepting new connections, let in-flight finish; but keep-alive sockets can hold it open, and resources still need closing.
- *Full graceful shutdown* — `server.close()` + close idle keep-alive sockets + run resource-close hooks + a force-exit timeout as a safety net.

**Decision & Why.** On SIGTERM/SIGINT: stop accepting new connections, **let in-flight requests finish**,
nudge idle keep-alive sockets closed (`server.closeIdleConnections()`), run **shutdown hooks** (a LIFO
registry that DB/Redis/workers register into in later phases), then exit — with a **force-exit timer** so
a stuck connection can't hang the deploy forever. Also log `unhandledRejection` and exit on
`uncaughtException` (the process is in an unknown state).

**Implementation.**
```ts
async function shutdown(signal) {
  if (shuttingDown) return; shuttingDown = true;
  const force = setTimeout(() => process.exit(1), FORCE_EXIT_MS).unref(); // safety net
  server.close(async () => { await runShutdownHooks(); clearTimeout(force); process.exit(0); });
  server.closeIdleConnections?.(); // free idle keep-alives so close() can complete
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT',  () => void shutdown('SIGINT'));
```

**Pitfalls.** Forgetting idle keep-alive sockets — `server.close()` waits on them and seems to "hang".
No force-exit timeout — one stuck client blocks the whole deploy. Re-entrancy — guard against a second
signal. Closing resources in the wrong order — close in **reverse** of how you opened them (LIFO). Don't
forget the kernel/orchestrator also has its own kill-timeout (e.g. k8s `terminationGracePeriodSeconds`)
which should exceed your drain budget.

**Quiz idea.** *Why call `server.closeIdleConnections()` during shutdown?* → HTTP keep-alive leaves idle
sockets open; `server.close()` waits for all connections to end, so without closing idle ones it appears
to hang. Closing idle sockets lets active requests finish while the server still shuts down promptly.

### Lesson (Task 0.7): Reproducible Local Environments with Docker Compose

**The Problem.** The app needs Postgres and Redis to run. Asking every developer (and CI) to install and
configure the right versions by hand causes "works on my machine" drift, version mismatches, and slow
onboarding. State also needs to persist across restarts and be easy to reset.

**Options on the table.**
- *Install Postgres/Redis natively per machine* — fast once done, but version drift and painful onboarding/CI.
- *Docker Compose for backing services, app on host* — one command spins up pinned versions; app keeps hot-reload speed on the host.
- *Everything in Compose (app too)* — maximum parity, but slower inner-loop in dev; better saved for the full stack later (Phase 14).

**Decision & Why.** Run **Postgres + Redis in Docker Compose** with **pinned image versions**, **named
volumes** for persistence, and **healthchecks** so `docker compose ps` reports real readiness (and other
services can `depends_on: condition: service_healthy`). The **app runs on the host** via `pnpm dev` for a
fast edit-reload loop. A dev `Dockerfile` + `.dockerignore` exist for when we containerize the app (the
hardened multi-stage prod build and full stack come in Phase 14).

**Implementation.**
```yaml
services:
  postgres:
    image: postgres:16-alpine          # pin the version
    environment: { POSTGRES_USER: devmentor, POSTGRES_PASSWORD: devmentor, POSTGRES_DB: devmentor }
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]   # persist data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U devmentor -d devmentor"]
      interval: 5s; timeout: 3s; retries: 10
  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes"]
    healthcheck: { test: ["CMD", "redis-cli", "ping"], interval: 5s, timeout: 3s, retries: 10 }
volumes: { pgdata: {}, redisdata: {} }
```

**Pitfalls.** Don't use floating tags like `postgres:latest` — pin versions for reproducibility. Without a
**healthcheck**, dependents start before the DB is actually accepting connections (race on boot). Without a
named **volume**, data vanishes on `docker compose down`. Keep secrets out of the committed file (fine for
local dev creds; use real secret management in prod). `.dockerignore` keeps `node_modules`/`.env`/`.git`
out of the build context (smaller, safer images).

**Quiz idea.** *Why add a healthcheck to the Postgres service instead of assuming it's ready when the
container starts?* → The container being "up" only means the process launched; Postgres needs a moment to
accept connections. A healthcheck reports true readiness, so dependents can wait on `service_healthy`
instead of crashing on a connection-refused race at boot.

---

## Phase 1 — Data Modeling & Persistence

### Lesson (Task 1.1): Connecting to Postgres with Prisma (the client singleton)

**The Problem.** The service needs durable storage. Talking to Postgres with the raw `pg` driver means
hand-writing SQL strings (untyped, injection-prone, no migrations) and manually managing a connection
pool. We also need the database to participate in readiness (don't take traffic if the DB is down) and to
close cleanly on shutdown — and in dev, `tsx watch` reloads modules, which can silently create a new DB
connection pool on every file save.

**Options on the table.**
- *Raw `pg` driver* — full control, but verbose, untyped, and you build migrations/pooling yourself.
- *Query builder (Knex)* — less SQL string-building, still largely untyped, migrations are manual-ish.
- *ORM — Prisma* — typed client generated from a schema, first-class migrations, readable queries. (chosen)
  *(SQL vs NoSQL and the normalized-vs-JSONB modeling decision are recorded in ADR-0002 at Task 1.6.)*

**Decision & Why.** Use **Prisma** on Postgres: a typed client generated from `schema.prisma`, with
`prisma migrate` for versioned schema changes. Expose a **singleton `PrismaClient`** (one connection pool),
cached on `globalThis` in dev so hot-reload doesn't leak pools. Register a **readiness check**
(`SELECT 1`) and a **shutdown hook** (`$disconnect`) so the DB is wired into the app's lifecycle.

**Implementation.**
```ts
// prisma/schema.prisma
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }
generator  client { provider = "prisma-client-js" }

// src/lib/prisma.ts — one client, cached in dev, wired into health + shutdown
const g = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = g.prisma ?? new PrismaClient({ log: ['warn', 'error'] });
if (!isProduction) g.prisma = prisma;

export function registerPrismaHooks() {
  registerReadinessCheck({ name: 'postgres', check: async () => { await prisma.$queryRaw`SELECT 1`; } });
  onShutdown('prisma', () => prisma.$disconnect());
}
```
`DATABASE_URL` is now a **required** env var (the service is DB-backed), so a missing/invalid URL fails
fast at boot (Lesson 0.2).

**Pitfalls.** Creating a `new PrismaClient()` per request/module **exhausts Postgres connections** — always
share one. Without the `globalThis` cache, `tsx watch` (and Next.js dev) leak a client per reload. You must
run `prisma generate` before the typed client exists (and after every schema change); it's wired as
`db:generate`. Readiness uses a *cheap* `SELECT 1`, not a real query.

**Quiz idea.** *Why expose a single shared PrismaClient instead of creating one where needed?* → Each
client owns a connection pool; multiple clients multiply open connections and exhaust Postgres. A singleton
(cached on `globalThis` in dev to survive hot-reload) keeps the pool bounded.

### Lesson (Task 1.2): Modeling Users & Derived Stats (1:1 relations)

**The Problem.** A user has a **stable identity** (email, name, created date) and also **derived,
frequently-changing progress** (XP, streak, current lesson). If we cram both into one `User` row, every XP
tick rewrites the identity record, mixes concerns, and makes the "core" table hot and wide. Where should
mutable stats live?

**Options on the table.**
- *All columns on `User`* — simplest, but churns identity rows on every progress change and bloats the table.
- *A separate `UserStats` table, 1:1 with `User`* — isolates hot, mutable counters from stable identity; clean separation. (chosen)
- *A JSON blob on `User`* — flexible, but you lose typed columns, constraints, and easy aggregate queries.

**Decision & Why.** Keep **`User`** lean (identity only) and put progress in a **`UserStats`** row that
**shares User's primary key** (`userId @id` + relation) — the canonical way to model 1:1 in a relational DB.
`onDelete: Cascade` means deleting a user removes their stats automatically. IDs are **cuid** (not
auto-increment ints): collision-resistant, non-guessable, and safe to generate client/distributed-side
without leaking row counts.

**Implementation.**
```prisma
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  stats     UserStats?
}

model UserStats {
  userId         String    @id                                   // PK == FK => 1:1
  user           User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  totalXP        Int       @default(0)
  streak         Int       @default(0)
  lastActiveDate DateTime?
  currentModule  String?
  currentLesson  String?
  updatedAt      DateTime  @updatedAt
}
```

**Pitfalls.** A 1:1 is modeled by making the dependent's **primary key also the foreign key** — not a
plain extra column. Set `onDelete: Cascade` or you'll orphan stats rows. Prefer **cuid/uuid** over
auto-increment integers for public ids (don't leak counts, don't collide across shards). `@updatedAt` is
maintained by Prisma — don't set it by hand.

**Quiz idea.** *Why store XP/streak in a separate `UserStats` table instead of columns on `User`?* → To
isolate frequently-updated, derived counters from the stable identity record — keeping `User` lean and
avoiding rewriting identity rows on every progress change (and keeping concerns separated).

### Lesson (Task 1.3): Normalized Structure + JSONB Content + Progress Join Tables

**The Problem.** DevMentor has many courses with deep content. We need to **query, order and paginate** the
catalog structure (courses → modules → lessons), but each lesson's actual content is a **varied, evolving**
sequence of blocks (headings, paragraphs, code, callouts, diagrams…). Modeling every block as columns/rows
means a migration every time we add a block type. We also must track **per-user progress** without
duplicating content or double-counting.

**Options on the table.**
- *Fully normalized (each block its own row/table)* — great for SQL queries, but heavy joins and a migration for every new block shape.
- *Fully document (store the whole course as one JSON blob)* — totally flexible, but you lose ordering/filtering/pagination at the DB level and all referential integrity.
- *Hybrid: normalize the structure, store lesson content as JSONB* — query/order/paginate the tree, keep content flexible. (chosen)

**Decision & Why.** **Normalize** `Course → Module → Lesson` (FKs, ordering, unique slugs per parent,
indexed) so the catalog is queryable and paginable, but store each lesson's `blocks` and `quiz` as **JSONB**
so new content shapes need **no migration**. Per-user progress is thin **join tables** — `LessonCompletion`
and `QuizScore` — that reference lessons by id and use **composite primary keys** (`@@id([userId, lessonId])`),
which makes writes **idempotent** (upsert / `ON CONFLICT DO NOTHING`): completing a lesson twice can't create
duplicates or double-award XP (this directly sets up Phase 5's concurrency work).

**Implementation.**
```prisma
model Lesson {
  id       String @id @default(cuid())
  moduleId String
  module   Module @relation(fields: [moduleId], references: [id], onDelete: Cascade)
  slug     String
  level    Level  @default(beginner)
  blocks   Json   // content blocks (JSONB) — evolves without migrations
  quiz     Json?  // quiz questions (JSONB)
  @@unique([moduleId, slug])
  @@index([moduleId])
}

model LessonCompletion {
  userId   String
  lessonId String
  completedAt DateTime @default(now())
  @@id([userId, lessonId]) // idempotent: one completion per (user, lesson)
}
```

**Pitfalls.** JSONB is **opaque to SQL constraints** — validate the block shape in the app (zod) before
writing, since the DB won't. **Index foreign keys** (and columns you filter/sort on) or large-catalog
queries table-scan. The **composite PK** on progress tables is what gives idempotency — without it,
double-clicks duplicate rows. Don't push query/filter fields *into* JSON (you can't index/filter them
well) — keep those as real columns.

**Quiz idea.** *Why store lesson `blocks` as JSONB but keep `Course/Module/Lesson` structure normalized?*
→ The structure must be queried, ordered and paginated (needs columns, FKs, indexes), while content shape
varies and evolves — JSONB lets content change without a migration, and the normalized tree keeps the
catalog queryable with referential integrity.

### Lesson (Task 1.4): Migrations & Idempotent Seeding

**The Problem.** The schema will change many times, across many machines, CI, and production. Applying
changes by hand-running SQL drifts environments and isn't repeatable or reviewable. And a freshly-migrated
database is **empty** — developers need realistic sample data to work against without hand-entering rows.

**Options on the table.**
- *Hand-written SQL migrations* — full control, but you author/order them manually and they're easy to get wrong.
- *`prisma db push`* — fast schema sync for prototyping, but keeps **no migration history** (bad for teams/prod).
- *`prisma migrate`* — generates versioned, committed migration files from the schema; deterministic across environments. (chosen)
- For data: *manual inserts* vs an **idempotent seed script** (upserts). (chose seed script)

**Decision & Why.** Use **`prisma migrate`**: `migrate dev` in development generates a timestamped migration
(committed to git) and applies it; `migrate deploy` applies the exact same committed migrations in CI/prod
**without prompts or resets**. A **seed script** (`prisma/seed.ts`, wired via `package.json` → `prisma.seed`)
populates sample data using **upserts**, so it's **idempotent** — re-running converges instead of duplicating.

**Implementation.**
```bash
pnpm db:migrate         # dev: create + apply a migration (prompts, may reset)
pnpm db:seed            # run prisma/seed.ts (idempotent upserts)
pnpm db:deploy          # prod/CI: apply committed migrations, no prompts/reset
```
```ts
// every seed write is an upsert keyed on a unique field => safe to re-run
await prisma.course.upsert({
  where: { slug: 'sample-backend' },
  update: { title: 'Sample Backend Course' },
  create: { slug: 'sample-backend', title: 'Sample Backend Course', description: '…', published: true },
});
```

**Pitfalls.** **Never edit a migration that's already been applied/shared** — create a new one (editing it
desyncs everyone's history). Use `migrate dev` only locally (it can **reset** the database); production must
use `migrate deploy`. **Commit the `prisma/migrations/` folder** — it *is* the history. Make seeds idempotent
(upsert, not create) or re-running explodes with duplicate/unique errors.

**Quiz idea.** *Why use `migrate deploy` in production instead of `migrate dev`?* → `migrate deploy` applies
the already-committed migrations deterministically with no prompts and never resets data, whereas `migrate
dev` is interactive and may reset the database — safe for local dev, dangerous for prod.

### Lesson (Task 1.5): Pagination at Scale (Keyset) & the N+1 Problem

**The Problem.** With a large catalog, two performance traps appear. (1) Returning all rows is unbounded;
the obvious fix, `OFFSET n` pagination, gets **slower the deeper you page** (the DB counts and discards n
rows every time) and can **skip or repeat** rows when data changes mid-paging. (2) Loading nested data
naively — fetch courses, then loop and query each course's modules/lessons — fires **1 + N** queries: the
**N+1 problem**, which quietly destroys latency as N grows.

**Options on the table.**
- *Pagination:* offset (`skip`/`OFFSET`) — simple, but slow at depth and unstable; **keyset/cursor** — remember the last ordered key and fetch rows after it: O(limit) at any depth, stable. (chose keyset)
- *Relations:* loop-and-query (N+1) — easy, terrible; **`include`/join** — one batched query; DataLoader — for GraphQL-style batching. (chose `include`)

**Decision & Why.** **Keyset pagination**: order by a unique, stable column, encode the last row's key as
an **opaque base64url cursor**, fetch **`limit + 1`** rows to know if a next page exists (no extra COUNT),
and **cap** the page size so a client can't request everything. Fetch nested relations with a single
**`include`** query (with `orderBy`), and use **`select`** to omit heavy JSONB (`blocks`) from list views.
A **repository layer** keeps all this query shape — and its performance characteristics — in one place.

**Implementation.**
```ts
// keyset: fetch limit+1, cursor = last id
const { limit, take, cursorId } = keysetParams(params);
const rows = await prisma.course.findMany({
  where: { published: true },
  orderBy: { id: 'asc' },
  take,
  ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
});
return buildPage(rows, limit, (c) => c.id); // -> { items, nextCursor, hasMore }

// avoid N+1: one query with nested includes instead of looping
prisma.course.findUnique({ where: { slug }, include: { modules: { include: { lessons: true } } } });
```

**Pitfalls.** Offset pagination is fine for small/shallow lists but degrades at depth — prefer keyset for
large or infinite-scroll data. The cursor column must be **unique, stable, and the one you order by** (id
works; a non-unique column needs a tiebreaker). Always **cap** `limit`. N+1 hides anywhere you call the DB
**inside a loop** — pull related data with `include`/a single query. Don't over-fetch heavy columns; `select`
only what a list needs.

**Quiz idea.** *What is the N+1 problem and how does `include` fix it?* → Fetching a list (1 query) then
issuing one query per row for its relations (N queries) = N+1 round-trips. `include` (a join/batched query)
fetches the parents and their relations together in a single query.

---

## Phase 2 — API Design & Validation

### Lesson (Task 2.1): A Versioned REST Surface & the OpenAPI Contract

**The Problem.** APIs evolve, and a change that helps one client can break another. Without a stable
**versioning** scheme, you can't ship improvements safely; without a documented **contract**, every
integration is guesswork and drifts from reality. We also want **consistent conventions** so the API is
predictable across features.

**Options on the table.**
- *Versioning:* URL path (`/api/v1`) — simple, explicit, cache/proxy-friendly; header/`Accept` negotiation — cleaner URLs but harder to test/cache; query param — easy to forget. (chose URL path)
- *Docs:* none — fastest, useless; hand-written — drifts from code; **OpenAPI** — a machine-readable contract that powers docs UIs and client generation. (chose OpenAPI)

**Decision & Why.** Mount the API under **`/api/v1`** (version in the path) so a future breaking change is
a new `/api/v2` router while v1 keeps working. Adopt **consistent conventions** — plural-noun resources,
HTTP methods as verbs, keyset-paginated list envelopes `{ items, nextCursor, hasMore }`, and the single
shared **Error** envelope. Maintain an **OpenAPI** document served at `/openapi.json` with a Redoc UI at
`/docs`; feature routers `registerPath` their endpoints so the contract stays close to the code.

**Implementation.**
```ts
// app.ts — version lives in the mount path
app.use('/api/v1', apiRouter);

// api/router.ts — discovery + contract + docs
apiRouter.get('/', (_q, res) => res.json({ name: 'devmentor-api', version: '1.0.0', docs: '/api/v1/docs' }));
apiRouter.get('/openapi.json', (_q, res) => res.json(openapiDocument));
apiRouter.get('/docs', (_q, res) => res.type('html').send(redocHtml)); // Redoc from CDN — no server dep

// feature routers mount here later: apiRouter.use('/courses', courseRouter)
```

**Pitfalls.** Don't make breaking changes inside `v1` — additive changes are fine, breaking ones get a new
version. Version at a **coarse boundary** (the whole API), not per-endpoint. Keep the spec in sync by
registering each endpoint's path as you build it — a contract that lies is worse than none. Define the
error/envelope schema **once** and reference it everywhere.

**Quiz idea.** *Why put the version in the URL path (`/api/v1`) rather than only in code?* → It's explicit,
cacheable, and proxy-friendly, and lets a breaking `/api/v2` run alongside `/api/v1` so existing clients
keep working while new ones migrate.

### Lesson (Task 2.2): Validate at the Edge & the DTO Pattern

**The Problem.** Every request is untrusted input. If handlers validate ad-hoc, you get scattered,
inconsistent checks; missed cases become security or crash bugs; and the input *type* a handler assumes drifts
from what's actually validated. Query/route params are also always **strings** (`?limit=25` is `"25"`), so
handlers end up doing manual `Number(...)` coercion everywhere.

**Options on the table.**
- *Manual `if` checks in each handler* — flexible, but inconsistent, repetitive, and easy to miss.
- *A validation library (zod/joi) called inside handlers* — consistent, but validation still lives next to logic and types are separate.
- *Schemas as DTOs + a validation middleware at the edge* — one schema is both the validator and the type; handlers trust their inputs. (chosen)

**Decision & Why.** Define request shapes as **zod schemas (DTOs)** — the single source of truth — and use
a **`validate` middleware** that parses `body`/`query`/`params` in **one pass** (so all problems are
reported together), **coerces** values (string→number), and forwards failures to the central handler as a
**400 VALIDATION_ERROR**. Static types come from `z.infer`, so the type and the runtime check can't drift.
Past the middleware, handlers trust their inputs — no defensive checks.

**Implementation.**
```ts
// schema IS the DTO — validation + type from one definition
export const paginationQuery = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(), // "25" -> 25, capped
});
export type PaginationQuery = z.infer<typeof paginationQuery>;

// one parse over all three locations; paths come out like "body.email"
router.post('/users', validate({ body: createUserBody }), handler);
router.get('/courses', validate({ query: paginationQuery }), handler);
```

**Pitfalls.** Query/route params are strings — **coerce** (`z.coerce.number()`), and remember `req.query`
is a getter, so write coerced values back in place. Validate at the **boundary** so inner code can assume
valid data. Don't hand-write a separate TypeScript type next to the schema — derive it with `z.infer` or
they drift. Use **explicit DTOs** (don't accept arbitrary fields) so clients can't set fields they
shouldn't (mass-assignment).

**Quiz idea.** *Why is `limit` defined with `z.coerce.number()` in a query DTO?* → Query-string values are
always strings (`"25"`); coercion turns it into a validated, bounded number so the handler receives the
right type without manual parsing.

### Lesson (Task 2.3): Serving the Catalog — Layered Endpoints

**The Problem.** Where should logic live? If a route handler parses the request, applies business rules,
*and* runs SQL, it becomes a tangled, untestable blob — and rules (like "only published courses are
visible") get duplicated or forgotten. We also must not **leak the existence** of unpublished/private
resources, and list endpoints must stay bounded.

**Options on the table.**
- *Everything in the route handler* — fast to write, impossible to test or reuse, rules scattered.
- *Layered: controller → service → repository* — each layer one job; testable; rules in one place. (chosen)

**Decision & Why.** Three thin layers per feature: the **controller** is an HTTP adapter (read the
already-validated request, call the service, send JSON — no logic); the **service** holds business rules
(published-only visibility, translate "missing" into a 404 domain error); the **repository** owns Prisma
queries (keyset pagination, N+1-safe `include`). The list endpoint returns the keyset envelope
`{ items, nextCursor, hasMore }`, and an unpublished **or** absent course both return the **same 404** so we
don't reveal which courses exist. Each endpoint registers itself into the OpenAPI contract.

**Implementation.**
```ts
// route: validate at the edge, then delegate
courseRouter.get('/', validate({ query: paginationQuery }), courseController.listCourses);
courseRouter.get('/:slug', validate({ params: courseSlugParams }), courseController.getCourse);

// controller (thin) -> service (rules) -> repository (Prisma)
export async function getCourse(slug: string) {
  const course = await getCourseBySlug(slug);
  if (!course || !course.published) throw AppError.notFound('Course not found: ' + slug); // don't leak existence
  return course;
}
```

**Pitfalls.** Keep controllers free of business logic and DB calls — otherwise the layering is fake. Return
the **same 404** for "doesn't exist" and "exists but you can't see it" (a 403 or an empty 200 leaks
information). Always paginate list endpoints (never `findMany()` unbounded). Register each endpoint in
OpenAPI as you add it so the contract stays truthful.

**Quiz idea.** *Why return 404 (not 403 or an empty result) when a course exists but isn't published?* →
To avoid leaking existence — distinguishing "not found" from "forbidden" tells a client the resource is
real. A uniform 404 reveals nothing about hidden resources.

### Lesson (Task 2.4): Resource Shape — List vs Detail

**The Problem.** A lesson's content (`blocks`, `quiz`) is large JSONB. If the catalog list embedded every
lesson's full content, payloads would balloon, the DB would read megabytes nobody asked for, and the list
would be slow — yet a learner viewing one lesson needs all of it. One response shape can't serve both.

**Options on the table.**
- *Always return full content everywhere* — simple, but over-fetches massively in lists.
- *Lightweight list + a detail-by-id endpoint that returns full content* — each response carries only what its use needs. (chosen)

**Decision & Why.** The catalog (`getCourseBySlug`) returns lessons as **lightweight metadata** (`select`
drops `blocks`), while **`GET /lessons/:id`** returns the **full** lesson (blocks + quiz). Lessons are
addressed by their **stable id** (a slug is only unique within a module, so it can't identify a lesson
globally). Visibility is enforced by pulling the parent course's `published` flag in the **same query** via
`include`, then a uniform 404 for missing/unpublished.

**Implementation.**
```ts
// detail: full content + parent publish flag in ONE query
prisma.lesson.findUnique({
  where: { id },
  include: { module: { select: { slug: true, course: { select: { slug: true, published: true } } } } },
});
// service: hide unpublished
if (!lesson || !lesson.module.course.published) throw AppError.notFound('Lesson not found: ' + id);
```

**Pitfalls.** Don't embed heavy JSONB in list endpoints — `select` only the fields a list needs. Don't
re-query the course to check visibility (that's an N+1 / extra round-trip) — `include` the flag in the same
query. Address a resource by something that uniquely identifies it (id here; a within-parent slug needs the
parent in the path).

**Quiz idea.** *Why fetch the parent course's `published` flag in the same query as the lesson, via
`include`?* → To enforce visibility without a second round-trip (avoiding an N+1) — one query returns both
the lesson content and the data needed to authorize returning it.

### Lesson (Task 2.5): Finishing the Contract Edges — 405, Malformed Input, Versioning

**The Problem.** A polished API is predictable at its *edges*, not just on the happy path. Three rough
edges remain: hitting a real path with the **wrong method** falls through to a misleading 404; a
**malformed JSON** body bubbles up from the body parser as an ugly 500; and there's no way to **discover**
which API versions exist.

**Options on the table.**
- *404 for everything unmatched* — simple, but a 404 on `POST /courses` wrongly implies the path doesn't exist.
- *Proper 405 Method Not Allowed with an `Allow` header* — tells the client the resource exists and which methods it supports. (chosen)
- *Let body-parser errors become 500* vs *map them to 400* — malformed input is a client error, so 400. (chose 400)

**Decision & Why.** Mount a `methodNotAllowed([...])` handler with **`router.all(path, ...)` after** the
real method handlers, so a known path answers unsupported methods with **405 + `Allow`** while genuinely
unknown paths still 404. Map the body parser's `SyntaxError` to **400 INVALID_JSON** (a malformed body is
the client's fault, not a server bug). Add a **`/api` version index** for discovery. Everything stays in
the one error envelope.

**Implementation.**
```ts
// 405 for known paths (after the GET handlers)
courseRouter.get('/', ...); courseRouter.get('/:slug', ...);
courseRouter.all('/', methodNotAllowed(['GET']));        // sets Allow: GET, throws 405
courseRouter.all('/:slug', methodNotAllowed(['GET']));

// malformed JSON -> 400, not 500
} else if (err instanceof SyntaxError && 'body' in err) {
  statusCode = 400; code = 'INVALID_JSON'; message = 'Malformed JSON in request body';
}

app.get('/api', (_q, res) => res.json({ versions: ['v1'], current: '/api/v1' }));
```

**Pitfalls.** The `.all()` 405 handler must come **after** the specific method handlers (otherwise it
swallows the valid ones). Always set the **`Allow`** header on a 405 (the spec requires it). Keep the
distinction: **404** = path unknown, **405** = path known but wrong method. The body-parser error is a
`SyntaxError` carrying a `body` property — match on that, and return 400, not 500.

**Quiz idea.** *What's the difference between 404 and 405, and when does each apply?* → 404 means the
resource/path doesn't exist; 405 means it exists but the HTTP method isn't supported (and the response must
include an `Allow` header listing the methods that are).

---

## Phase 3 — Authentication & Security

### Lesson (Task 3.1): Password Hashing Done Right (argon2id)

**The Problem.** We must store user passwords such that, even if the database leaks, attackers can't
recover them — and can't cheaply brute-force them. Storing plaintext is catastrophic; so is reversible
**encryption** (the key leaks too). Even a "hash" is dangerous if it's a **fast, general-purpose** hash
(MD5/SHA-256): modern GPUs try billions per second.

**Options on the table.**
- *Plaintext / encryption* — recoverable; never acceptable for passwords.
- *Fast hash (SHA-256) + salt* — salt stops rainbow tables, but it's still GPU-fast to brute force.
- *Slow, salted, memory-hard hash* — bcrypt (battle-tested) or **argon2id** (current OWASP recommendation, resists GPU/ASIC attacks via memory cost). (chose argon2id)

**Decision & Why.** Hash with **argon2id** at an OWASP baseline (~19 MiB memory, 2 iterations). It salts
every hash automatically and embeds the salt + parameters in the output (`$argon2id$v=19$m=...$salt$hash`),
so verification needs only the stored string. `verify` **fails closed** (returns false) on a malformed
hash rather than throwing. The hash is **slow on purpose** — that cost is trivial per login but ruinous for
an attacker trying billions of guesses.

**Implementation.**
```ts
const HASH_OPTIONS: argon2.Options = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
export const hashPassword = (plain: string) => argon2.hash(plain, HASH_OPTIONS);
export async function verifyPassword(hash: string, plain: string) {
  try { return await argon2.verify(hash, plain); } catch { return false; } // fail closed
}
```
The `User.passwordHash` column is nullable, so a future OAuth-only user can exist without a local password.

**Pitfalls.** Never log, encrypt, or store the plaintext. Never use fast/general hashes (MD5/SHA) for
passwords. Don't hand-roll salts — argon2 generates and stores a unique one per hash (which is why two
hashes of the same password differ). You can raise the cost parameters over time safely — `verify` reads
the parameters embedded in each existing hash.

**Quiz idea.** *Why use a slow, memory-hard hash (argon2id) instead of SHA-256 for passwords?* → A fast
hash can be brute-forced billions of times per second on a GPU; argon2id is deliberately slow and
memory-hard, making large-scale guessing economically infeasible while staying cheap for a single login.

### Lesson (Task 3.2): Two-Token Auth — Access JWT + Opaque Refresh (Stored Hashed)

**The Problem.** We want authentication that's **stateless** (no DB hit to verify every request) yet
**revocable** (log out, kill a stolen session). A single long-lived JWT can't be revoked and, if stolen,
stays valid until it expires. Pure server sessions are revocable but require a DB lookup on every request.

**Options on the table.**
- *Server sessions (opaque id → DB row)* — easily revoked, but a DB lookup per request.
- *One long-lived JWT* — stateless, but unrevocable and dangerous if leaked.
- *Two tokens: short-lived access JWT + long-lived refresh token* — stateless requests + revocable sessions. (chosen)

**Decision & Why.** Issue a **short-lived access JWT** (~15 min, verified by signature — no DB lookup) and
a **long-lived, opaque, random refresh token** (~7 days). We store only the **sha256 hash** of the refresh
token, never the token itself. Stateless access keeps requests fast; the short TTL caps a stolen access
token's usefulness; the refresh token is **revocable and rotatable** (Phase 3.4). Storing only the hash
means a DB leak can't be replayed to mint sessions.

**Implementation.**
```ts
// access: signed, short-lived, stateless
export const signAccessToken = (p: { sub: string }) =>
  jwt.sign(p, env.JWT_ACCESS_SECRET, { expiresIn: env.ACCESS_TOKEN_TTL_SECONDS });

// refresh: opaque 256-bit random; store only its hash
export function generateRefreshToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: createHash('sha256').update(token).digest('hex') };
}
```
`RefreshToken` table stores `{ userId, tokenHash @unique, expiresAt, revokedAt }`.

**Pitfalls.** Never store the raw refresh token — store its hash (like a password). The refresh token must
be **high-entropy random**, not a JWT (so it's opaque and revocable, not self-validating). Keep the access
TTL short to limit theft impact. Use a long, random `JWT_ACCESS_SECRET`. Don't put secrets or sensitive
data in the JWT payload — it's signed, not encrypted, so anyone can read it.

**Quiz idea.** *Why store only the sha256 hash of the refresh token, and why make access tokens short-lived
while refresh tokens are long-lived?* → Storing the hash means a DB leak can't be replayed to forge
sessions (like password hashing). A short access TTL limits the damage of a stolen access token, while the
long-lived refresh token (revocable, rotated) provides a smooth session without frequent re-login.

### Lesson (Task 3.3): The Auth Flow — Register, Login, Me

**The Problem.** Turn credentials into a session safely. Two subtle traps: **where the tokens go** in the
browser (the wrong place invites XSS token theft), and **login error messages** that reveal which emails are
registered (user enumeration).

**Decision & Why.** `register` checks the email is free, hashes the password, creates the user (+ its stats
row), and issues tokens. `login` looks up the user and verifies the password, returning a **uniform**
"Invalid email or password" whether the email is unknown or the password is wrong. Tokens are split by
storage: the **access token goes in the JSON body** (client keeps it in memory), the **refresh token in an
httpOnly, SameSite cookie** scoped to `/api/v1/auth` (JS can't read it; only sent where needed). `me` is
protected by `requireAuth`. Responses never include `passwordHash`.

```ts
res.cookie('refresh_token', token, { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/api/v1/auth' });
res.status(201).json({ user, accessToken }); // access token in body, refresh in cookie
```

**Pitfalls.** Return the **same** error for unknown-email and wrong-password (don't leak which emails exist).
Never store the refresh token in `localStorage` — an httpOnly cookie survives XSS reads. Strip sensitive
fields (`passwordHash`) from every response. Use 201 for register, 200 for login.

**Quiz idea.** *Why return an identical "invalid email or password" for both an unknown email and a wrong
password?* → To prevent user enumeration — distinct errors would let an attacker discover which emails have
accounts.

### Lesson (Task 3.4): Refresh Rotation & Reuse Detection

**The Problem.** A long-lived refresh token is powerful: if stolen, it can mint access tokens indefinitely.
We need to both limit that and **detect** theft.

**Decision & Why.** **Rotate** on every refresh: revoke the presented token and issue a brand-new one. Keep
revoked tokens (mark `revokedAt`, don't delete) so we can spot **reuse**: if an already-rotated (revoked)
token is presented again, the legitimate client and an attacker both hold copies — treat it as theft and
**revoke all** of that user's tokens, forcing a full re-login.

```ts
if (stored.revokedAt) { await revokeAllUserRefreshTokens(stored.userId); throw AppError.unauthorized('reuse detected'); }
if (stored.expiresAt < new Date()) throw AppError.unauthorized('expired');
await revokeRefreshToken(stored.id);          // rotate
return issueTokens(user);                      // new pair
```

**Pitfalls.** Store the **hash**, not the token. **Mark revoked, don't delete** — you need the record to
detect reuse. Always check expiry. `logout` revokes the current token. Rotation means the client must always
use the newest refresh token (it's set fresh in the cookie each time).

**Quiz idea.** *What does presenting an already-rotated (revoked) refresh token indicate, and how should the
server respond?* → Likely token theft (two parties hold the same token) — revoke all the user's refresh
tokens to force re-login, invalidating the attacker's copy too.

### Lesson (Task 3.5): Stateless Auth Middleware & RBAC

**The Problem.** Protect routes and enforce permissions — ideally without a database lookup on every single
request.

**Decision & Why.** `requireAuth` verifies the access token's **signature** (stateless — no DB) and attaches
the principal as `req.auth = { userId, role }`. `requireRole(...roles)` checks that role afterward. The
**role is embedded in the access token**, so authorization needs no lookup; the short access TTL bounds how
stale that role can be. We distinguish **401** (not authenticated) from **403** (authenticated but lacking
permission).

```ts
router.delete('/x', requireAuth, requireRole('ADMIN'), handler);
```

**Pitfalls.** Because the role is in the token, a role change only takes effect when the access token
expires (fine for short TTLs; for instant revocation, check a denylist or re-issue). Keep 401 vs 403
distinct. `requireRole` must run **after** `requireAuth` (it reads `req.auth`). Augment the Express
`Request` type so `req.auth` is typed.

**Quiz idea.** *What's the difference between 401 and 403?* → 401 = not authenticated (no/invalid
credentials); 403 = authenticated but not authorized (valid identity, insufficient permission).

### Lesson (Task 3.6): Security Hardening — Helmet, CORS, Rate Limiting

**The Problem.** A browser-facing, public API is exposed to header-based attacks, cross-origin access, and
automated brute force / credential stuffing.

**Decision & Why.** Add **helmet** (sensible secure response headers), lock **CORS** to the frontend origin
with `credentials: true` (required so the browser sends the refresh cookie), and **rate-limit** the auth
endpoints. Set `trust proxy` so the real client IP (not the load balancer's) is used for limiting.

```ts
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use('/api/v1/auth', authRateLimiter); // 429 on abuse, via the shared envelope
```

**Pitfalls.** With `credentials: true` the CORS origin **cannot be `*`** — it must name the exact origin.
Rate limiting by IP needs the correct client IP, so set `trust proxy` behind a proxy/LB. This limiter is
**in-memory (per-process)** — it doesn't coordinate across replicas; a Redis-backed distributed limiter
comes in Phase 4/5. Put helmet/CORS early in the middleware chain.

**Quiz idea.** *Why can't the CORS `origin` be `*` when `credentials: true`?* → The browser forbids sending
credentials (cookies) to a wildcard origin; you must specify the exact allowed origin for credentialed
requests.

---

## Phase 4 — Caching & Read Performance (Redis)

### Lesson (Task 4.1): Why a Shared Cache (Redis), Not Local Memory

**The Problem.** The course catalog and lesson reads are hot, identical for everyone, and change rarely —
yet every request hits Postgres. Under load that's wasteful and slow. The naive fix, an in-process `Map`
cache, breaks the moment you run more than one instance: each replica has its own cache, hit rates are low,
and invalidation can't reach the other replicas.

**Options on the table.**
- *No cache (just scale the DB)* — simplest, but expensive and eventually the bottleneck.
- *In-process memory cache* — fast, zero infra, but per-replica (not shared) and lost on restart.
- *A shared cache — Redis* — one cache all replicas read/write, survives restarts, supports TTLs, locks, pub/sub. (chosen)

**Decision & Why.** Introduce **Redis** as a shared cache (and later: locks, pub/sub, queues). A single
client (cached on `globalThis` in dev like Prisma), wired into readiness (`PING`) and graceful shutdown
(`quit`). This is *why Redis enters the stack* — a shared cache is the first thing a horizontally-scaled
service needs that local memory can't provide.

```ts
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
registerReadinessCheck({ name: 'redis', check: async () => { await redis.ping(); } });
```

**Pitfalls.** Don't reach for a local `Map` in a multi-instance service — it fragments the cache and can't
be invalidated cluster-wide. Share one client (many connections exhaust Redis). Add Redis to readiness so a
Redis outage pulls the instance from rotation.

**Quiz idea.** *Why prefer Redis over an in-process cache once you run more than one instance?* → An
in-process cache is per-replica: low hit rate and no way to invalidate across instances. Redis is a single
shared cache all replicas use, so hits are high and invalidation is global.

### Lesson (Task 4.2): Cache-Aside & Stampede Protection

**The Problem.** The standard read pattern is cache-aside: check cache, on a miss load from the source and
populate the cache. But a **cache stampede** (a.k.a. dogpile) happens when a hot key expires and hundreds of
concurrent requests all miss at once and hammer the database simultaneously.

**Decision & Why.** Implement `cacheAside(key, ttl, loader)` with two layers of stampede protection:
(1) **per-process single-flight** — concurrent misses for the same key on one instance share one loader
promise; (2) a short **Redis lock** (`SET NX PX`) so only one instance across the cluster rebuilds a hot key
while the others briefly wait and re-read. A loader that throws (404) is **not** cached.

```ts
const cached = await redis.get(key);
if (cached !== null) return JSON.parse(cached);        // hit
// miss: single-flight in-process + SET NX lock cross-process, then:
const value = await loader();
await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
```

**Pitfalls.** Without stampede protection, a popular key's expiry becomes a mini-outage. Don't cache errors
/ not-found (or you pin a transient failure). Set sensible TTLs (a stale-but-cheap read vs. freshness).
Remember cached JSON loses types (Dates become strings) — fine over HTTP, surprising in code.

**Quiz idea.** *What is a cache stampede and how does a per-key lock help?* → When a hot key expires, many
concurrent requests miss and all hit the DB at once. A lock (or single-flight) lets just one request rebuild
the value while the rest wait/re-read, protecting the database.

### Lesson (Task 4.3): HTTP Caching — Cache-Control & ETags

**The Problem.** Even with Redis, every read still makes a network round-trip to the API. For public,
slow-changing data, the browser or a CDN could avoid the request entirely.

**Decision & Why.** Add **`Cache-Control: public, max-age=...`** to public GET responses so browsers/CDNs
serve them without hitting the API. Express already emits a **weak ETag** for JSON bodies and returns
**304 Not Modified** when the client sends a matching `If-None-Match`, so conditional requests (revalidate
cheaply) work for free. Server-side Redis and HTTP caching are complementary layers.

```ts
res.set('Cache-Control', 'public, max-age=300'); // browser/CDN caching
// Express: weak ETag + automatic 304 on If-None-Match
```

**Pitfalls.** Only mark truly public, non-personalized responses `public` — never cache authenticated,
user-specific data in shared caches. Match `max-age` to how stale the data may be. A 304 still costs a
round-trip but skips the body; `max-age` skips the request entirely until it lapses.

**Quiz idea.** *What's the difference between what `max-age` and an ETag/304 save?* → `max-age` lets the
client skip the request entirely until it expires; an ETag with `If-None-Match` still makes the request but
returns 304 with no body when unchanged (cheap revalidation).

### Lesson (Task 4.4): Cache Invalidation

**The Problem.** "There are only two hard things in computer science…" — stale caches. When data changes, the
cached copy must be cleared, or users see old data. And a change often affects several cached keys (a course
detail *and* every catalog list page it appears in).

**Decision & Why.** Keep all cache keys in one registry (`cacheKeys`) so invalidation is knowable. On a
change, delete the specific key(s) and clear affected collections. For list pages (many cursor variants),
clear the whole prefix with **SCAN** (cursor-based, non-blocking) — never `KEYS` in production. Invalidation
is triggered by write paths / domain events (event-driven, wired via the Phase 7 outbox).

```ts
await redis.del(cacheKeys.course(slug));      // clear the detail
await invalidateByPrefix('courses:list:');    // clear list pages (SCAN + DEL)
```

**Pitfalls.** Never use `KEYS` in production — it blocks Redis scanning the whole keyspace; use `SCAN`.
Remember to invalidate **all** affected keys (detail + lists + any denormalized copies). Prefer short TTLs
as a safety net so a missed invalidation self-heals. Centralize key names so you can't forget one.

**Quiz idea.** *Why use `SCAN` instead of `KEYS` to clear cached list pages in production?* → `KEYS` scans
the entire keyspace in one blocking call, stalling Redis; `SCAN` iterates in small cursor-based batches
without blocking other clients.

---

## Phase 5 — Concurrency & Consistency

### Lesson (Task 5.1): Idempotency Keys

**The Problem.** Networks are unreliable and users double-click. A client sends `POST /complete`, the
response is lost, it retries — and the action runs twice (XP awarded twice, a payment charged twice). The
operation isn't naturally safe to repeat.

**Decision & Why.** Support an **`Idempotency-Key`** header. The first request runs and we store its
response keyed by `(user, method, path, key)`; a **replay with the same key returns the stored response**
without re-executing. Scoped per-user so keys can't collide across accounts; only successful (2xx)
responses are stored. (For truly *simultaneous* duplicates, the data layer's unique constraints/upserts are
the real guard — see 5.3; the header handles the common sequential-retry case.)

**Pitfalls.** The client must send a stable key per logical operation (a fresh UUID per user action, reused
across retries). Store only success responses (don't pin a transient 500). Give the record a TTL. Don't
rely on it alone for concurrent requests — pair it with idempotent writes.

**Quiz idea.** *What problem does an Idempotency-Key solve that a plain POST doesn't?* → Safe retries: a
lost-response retry returns the original result instead of performing the action a second time.

### Lesson (Task 5.2): Optimistic Concurrency Control (OCC)

**The Problem.** Two tabs load the same record, both edit, both save — the second silently overwrites the
first (a **lost update**). Pessimistically locking the row for the whole edit hurts throughput and can
deadlock.

**Decision & Why.** Use **optimistic** concurrency: the row carries a `version`; updates run
`WHERE id = ? AND version = <expected>` and bump the version. If someone wrote first, the version no longer
matches, **0 rows update**, and we return **409 Conflict** so the client refetches and retries. No locks
held during the (slow, user-driven) edit; conflicts are detected at the (fast) write.

```ts
await occUpdate(() => prisma.quizAttempt.updateMany({
  where: { id, version: expected },
  data: { ...changes, version: { increment: 1 } },
}));  // 0 rows -> 409
```

**Pitfalls.** The client must send the version it read and handle 409 by refetching. OCC suits low-contention
edits; under heavy contention the constant retries make pessimistic locking better. Always increment the
version in the same update.

**Quiz idea.** *In OCC, what does a versioned update affecting 0 rows mean?* → Someone else modified the row
since you read it (the version moved) — a lost-update conflict, surfaced as 409 so you refetch and retry.

### Lesson (Task 5.3): Transactions & Atomic Increments (Exactly-Once XP)

**The Problem.** Marking a lesson complete does two writes: record the completion AND add XP. If they don't
happen together, a crash between them corrupts state (completed but no XP, or XP without completion). And
`totalXP = read + amount` is a classic race — two concurrent requests both read the old value and one
increment is lost.

**Decision & Why.** Do both writes in a **transaction** (all-or-nothing) and make XP an **atomic increment**
(`{ increment: xp }` — the DB adds, no read-modify-write). Exactly-once is enforced by the **composite
primary key** on `LessonCompletion`: if two requests race, the second `create` violates the unique
constraint, its transaction rolls back, and we treat it as "already completed" — XP is never doubled.

```ts
await prisma.$transaction(async (tx) => {
  await tx.lessonCompletion.create({ data: { userId, lessonId } }); // P2002 if already done
  await tx.userStats.update({ where: { userId }, data: { totalXP: { increment: xp } } });
}); // duplicate race -> unique violation -> rollback -> no double XP
```

**Pitfalls.** Never read-modify-write a counter under concurrency — use an atomic increment. Wrap
multi-write invariants in a transaction. Let the **database constraint** be the real guard (app-level checks
race); catch the unique-violation and treat it as a no-op.

**Quiz idea.** *Why is the composite-PK unique constraint — not an "if not already completed" check — what
guarantees XP is awarded only once under concurrency?* → Two concurrent requests can both pass an app-level
check; only the DB's unique constraint atomically rejects the second insert, so exactly one transaction
commits and awards XP.

### Lesson (Task 5.4): Distributed Locks

**The Problem.** Some critical sections must run one-at-a-time across the whole cluster (e.g. "only one
active quiz attempt per user"). A single-process mutex can't help when requests land on different replicas.

**Decision & Why.** A **Redis lock**: acquire with `SET key token NX PX ttl` (atomic set-if-absent with an
expiry), run the section, then release **only if we still own it** (compare the random token via a small Lua
script, atomically). The PX expiry is a safety net so a crashed holder can't deadlock the key forever.

```ts
await withLock('attempt:' + userId, 5000, async () => { /* critical section */ });
```

**Pitfalls.** Always set a TTL (else a crash deadlocks). Release only your own lock (token compare) or you
may free someone else's after your TTL lapsed. This single-node lock is fine here; multi-node correctness is
the full Redlock algorithm. Prefer DB constraints/transactions when they can express the invariant — reach
for a lock only when they can't.

**Quiz idea.** *Why release a Redis lock by comparing a random token instead of just `DEL`-ing the key?* →
If your operation ran past the lock's TTL, the key may have expired and been re-acquired by someone else; a
blind `DEL` would free *their* lock. Token compare deletes only if you still own it.

### Lesson (Task 5.5): Testing Concurrency

**The Problem.** Race conditions hide in normal tests — a single sequential request always "works". Bugs only
appear under simultaneous load, so you must test *parallelism* explicitly.

**Decision & Why.** Write tests that fire **N parallel identical requests** and assert **exactly one effect**.
For lesson completion: 10 concurrent completes → XP awarded once, one "fresh" result and nine no-ops.
Unit-test the pure helpers (OCC → 409 on 0 rows) directly; run the DB/Redis integration tests against real
services (gated so local runs stay fast, full suite runs in CI).

```ts
const results = await Promise.all(Array.from({ length: 10 }, () => completeLesson(userId, lessonId)));
expect(results.filter(r => !r.alreadyCompleted)).toHaveLength(1); // exactly one award
```

**Pitfalls.** A sequential test can't catch a race — you must use `Promise.all`. Assert the *effect* (final
XP), not just status codes. Use a real database for concurrency tests (an in-memory fake won't reproduce
constraint/transaction behavior).

**Quiz idea.** *Why must a concurrency test use `Promise.all` (parallel) rather than sequential requests?* →
Sequential requests never overlap, so they can't trigger a race; only truly simultaneous requests exercise
the locking/constraint/transaction paths where concurrency bugs live.

---

## Phase 6 — Async Processing & Queues (BullMQ)

### Lesson (Task 6.1): Async Processing with a Job Queue

**The Problem.** Some work is slow or external — sending an email, calling a third-party API, processing an
upload. Doing it inside the request handler makes the user wait, ties up the event loop, and collapses under
spikes; if the process crashes mid-work, the work is simply lost.

**Options on the table.**
- *Do it synchronously in the request* — simple, but slow responses and no resilience.
- *Fire-and-forget in-process (`void doWork()`)* — response is fast, but no retries and the work is lost on crash/restart.
- *A durable job queue (BullMQ on Redis)* — enqueue fast, process in a separate worker, with persistence + retries. (chosen)

**Decision & Why.** The API **enqueues** a job and returns immediately; a separate **worker process**
consumes it. Jobs are durable in Redis (survive restarts), retried on failure, and the worker scales
independently of the API. Enqueue is fast and wrapped so a hiccup never fails the user's request.

```ts
await emailQueue.add('welcome', { userId, email }); // returns fast; worker sends it later
```

**Pitfalls.** Never block the request on slow/external work. Run the worker as a **separate process** (`pnpm
worker`) so background load doesn't steal the API's event loop. Keep enqueue non-fatal to the request.

**Quiz idea.** *Why move sending a welcome email to a queue instead of doing it inline during registration?*
→ So registration responds immediately and stays resilient: the email is processed by a separate worker with
retries, and a slow/failing mail provider can't slow down or break sign-up.

### Lesson (Task 6.2): Retries, Backoff & Dead-Letter

**The Problem.** Background jobs fail for transient reasons (the mail provider is briefly down). Dropping the
job loses work; retrying instantly and forever hammers the failing dependency and can spin on a "poison"
message.

**Decision & Why.** Configure **attempts + exponential backoff** so transient failures retry with growing
delays. When retries are exhausted, the job stays in the **failed set** (kept via `removeOnFail`) — BullMQ's
equivalent of a **dead-letter queue** — for inspection and manual replay. Succeeded jobs are auto-removed so
Redis doesn't fill up.

```ts
new Queue('email', { defaultJobOptions: {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: { age: 3600 },
  removeOnFail: { count: 5000 },   // exhausted jobs remain here = dead-letter
}});
```

**Pitfalls.** Use exponential (not immediate) backoff to avoid stampeding a struggling dependency. Keep
failed jobs for inspection rather than silently dropping them. Auto-remove completed jobs or Redis grows
unbounded. Beware poison messages — a job that always fails will exhaust retries; monitor the failed set.

**Quiz idea.** *What is a dead-letter queue and why is exponential backoff preferred over immediate retries?*
→ A DLQ holds jobs that exhausted their retries so they aren't lost and can be inspected/replayed;
exponential backoff spaces retries out so a briefly-failing dependency isn't hammered.

### Lesson (Task 6.3): Idempotent Job Handlers (At-Least-Once)

**The Problem.** Queues deliver **at-least-once**, not exactly-once: a job can run more than once (e.g. the
worker crashes after sending the email but before acknowledging the job, so it's redelivered). A
non-idempotent handler would send the welcome email twice.

**Decision & Why.** Make handlers **idempotent**. Guard the side-effect with a one-time marker (a Redis
`SET NX`) keyed by the business identity, so a re-run becomes a no-op. Additionally set the enqueue
`jobId` to a business key so re-enqueues of the same logical job are deduped at insert time. Both together
turn at-least-once delivery into an effectively once side-effect.

```ts
const first = await redis.set('job:welcome:done:' + userId, '1', 'EX', ttl, 'NX');
if (first === null) return; // already processed — safe no-op on redelivery
// …send the email…
```

**Pitfalls.** At-least-once ≠ exactly-once — design for redelivery. Guard *external* side-effects (email,
charges) specifically; DB writes can lean on unique constraints instead. A `jobId` dedupes enqueues but the
handler guard is still needed for crash-after-side-effect redelivery.

**Quiz idea.** *Why must a queue job handler be idempotent?* → Queues guarantee at-least-once delivery, so a
job may run more than once (e.g. redelivered after a crash); an idempotent handler ensures repeats don't
duplicate the side-effect.

---

## Phase 7 — Event-Driven Architecture & Outbox

### Lesson (Task 7.1): The Dual-Write Problem

**The Problem.** A request often needs to do two things that must both happen, or neither: change the
database, **and** tell some other system it happened (publish to a queue, call a webhook). Those are two
separate network calls to two separate systems — Postgres and Redis/BullMQ — and there's no transaction that
spans both. If the DB commit succeeds but the publish call fails (crash, network blip), the event is lost
forever with no record it should have existed. If you publish first and the DB write then fails, you've
announced something that never happened. This is the **dual-write problem** — Task 6.1's registration flow
(`await emailQueue.add(...)` right after creating the user) is a live example already in this codebase: if
that enqueue fails after the user row commits, no welcome email is ever sent, and nothing detects it.

**Options on the table.**
- *Best-effort: write DB, then publish, ignore/log publish failures* — what Task 6.1 does; simple, but silently loses events under failure.
- *Two-phase commit across Postgres and the broker* — technically solves it, but few brokers support real 2PC and it couples the two systems' availability together.
- *Transactional outbox* — write an `OutboxEvent` row in the **same DB transaction** as the change, and let a separate process relay it. The event's existence is as durable as the change itself. (chosen)

**Decision & Why.** Adopt the **transactional outbox** pattern: instead of calling out to Redis/BullMQ from
inside the request, write one more row to the database you're already committing to. Postgres gives us
atomicity for free across "the change" and "the event exists" — something no cross-system call can. A
separate **relay** (Task 7.3) is responsible for actually getting the event to the queue, on its own schedule,
with its own retries — decoupled entirely from the request path.

**Implementation.**
```prisma
model OutboxEvent {
  id           String    @id @default(cuid())
  type         String    // e.g. "LessonCompleted"
  payload      Json
  createdAt    DateTime  @default(now())
  dispatchedAt DateTime? // null = not yet relayed to the queue

  @@index([dispatchedAt, createdAt]) // supports the relay's poll query
}
```
```ts
// src/events/contracts.ts — one typed shape producers and subscribers both agree on
export type DomainEvent = { type: 'LessonCompleted'; payload: { userId: string; lessonId: string; xp: number } };
```

**Pitfalls.** The outbox table is *not* a queue itself — it's just evidence, inside the transaction, that an
event should exist; something else still has to relay it (Task 7.3). Don't `JSON.stringify` payloads by hand
into a `String` column — use a real `Json` column so it's queryable/typed. Keep event payloads self-contained
(include the data a subscriber needs, like `xp` here) so subscribers don't have to re-fetch state that might
have since changed.

**Quiz idea.** *Why can't you just call `queue.add()` right after `prisma.user.create()` and call it done?* →
Those are two independent calls to two different systems with no shared transaction — if the queue call fails
after the DB commit succeeds (or vice versa), you get a lost event or a phantom one. This is the dual-write
problem, and it's why the event write has to happen inside the same DB transaction as the change.

### Lesson (Task 7.2): Transactional Outbox in Practice

**The Problem.** Phase 5 made `completeLesson` award XP **inline**, in the same transaction as the
completion row — exactly-once, but tightly coupled: every future thing that should react to "a lesson was
completed" (XP today; streaks, notifications, analytics tomorrow) would have to be bolted into that one
transaction, growing it forever and coupling unrelated concerns into the progress module.

**Options on the table.**
- *Keep growing the transaction* — add more logic inline for every new reaction; simple per-change, but the progress module becomes a junk drawer and every new consumer needs a schema/code change here.
- *Fire events after the transaction commits* — decoupled, but reintroduces the dual-write problem (Lesson 7.1) between "commit" and "publish".
- *Write the event inside the same transaction as the completion, let a subscriber react asynchronously* — atomic with the change, decoupled from its consumers. (chosen)

**Decision & Why.** `completeLesson`'s transaction now creates the `LessonCompletion` row **and** a
`LessonCompleted` `OutboxEvent` row — nothing else. The XP increment moves out to an async subscriber
(Task 7.4). The composite PK on `LessonCompletion` still gives the *transaction* its exactly-once guarantee
(a racing duplicate hits `P2002`, rolls back, and — critically — never writes an event either, since the
event write is in the same transaction). The trade-off: `totalXP` becomes **eventually consistent** with
completions instead of updating in the same instant. That's an explicit, deliberate cost — normally
milliseconds — in exchange for a write path that no longer needs to know who cares about lesson completions.

**Implementation.**
```ts
export async function completeLesson(userId: string, lessonId: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const lesson = await tx.lesson.findUnique({ where: { id: lessonId }, select: { xp: true } });
      if (!lesson) throw AppError.notFound(`Lesson not found: ${lessonId}`);

      await tx.lessonCompletion.create({ data: { userId, lessonId } }); // still the exactly-once guard
      await writeOutboxEvent(tx, { type: 'LessonCompleted', payload: { userId, lessonId, xp: lesson.xp } });

      return { alreadyCompleted: false, xpAwarded: lesson.xp }; // "awarded" here means queued, not yet applied
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { alreadyCompleted: true, xpAwarded: 0 };
    throw e;
  }
}
```

**Pitfalls.** `writeOutboxEvent` must be called with the **same `tx`** as the rest of the transaction — pass
the ambient Postgres client, not the global `prisma` singleton, or the event write escapes the atomicity
guarantee entirely. Moving a side effect out to "eventually consistent" is a real product trade-off, not just
an implementation detail — document it (as here) so nobody's surprised that `GET /progress` might briefly lag
a completion.

**Quiz idea.** *If `tx.lessonCompletion.create()` throws a unique-constraint violation, does the outbox event
still get written?* → No — both statements are in the same transaction, so when it rolls back, neither the
completion row nor the event exists. That's exactly why the event is written inside `tx`, not after it.

### Lesson (Task 7.3): Reliable Delivery — the Outbox Relay

**The Problem.** Writing an `OutboxEvent` row makes the event durable, but it's still just a row in
Postgres — nothing has told the "events" queue (or any subscriber) that it exists. Something has to poll for
undispatched rows and hand them to the queue, and it has to do that safely even if it crashes mid-batch or
runs as multiple replicas.

**Options on the table.**
- *A single relay instance, no locking* — simple, but a single point of failure and can't scale.
- *Multiple relay replicas, plain `SELECT ... LIMIT n`* — replicas race to grab the same rows, double-publishing (mitigated only by consumer idempotency, which does extra unnecessary work).
- *Multiple replicas + `SELECT ... FOR UPDATE SKIP LOCKED`* — each replica's transaction locks a disjoint batch of rows; no coordination service needed. (chosen)

**Decision & Why.** A relay loop polls every second for a batch of undispatched rows using
`FOR UPDATE SKIP LOCKED`, publishes each to the "events" BullMQ queue with `jobId: event:<id>` (so a
re-publish after a crash is a no-op, not a duplicate), then marks the batch dispatched — all inside one DB
transaction. Publish happens **before** the rows are marked dispatched: if the process dies in between, the
transaction rolls back, the rows stay undispatched, and the next tick safely republishes them. This is the
same at-least-once-over-under-delivery choice made for job queues in Phase 6, applied one layer up.

**Implementation.**
```ts
async function relayBatch() {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`
      SELECT id, type, payload FROM "OutboxEvent"
      WHERE "dispatchedAt" IS NULL ORDER BY "createdAt" ASC LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED`;              // disjoint batches across replicas, no lock service
    for (const row of rows) {
      await eventsQueue.add(row.type, { eventId: row.id, type: row.type, payload: row.payload },
        { jobId: `event:${row.id}` });       // re-publish after a crash is deduped by BullMQ
    }
    await tx.outboxEvent.updateMany({ where: { id: { in: rows.map(r => r.id) } }, data: { dispatchedAt: new Date() } });
    return rows.length;
  });
}
```

**Pitfalls.** `SKIP LOCKED` rows are invisible to other transactions only for the *duration* of this one — keep
the batch/transaction short. Publishing before marking-dispatched (not after) is what avoids ever losing an
event; the price is a possible duplicate publish, which is why the queue-side `jobId` dedupe and the
subscriber's own idempotency (Task 7.4) both matter. A relay that polls too infrequently adds latency between
"event happened" and "subscriber reacted" — tune the interval to the freshness you need.

**Quiz idea.** *Why does `FOR UPDATE SKIP LOCKED` let you run more than one relay replica safely, without a
distributed lock?* → Each replica's transaction locks only the rows it selects; a concurrent replica's
`SELECT ... SKIP LOCKED` simply skips those already-locked rows and grabs a different batch, so replicas never
process the same row twice without any external coordination.

### Lesson (Task 7.4): Decoupling via Events — the First Subscriber

**The Problem.** With events reliably reaching the "events" queue, something has to actually *do* something
with a `LessonCompleted` event — and it has to do it safely, since BullMQ (like Phase 6) delivers
at-least-once: the same event can be handed to a subscriber more than once (a retry, a DLQ replay, or simply
the relay's own at-least-once republish from Task 7.3).

**Options on the table.**
- *Trust the queue's `jobId` dedupe alone* — mostly works, but doesn't cover manual retries/DLQ replays, which reuse the same job.
- *A subscriber-side idempotency guard, keyed by the outbox event id* — defends against redelivery regardless of source, at the cost of one Redis round-trip per event. (chosen)

**Decision & Why.** `src/queues/events.worker.ts` subscribes to the "events" queue and fans out on
`job.data.type`. The first subscriber, `handleLessonCompleted`, does exactly what used to live inline in
`completeLesson` — an atomic `totalXP` increment — but now guarded by `withEventGuard`, a Redis `SET NX`
keyed by the **outbox event's id** (not the lesson or user id, since the same lesson can of course be
completed by the same user only once, but we're guarding the *event delivery*, which could in principle be
redelivered independent of that). This is the exact same shape of fix as Task 6.3's welcome-email guard,
pulled into a small reusable helper.

**Implementation.**
```ts
async function handleLessonCompleted(eventId: string, payload: LessonCompletedPayload) {
  await withEventGuard(redis, `event:xp-awarded:${eventId}`, THIRTY_DAYS, async () => {
    await prisma.userStats.update({ where: { userId: payload.userId }, data: { totalXP: { increment: payload.xp } } });
  });
}
// events.worker.ts fans out on type — adding a second subscriber later is one more `case`, no change
// to completeLesson or the relay at all.
switch (job.data.type) {
  case 'LessonCompleted': await handleLessonCompleted(job.data.eventId, job.data.payload); break;
}
```

**Pitfalls.** Guard on the **event id**, not the business key alone — a business-keyed guard (e.g.
`xp:${userId}:${lessonId}`) would be right for *this* subscriber but wouldn't generalize to a subscriber where
the same business key legitimately fires more than once. Adding a new reaction to `LessonCompleted` (say, a
streak update) should never require touching `completeLesson` again — if it does, the decoupling isn't real.
Watch the "events" queue's failed set like any other DLQ (Phase 6) — a stuck subscriber silently means XP (or
whatever it does) never lands.

**Quiz idea.** *Why does the events worker guard on the outbox event's id rather than reusing the same
`job:welcome:done:<userId>`-style business key from Task 6.3?* → The guard has to make *event delivery*
idempotent, independent of which subscriber or business key is involved — keying on the event id means any
current or future subscriber can safely dedupe redelivery of that specific event, without assuming anything
about how often the underlying business action can occur.

---

## Phase 8 — Notifications (Multi-Channel, Realtime-Ready)

### Lesson (Task 8.1): Ports & Adapters for Notifications

**The Problem.** Users need to learn about things asynchronously — a lesson completed, XP earned, and soon
more event types and more channels (email, push). If "send a notification" is written directly as "insert a
row into a table" at every call site, adding a second channel later means finding and editing every one of
those call sites, and the business logic that triggers a notification becomes tangled with the mechanics of
delivering it.

**Options on the table.**
- *Direct, channel-specific calls at each call site* — simple today, but every new channel means editing every trigger point.
- *One function with hard-coded per-channel logic inside it* — centralizes the fan-out, but grows a conditional per channel, mixing data access, delivery, and (later) preference checks in one place.
- *Ports & adapters: a `Notifier` interface, adapters behind it* — callers depend only on `notify(message)`; each channel is an adapter implementing the same small interface. (chosen)

**Decision & Why.** Define a `Notifier` port — `send(message): Promise<void>` — and an `inAppNotifier`
adapter that durably writes to a `Notification` table. Everything that wants to notify a user calls one
function; it has no idea how many channels exist or what they are. This is the same shape of decoupling
Phase 7 established for events, applied to how those events reach a user.

**Implementation.**
```ts
export interface Notifier {
  readonly name: string;
  send(message: NotificationMessage): Promise<void>;
}

export const inAppNotifier: Notifier = {
  name: 'in-app',
  async send(message) {
    await prisma.notification.create({ data: { userId: message.userId, type: message.type, title: message.title, body: message.body, data: message.data } });
  },
};
```

**Pitfalls.** Don't let a caller import a specific adapter directly ("just insert the row here") — always go
through the port, or the decoupling is fake the moment someone takes a shortcut. Keep the `NotificationMessage`
shape channel-agnostic (title/body/data) so an adapter doesn't need channel-specific fields threaded through
every call site.

**Quiz idea.** *Why define a `Notifier` interface instead of calling `prisma.notification.create()` directly
wherever a notification is needed?* → So every call site depends on one small, stable interface; adding a new
channel (email, push) means writing one more adapter, not editing every place that currently sends a
notification.

### Lesson (Task 8.2): Event-Driven Notifications — a Second Subscriber

**The Problem.** With `LessonCompleted` already flowing through the outbox (Phase 7) to award XP, the
question is how to *also* notify the user — without re-opening `completeLesson`, the relay, or the existing
XP subscriber to do it.

**Decision & Why.** Add a **second, independent subscriber** to the same `LessonCompleted` event in
`events.worker.ts` — it doesn't know the XP subscriber exists, and vice versa. Guard it the same shape as
the XP subscriber (a Redis marker keyed by the outbox event id) but on its *own* key, since it's a distinct
side effect that needs its own idempotency. A history/bell API (`GET /notifications`, `/unread-count`,
`POST /:id/read`) exposes what accumulates in the `Notification` table, keyset-paginated newest-first.

**Implementation.**
```ts
case 'LessonCompleted': {
  const payload = job.data.payload;
  await Promise.all([
    handleLessonCompleted(job.data.eventId, payload),   // Task 7.4 — unaware this exists
    notifyLessonCompleted(job.data.eventId, payload),   // Task 8.2 — unaware that one exists
  ]);
  break;
}
```
History uses `orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]` with the keyset **cursor** still on `id` — the
cursor field only needs to be unique, not the sort key; cuids are deliberately non-sequential, so sorting by
`id` for recency would be wrong, but using it as the cursor to "resume after this row" is fine.

**Pitfalls.** Two subscribers on one event means two idempotency guards, not one shared guard — a redelivery
that's already a no-op for XP must still be independently evaluated for the notification (and vice versa).
Don't sort a history/feed by a non-sequential id — sort by a real timestamp, with the id only as a tiebreaker
and keyset cursor.

**Quiz idea.** *Why can the notification subscriber be added to `LessonCompleted` without changing
`completeLesson`, the relay, or the XP subscriber?* → Because none of those three know or care how many
subscribers exist for an event — the outbox/relay/queue only carry the event; each subscriber independently
decides whether and how to react, which is the actual payoff of the decoupling built in Phase 7.

### Lesson (Task 8.3): Scaling WebSockets with Redis Pub/Sub, Behind a Flag

**The Problem.** A live "instant" notification (no refresh needed) means holding an open connection per
connected client — a WebSocket. But once there's more than one API replica, a client's socket lives on
exactly ONE replica, while the event that should notify them can originate on a different replica, or in the
worker process, which holds no sockets at all. Something has to bridge "this event happened somewhere" to
"the one replica holding that user's socket."

**Options on the table.**
- *A WebSocket gateway with no cross-replica bridge* — works with exactly one replica; breaks the moment you scale out, since most replicas won't have the relevant socket.
- *Sticky sessions (route a user to the same replica every time)* — works, but couples routing to connection state and complicates deploys/autoscaling.
- *Redis pub/sub fan-out: every replica subscribes to one channel; whichever holds the socket forwards it* — no sticky sessions, no shared registry, scales with replica count. (chosen)

**Decision & Why.** Every replica runs a WebSocket server and subscribes to one Redis channel. Publishing a
notification means `PUBLISH`ing `{ userId, payload }`; every replica receives it, checks its own **local**
`Map<userId, Set<socket>>`, and forwards to any it actually holds (most replicas will hold none for a given
user — that's normal, not an error). Built **behind `REALTIME_ENABLED`**: the WS server and the extra Redis
connection it needs simply don't start when the flag is off, so the scaffold costs nothing until a feature
needs it.

**Implementation.**
```ts
const subscriber = redis.duplicate(); // SUBSCRIBE puts a connection into subscriber-only mode
subscriber.subscribe(CHANNEL);
subscriber.on('message', (_ch, raw) => {
  const { userId, payload } = JSON.parse(raw);
  const sockets = socketsByUser.get(userId);           // usually empty on THIS replica — fine
  sockets?.forEach((ws) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(payload)));
});
export const publishRealtime = (userId, payload) => redis.publish(CHANNEL, JSON.stringify({ userId, payload }));
```

**Pitfalls.** Never reuse your normal Redis client for pub/sub — `SUBSCRIBE` puts a connection into a mode
where it can't run other commands; always `.duplicate()`. Don't parse env booleans with `z.coerce.boolean()`
— it coerces ANY non-empty string, including the literal text `"false"`, to `true`; use an enum + transform.
An in-memory `socketsByUser` map is per-process — a restart drops local connections (clients reconnect), so
this is a "nice to have live" layer, never the only source of truth (the in-app row still is).

**Quiz idea.** *Why does the WebSocket gateway need Redis pub/sub instead of just keeping a
`Map<userId, socket>` in the API process?* → With more than one replica, a client's socket lives on only one
of them, while the triggering event can happen on any replica or in the worker. Pub/sub lets every replica
learn about the event and forward it only if it happens to hold that user's socket — no sticky sessions or
shared connection state needed.

### Lesson (Task 8.4): User Notification Preferences

**The Problem.** Not every user wants every channel — someone might want the in-app bell but not (once it
exists) a push notification for the same event. Preferences need to gate delivery without every notification
trigger having to know or check them individually, and adding the preference model shouldn't require a
migration touching every existing user row.

**Options on the table.**
- *A preferences check inside every event subscriber* — works, but duplicates the check everywhere `notify()` is called instead of once.
- *A preferences check inside `notify()` itself, gating which registered adapters run* — one place, transparent to every caller. (chosen)
- *Require a preferences row for every user (created at registration)* — explicit, but needs a backfill for users who existed before the feature; unnecessary write for users who never touch it.

**Decision & Why.** `NotificationPreference` is one row per user, and a **missing row means "all channels
enabled"** — the default — so introducing the model needed no backfill migration. `notify()` fetches the
user's preferences once and filters the adapter registry by them before fanning out, so an event subscriber
(or anything else calling `notify()`) never has to know preferences exist at all.

**Implementation.**
```ts
// missing row => defaults; only users who've changed something get a row
export async function getPreferences(userId) {
  const row = await prisma.notificationPreference.findUnique({ where: { userId } });
  return row ?? DEFAULT_PREFERENCES;
}

// notify() filters the registry by the user's prefs — callers never see this
const prefs = await getPreferences(message.userId);
const active = registry.filter((r) => prefs[r.preferenceKey]);
await Promise.allSettled(active.map((r) => r.notifier.send(message)));
```

**Pitfalls.** Don't require a row to exist for every user just to represent "the defaults" — that forces a
backfill for a feature that shipped after users already existed. Filtering happens centrally in `notify()`
so a new event subscriber automatically respects preferences without writing its own check. Consider whether
every channel should really be user-disableable — an in-app history a user can fully turn off means they may
end up with **no record at all** of something that happened to their account; that's a product decision, not
just a technical one.

**Quiz idea.** *Why does a missing `NotificationPreference` row mean "everything enabled" rather than
"everything disabled"?* → So shipping the preferences feature requires no backfill migration for users who
existed before it — every pre-existing user is correctly treated as having made no changes yet, which means
the defaults, not silence.

---

## Phase 9 — Quizzes & Timed Assessments

### Lesson (Task 9.1): Modeling Timed Attempts

**The Problem.** `QuizScore` (Phase 1) tracks a simple best-score per lesson, idempotently — fine for the
untimed quizzes already embedded in lesson content. A genuinely *timed* assessment is a different shape of
problem: it has a lifecycle (not started → in progress → submitted or expired), a deadline that must be
enforced server-side, and a scoring transition that must happen exactly once even under a double-submit.
Stretching `QuizScore` to also carry a state machine would tangle two different features into one model.

**Options on the table.**
- *Add timing fields to `QuizScore`* — reuses a table, but conflates "best score ever" (untimed, always-updatable) with "this one timed attempt's lifecycle" (bounded, transitions once).
- *A new `Quiz` + `QuizAttempt` pair* — `Quiz` holds the question bank + duration + settings; `QuizAttempt` is one row per attempt with its own state machine. (chosen)

**Decision & Why.** `Quiz.questions` stores the full question bank **including correct answers** — server-
side only; the API layer strips them before a client ever sees a question. `QuizAttempt` carries `status`
(`IN_PROGRESS`/`SUBMITTED`/`EXPIRED`), `deadlineAt` (server-computed, Task 9.2), and a `version` column
reusing Task 5.2's OCC helper for the exactly-once scoring transition (Task 9.3).

**Implementation.**
```prisma
model Quiz {
  id              String  @id @default(cuid())
  lessonId        String  @unique
  durationSeconds Int
  questions       Json    // includes correctIndex — never sent to the client as-is
  contestMode     Boolean @default(false)
  attempts        QuizAttempt[]
}

enum QuizAttemptStatus { IN_PROGRESS SUBMITTED EXPIRED }

model QuizAttempt {
  id         String            @id @default(cuid())
  quizId     String
  userId     String
  status     QuizAttemptStatus @default(IN_PROGRESS)
  deadlineAt DateTime          // server-computed — see Task 9.2
  score      Int?
  version    Int               @default(0) // OCC guard, Task 5.2
  @@index([userId, quizId, status])
  @@index([status, deadlineAt]) // the sweeper's poll query, Task 9.4
}
```

**Pitfalls.** Never let the "questions with correct answers" shape leak past the service layer into an HTTP
response — strip the answer key before returning a quiz. Index the columns your state machine actually
queries by (`[userId, quizId, status]` for "does this user have an active attempt"; `[status, deadlineAt]`
for the sweeper), not just primary keys.

**Quiz idea.** *Why introduce a new `Quiz`/`QuizAttempt` pair instead of adding a `deadlineAt` column to the
existing `QuizScore` table?* → `QuizScore` represents an always-updatable best score with no lifecycle;
a timed attempt has real state (in progress, submitted, expired) and a concurrency-sensitive transition
between those states — different enough concerns that conflating them would tangle two features into one
table.

### Lesson (Task 9.2): Server-Authoritative Time

**The Problem.** A "timed" quiz is meaningless if the client decides when time is up. If the server trusts a
client-reported elapsed time or accepts a client-supplied deadline, anyone can extend their own time limit.
Separately, starting an attempt has its own race: "check whether the user already has one in progress, then
create one" is a read-then-write sequence that two simultaneous start requests can both pass.

**Options on the table.**
- *Client reports remaining time; server trusts it* — trivial, but trivially defeated by any client the user controls.
- *Server computes and owns the deadline entirely* — the only input from the client is "start now"; the server decides when "now" plus the duration lands. (chosen)
- *A DB unique constraint alone to prevent duplicate active attempts* — would need a partial/filtered index Prisma's schema DSL can't express directly, and still leaves the read-then-write race window open around the check.

**Decision & Why.** `startAttempt` computes `deadlineAt = now() + quiz.durationSeconds`, entirely server-
side — a client can request a start, never a duration. The whole operation runs inside `withLock` (Task
5.4's distributed lock, reused here) so the "check for an active attempt, then create one" sequence is
serialized per (user, quiz) instead of racing.

**Implementation.**
```ts
export async function startAttempt(userId: string, quizId: string) {
  return withLock(`quiz:start:${userId}:${quizId}`, 5000, async () => {
    const existing = await repo.findActiveAttempt(userId, quizId);
    if (existing && existing.deadlineAt.getTime() > Date.now()) return toStartResponse(existing, quiz); // resume
    const startedAt = new Date();
    const deadlineAt = new Date(startedAt.getTime() + quiz.durationSeconds * 1000); // SERVER decides
    return repo.createAttempt({ userId, quizId, startedAt, deadlineAt });
  });
}
```

**Pitfalls.** Never accept a client-supplied duration or deadline, even "just for testing" — it's the one
thing that must never be client-controlled. A distributed lock turns a busy race into a 409, not a queue —
clients should treat that 409 as "retry shortly," not a hard failure. Resuming an existing in-progress
attempt (rather than blindly creating a new one) matters — otherwise a page refresh mid-quiz would silently
reset the clock in the user's favor.

**Quiz idea.** *Why wrap `startAttempt` in a distributed lock instead of just checking for an existing
attempt with a `findFirst` query first?* → "Check, then create" is a read-then-write race — two simultaneous
requests can both see no active attempt and both create one. A lock serializes the whole check-and-create
sequence per (user, quiz), closing the window a plain query can't.

### Lesson (Task 9.3): Safe Submissions Under Concurrency

**The Problem.** Submitting a quiz has two separate failure modes to close. First, a submission arriving
after the deadline must be rejected by the server's OWN clock — not by trusting anything the client says
about timing, and not by waiting for a periodic sweep to have already caught it. Second, a double-submit
(a flaky network causing a client retry, or a user double-clicking) must score the attempt exactly once,
not twice, and the loser of that race shouldn't see a raw error for something that, from their point of
view, already succeeded.

**Decision & Why.** `submitAttempt` re-checks `attempt.deadlineAt` against `Date.now()` at submit time,
independent of whatever the sweeper (Task 9.4) has or hasn't done yet — late is late, checked fresh, every
time. The `IN_PROGRESS -> SUBMITTED` transition uses `occUpdate` (Task 5.2) on the attempt's `version`; a
losing concurrent duplicate doesn't error — it re-fetches and replays the winner's already-computed score,
the same idempotent-response idiom used since Phase 5's `completeLesson`. On a successful transition, a
`QuizSubmitted` outbox event is written in the SAME transaction (Phase 7's pattern, reused for a new event
type) — an event exists if and only if the scoring transition actually committed.

**Implementation.**
```ts
if (attempt.deadlineAt.getTime() < Date.now()) {
  await repo.expireAttempt(attempt.id);              // don't wait for the sweeper
  throw AppError.conflict('The deadline for this attempt has passed');
}
const score = scoreAnswers(attempt.quiz.questions, answers);
try {
  await occUpdate(() => repo.submitAttemptTx(attempt, score, answers, outboxPayload)); // versioned UPDATE + outbox write, one tx
} catch (e) {
  if (isConflict(e)) {
    const fresh = await repo.findAttemptById(attempt.id);
    return { attemptId: attempt.id, score: fresh.score, alreadySubmitted: true }; // replay the winner's result
  }
  throw e;
}
```

**Pitfalls.** Checking the deadline only via the sweeper (rather than also at submit time) would leave a
window — between the deadline passing and the next sweep tick — where a late submission could still sneak
through. Don't let a losing OCC conflict become a hard error the client has to handle specially; replay the
winning result the same way an already-completed lesson does.

**Quiz idea.** *Why does `submitAttempt` check the deadline itself instead of relying on the sweeper (Task
9.4) to have already marked a late attempt `EXPIRED`?* → The sweeper runs on an interval, so there's always a
window after the deadline where an attempt is still `IN_PROGRESS` in the database. Checking the server clock
directly at submit time closes that window instead of depending on the next scheduled sweep.

### Lesson (Task 9.4): Scheduled Reconciliation — the Sweeper

**The Problem.** `submitAttempt` only rejects a late submission if someone actually tries to submit.
An abandoned attempt — a closed tab, a dropped connection, a user who simply walks away — never calls
submit at all, and would sit `IN_PROGRESS` forever without something else closing it out.

**Decision & Why.** A background sweeper polls for `IN_PROGRESS` attempts whose `deadlineAt` has passed and
flips them to `EXPIRED` (scored 0) — the same terminal state `submitAttempt` reaches on its own when it
independently notices a late submission. This is **reconciliation, not a business trigger**: it doesn't
emit an outbox event or notify anyone; it just makes sure the data eventually reflects reality even when
nobody asked it to.

**Implementation.**
```ts
async function sweepOnce() {
  const result = await prisma.quizAttempt.updateMany({
    where: { status: 'IN_PROGRESS', deadlineAt: { lt: new Date() } },
    data: { status: 'EXPIRED', submittedAt: new Date(), score: 0 },
  });
  return result.count;
}
// same poll-loop shape as the Task 7.3 outbox relay: tick, schedule the next tick, graceful stop()
```

**Pitfalls.** A sweeper and a submit-time check are meant to be redundant with each other — either alone
would eventually reach a correct state, but the submit-time check gives an honest "too late" response
immediately instead of making the user wait for the next sweep tick. Don't reach for per-row processing
(a transaction, an outbox event) here unless a real feature needs to react to expiry specifically — a blunt
`updateMany` is the right amount of machinery for pure reconciliation.

**Quiz idea.** *If `submitAttempt` already checks the deadline itself, why is a separate sweeper needed at
all?* → `submitAttempt` only runs when someone actually submits. An attempt nobody ever submits for (an
abandoned tab, a dropped connection) would stay `IN_PROGRESS` indefinitely without something else
periodically reconciling expired-but-untouched rows.

### Lesson (Task 9.5): Live Leaderboards & Matching the Guard to the Operation

**The Problem.** A contest-mode quiz wants a live leaderboard, fed by the same `QuizSubmitted` event that
already exists. The question this raises: does this new subscriber need the same idempotency guard
(a Redis marker keyed by event id) as every other subscriber so far?

**Decision & Why.** No — and that's the lesson. `recordScore` uses `ZADD key GT CH score member`: it only
updates a member's score if the new one is *greater*, so redelivering the same `QuizSubmitted` event twice
is naturally a no-op the second time — there's nothing to guard. The notification subscriber sitting right
next to it in the same event handler is guarded, because `notify()` creating a `Notification` row is NOT
naturally idempotent — running it twice creates two rows. The right idempotency strategy depends on whether
the underlying operation already tolerates repeats, not on applying the same guard everywhere reflexively.

**Implementation.**
```ts
async function updateLeaderboardOnQuizSubmitted(payload: QuizSubmittedPayload) {
  if (!payload.contestMode) return; // opt-in per quiz
  await recordScore(payload.quizId, payload.userId, payload.score); // ZADD ... GT — no guard needed, naturally idempotent
}
async function notifyQuizSubmitted(eventId: string, payload: QuizSubmittedPayload) {
  await withEventGuard(redis, `event:notified:${eventId}`, TTL, () => notify({ ... })); // guard IS needed here
}
```

**Pitfalls.** Don't reach for an idempotency guard by default on every subscriber — first ask whether the
operation is naturally safe to repeat (an upsert, a `GT`-conditioned write, a unique constraint) before
adding one. Contest mode is opt-in per quiz (`Quiz.contestMode`), so most quizzes' submissions never touch
Redis at all — check that flag before writing, not after.

**Quiz idea.** *Why doesn't the leaderboard subscriber need the same Redis event-id guard the notification
subscriber uses?* → `ZADD ... GT` is naturally idempotent: reapplying "at least this score" for the same
member is a no-op if it's already recorded. A guard is only needed for operations that aren't naturally
safe to repeat, like inserting a new notification row.

### Lesson (Task 9.6): Testing Time & Races

**The Problem.** Concurrency and timing bugs don't show up in sequential, single-request tests. Proving
"only one attempt gets created," "only one submission gets scored," and "a late submission is always
rejected" requires tests that actually race requests against each other and against a real clock.

**Decision & Why.** Pure logic (`scoreAnswers`, `toPublicQuestion`) gets ordinary unit tests — no
infrastructure, run anywhere. The concurrency/timing guarantees are proven with `Promise.all`/`allSettled`
firing N simultaneous requests (mirroring Task 5.5's pattern) against a live Postgres + Redis, gated behind
`RUN_DB_TESTS` so the fast local suite doesn't need infra. The deadline test uses a quiz seeded with a very
short `durationSeconds` and a real (short) sleep, rather than mocking the clock, so it exercises the
actual server-clock comparison, not a stand-in for it.

**Implementation.**
```ts
// N parallel starts -> exactly one IN_PROGRESS row
const results = await Promise.allSettled(Array.from({ length: 10 }, () => startAttempt(userId, quizId)));
// N parallel submits -> exactly one "winner", the rest replay its score
const results2 = await Promise.all(Array.from({ length: 10 }, () => submitAttempt(userId, attemptId, answers)));
expect(results2.filter(r => !r.alreadySubmitted)).toHaveLength(1);
```

**Pitfalls.** A sequential loop of requests can never catch a race — always fire concurrent requests with
`Promise.all`/`allSettled`. Don't fake the clock for the deadline test if a short real sleep is cheap and
proves the actual code path exercised in production. Assert on the *effect* (row counts, agreement on final
score) as well as individual response shapes.

**Quiz idea.** *Why does the deadline-enforcement test use a real short sleep instead of mocking
`Date.now()`?* → It exercises the exact comparison `submitAttempt` performs against the real system clock in
production, rather than a stand-in that might not catch a subtle bug in how the comparison itself is written.
