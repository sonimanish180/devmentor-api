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
