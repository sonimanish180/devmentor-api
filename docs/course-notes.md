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
