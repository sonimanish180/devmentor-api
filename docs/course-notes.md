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
