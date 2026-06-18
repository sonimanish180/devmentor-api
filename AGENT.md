# AGENT.md — How we build `devmentor-api` (and teach it as we go)

This file is the **operating procedure** for anyone (human or AI agent) working on this backend. The mandate is dual: **ship a production-grade Node.js backend** *and* **turn each step into a DevMentor course lesson**. Code is not "done" until it is also **explained**.

Read this with `../devmentor-backend-course-plan.md` (the phase curriculum) and `./README.md` (run instructions + progress tracker).

---

## 1. Prime directives

1. **Problem before solution.** Never introduce a library, pattern, or piece of infrastructure (Redis, Kafka, locks, queues…) until the concrete problem that justifies it exists in the system. Every addition must answer: *what breaks without this?*
2. **Document the road not taken.** For every real decision, record the alternatives considered and **why** the chosen one won (and when we'd revisit). This is an **ADR** (Architecture Decision Record).
3. **Teach as you build.** Each phase produces both code and a DevMentor lesson in the "Build a Scalable Backend (0 → 1)" track, in the format **Problem → Options → Decision & Why → Implementation → Pitfalls → Quiz**.
4. **Keep it runnable.** `docker compose up` must always bring the full stack up green on `main`. A broken `main` is the highest-priority fix.
5. **Correctness over cleverness.** Prefer the simplest solution that is genuinely production-sound. Especially for concurrency: assume two requests arrive at the same instant.

---

## 2. The per-phase loop

Work proceeds **one phase at a time** (phases defined in the course plan). For each phase:

```
1. FRAME    Write/curate the problem statement. Capture a failing scenario or metric
            that proves the problem is real (e.g., "double-click submits score twice").
2. EXPLORE  List 2–4 realistic options with pros/cons. Spike if needed.
3. DECIDE   Write an ADR (template in §4). Pick the option; state trade-offs + revisit trigger.
4. BUILD    Implement in small PRs. Follow the conventions in §6.
5. PROVE    Tests pass — including concurrency/load tests where the phase warrants them.
6. TEACH    Author the DevMentor lesson(s) from the ADR + code (format in §5).
7. RECORD   Update README phase tracker + ADR index. Verify `docker compose up` is green.
```

A phase is **complete** only when step 7 is done (full Definition of Done in §3).

---

## 3. Definition of Done (per phase)

- [ ] Code merged to `main`; lint + typecheck + tests pass in CI.
- [ ] Tests cover the happy path **and** the failure/edge cases; **concurrency tests** exist where the phase touches shared state (Phases 5, 6, 7, 9 at minimum).
- [ ] An **ADR** exists in `docs/adr/NNNN-title.md` (problem → options → decision → consequences).
- [ ] The matching **DevMentor lesson(s)** are authored in the course track (see §5) and reviewed for accuracy against the real code.
- [ ] `README.md` **phase tracker** row flipped to ✅ with links to the PR(s), ADR, and lesson(s).
- [ ] `docker compose up` brings the whole stack up healthy; `.env.example` updated if new config was added.
- [ ] Security baseline (§7) re-checked for anything the phase introduced.

If any box is unchecked, the phase is *in progress*, not done.

---

## 4. ADR (Architecture Decision Record)

One ADR per real decision. Store as `docs/adr/NNNN-kebab-title.md` (zero-padded, incrementing). Keep them short and honest.

```markdown
# ADR-0007: Use a transactional outbox for domain events

- Status: Accepted
- Date: YYYY-MM-DD
- Phase: 7 — Event-Driven Architecture
- Deciders: <names>

## Problem
Writing to the DB and publishing an event are two operations; if the process
crashes between them we lose the event (the "dual-write problem"). Concretely:
awarding XP on LessonCompleted silently fails ~X% under crash testing.

## Options considered
1. Direct service call from producer to consumer — simple, but tightly coupled
   and still loses work on crash.
2. Publish to the queue right after commit — still a dual-write; event lost if
   the publish fails after commit.
3. Transactional outbox — write event row in the same tx, relay to the queue.
   More moving parts, needs a relay + idempotent consumers.
4. CDC (Debezium) streaming the outbox/table — most robust, most infra.

## Decision
Option 3 (transactional outbox) with at-least-once delivery and idempotent
consumers. Defer CDC (option 4) until event volume justifies it (see Phase 10).

## Consequences
+ No lost events; modules decoupled; consumers retry safely.
− Added relay process + outbox table; consumers must be idempotent.
Revisit when: event throughput exceeds <threshold> or we need replay/audit.
```

Every ADR maps to a lesson — the ADR *is* the lesson's "Decision & Why" section.

---

## 5. Turning a phase into a DevMentor lesson

Lessons live in the `devmentor` app as data, using its existing `Module`/`Lesson`/`LessonBlock` types (see `devmentor/src/types/index.ts`). Add a new track file, e.g. `devmentor/src/data/backend-build-curriculum.ts`, exporting `backendBuildCurriculum: Module[]`, and register it in `curriculum.ts` (`allModules`) + the home page (a new track tab) — exactly how the DSA track was added.

**One module per phase. Lessons follow this block sequence:**

| Lesson section | Block type(s) to use |
|---|---|
| The Problem (with failing scenario/metric) | `heading` + `paragraph` + optional `callout variant:"warning"` |
| Options on the table | `heading` + `list` (each item: option — pro / con) |
| The Decision & Why (from the ADR) | `heading` + `paragraph` + `callout variant:"tip"` |
| Implementation (real code from this repo) | `heading` + `code` (paste the actual file, trimmed) |
| Pitfalls & edge cases | `callout variant:"warning"` / `list` |
| Diagram (when it helps) | `diagram` (ASCII, the LessonViewer renders it) |
| Knowledge check | `quiz: [...]` (2–3 questions, pass 70%) |

**Authoring rules:**
- Code blocks must be **copied from the merged code**, not invented — keep lessons true to the repo.
- Keep IDs unique and prefixed (e.g., module slug `backend-phaseN-…`, lesson id `bb-…`) so they never collide with other tracks.
- After adding/editing lessons, run `npx tsc --noEmit` in `devmentor/` before committing.
- A lesson is reviewed against the actual endpoint/behavior before the phase is marked done.

---

## 6. Repository conventions

- **Structure:** `routes → controllers → services → repositories (Prisma)`. No DB calls in controllers; no business logic in routes. Modules under `src/modules/<name>/` own their tables and expose a service interface; **cross-module communication is via events or service interfaces only** — never reach into another module's tables.
- **Language/tooling:** TypeScript (strict), Express, Prisma, zod for all input validation, pino for logs. `pnpm` scripts; `tsx` in dev.
- **Errors:** throw typed `AppError`s; one centralized error handler maps them to the JSON error envelope. Never leak stack traces in production.
- **Config:** everything via env, validated by zod at boot (`src/config`). Nothing secret in the repo; keep `.env.example` current.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`). Reference the phase, e.g. `feat(phase-5): idempotency-key middleware`.
- **Branches/PRs:** small PRs, one concern each; PR description links the ADR and notes the failing scenario it fixes.
- **Migrations:** Prisma Migrate only; **expand-then-contract** for anything that could break running instances.

---

## 7. Security baseline (re-check every phase)

- Passwords hashed with **argon2id** (or bcrypt cost ≥ 12); never log secrets, tokens, or passwords.
- Access token in memory; **refresh token only in an httpOnly, Secure, SameSite cookie**, stored hashed, rotated, with reuse detection.
- **Validate every input** with zod at the edge; rely on Prisma for parameterized queries (no string-built SQL).
- `helmet`, **CORS** locked to the frontend origin (`credentials: true`), **rate limiting** on auth + submission routes.
- Authorization checks on every resource (a user can only touch their own data; role checks for privileged ops).
- Secrets via env/secret manager; HTTPS in production; dependencies scanned in CI.

---

## 8. Concurrency baseline (the system-design heart)

Whenever a request mutates shared state, apply the relevant guard and **test it with parallel requests**:

- **Idempotency keys** on every state-changing POST (dedupe double-submits/retries).
- **Idempotent writes** via upsert / `ON CONFLICT` so repeats can't double-apply (e.g., XP).
- **Optimistic concurrency** (`version` column → `409 Conflict`) for editable resources.
- **Transactions + atomic increments** for scoring/counters; never read-modify-write across requests.
- **Server-authoritative time** for anything timed (store `deadlineAt`; never trust the client clock); a sweeper job finalizes expired work.
- **Distributed locks (Redis Redlock)** only for genuine cross-request critical sections; keep them short and fenced.
- **Connection pooling** (PgBouncer) so concurrency spikes don't exhaust Postgres connections.

Each of these gets demonstrated with a failing-then-passing test in its phase.

---

## 9. Testing baseline

- **Unit:** pure logic (scoring, token rotation, validators) with mocked deps.
- **Integration:** `supertest` against the app on a disposable Postgres/Redis (Testcontainers). Cover auth lifecycle, authz, and CRUD.
- **Concurrency:** fire N parallel identical requests; assert exactly one effect (Phases 5/6/7/9).
- **Load:** k6 on the hot/submission paths before a milestone ships.
- CI gates: lint, typecheck, tests, coverage threshold.

---

## 10. Quickstart (kept current as the project grows)

```bash
# prerequisites: Node 20+, pnpm, Docker
cp .env.example .env
docker compose up -d           # postgres, redis (+ pgbouncer/kafka as phases add them)
pnpm install
pnpm prisma migrate dev
pnpm dev                       # API on :4000
pnpm worker                    # queue worker (from Phase 6)
pnpm test                      # unit + integration
```

> As each phase introduces new services/commands, **update this section and `README.md`** in the same PR (it's part of the Definition of Done).

---

## 11. Phase tracker

The single source of truth for progress is the table in `README.md`. Update it at the end of every phase (status, PR links, ADR link, lesson link). Do not let it drift.
