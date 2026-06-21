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
