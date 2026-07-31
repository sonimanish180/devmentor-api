# devmentor-api

The scalable Node.js backend powering **DevMentor** — and a worked example built **0 → 1** as a system-design course inside DevMentor itself.

Two things grow together here:

- a real, production-grade API (accounts, a large course catalog, progress, **notifications**, **timed quizzes under concurrency**), built to scale to **10k–100k users**; and
- a step-by-step **course** that teaches how it's built, where every phase is framed as **problem → options → why we chose this**.

> **Start here:** [`AGENT.md`](./AGENT.md) — the build-and-teach workflow, ADR template, Definition of Done, and conventions.
> **Curriculum & architecture:** [`../devmentor-backend-course-plan.md`](../devmentor-backend-course-plan.md) and [`../devmentor-scalable-architecture.md`](../devmentor-scalable-architecture.md).

---

## Tech stack

| Concern | Choice | Introduced in |
|---|---|---|
| Language / framework | TypeScript + Express | Phase 0 |
| Database / ORM | PostgreSQL + Prisma | Phase 1 |
| Auth | Custom JWT (access + refresh, rotation) | Phase 3 |
| Cache / locks / pub-sub | Redis | Phase 4 |
| Job queue | BullMQ (on Redis) | Phase 6 |
| Eventing | Domain events + transactional outbox | Phase 7 |
| Realtime | WebSocket gateway + Redis pub/sub | Phase 8 |
| Streaming | Kafka (high-throughput, multi-consumer) | Phase 10 |
| Search | Postgres FTS → dedicated engine later | Phase 11 |
| Observability | OpenTelemetry (logs, metrics, traces) | Phase 12 |
| Containers | Docker + docker-compose | Phase 14 |
| CI/CD | GitHub Actions | Phase 15 |

Architecture: a **modular monolith** with an **event-driven backbone**, scaled as stateless replicas + worker processes. Rationale and the "why not microservices yet" argument live in the architecture doc.

---

## Quickstart

> The repo is built incrementally; commands below light up as their phase lands (see the tracker). This section is updated in the same PR that introduces each capability.

```bash
# prerequisites: Node 20+, pnpm, Docker
cp .env.example .env
docker compose up -d            # postgres, redis (+ pgbouncer/kafka added by later phases)
pnpm install
pnpm prisma migrate dev
pnpm dev                        # API on http://localhost:4000  (health: /health, ready: /ready)
pnpm worker                     # background worker (Phase 6+)
pnpm test                       # unit + integration
```

Frontend (`../devmentor`) points at the API via `NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1`.

---

## Repository layout

```
devmentor-api/
├── src/
│   ├── config/        # env loading + zod validation
│   ├── lib/           # prisma, redis, logger, jwt, queue helpers
│   ├── middleware/    # requireAuth, errorHandler, idempotency, rateLimit
│   ├── modules/       # auth/ progress/ roadmap/ quiz/ notifications/  (hard boundaries)
│   ├── events/        # domain-event contracts + outbox relay
│   ├── app.ts         # express app wiring
│   ├── server.ts      # API entrypoint (graceful shutdown)
│   └── worker.ts      # queue worker entrypoint
├── prisma/            # schema.prisma + migrations
├── tests/             # unit, integration (Testcontainers), concurrency, load (k6)
├── docs/adr/          # Architecture Decision Records (NNNN-title.md)
├── docker-compose.yml
├── Dockerfile
├── AGENT.md
└── README.md
```

---

## Phase tracker

High-level progress. **Granular, task-level tracking with execution prompts lives in [`TASKS.md`](./TASKS.md)** — that's the working tracker we update task by task. Statuses: ⬜ not started · 🟡 in progress · ✅ done.

| # | Phase | Status | ADR | Course lesson | PR(s) |
|---|---|---|---|---|---|
| 0 | Foundations & project setup | ✅ | [0001](./docs/adr/0001-foundational-stack.md) | [Phase 0 module](../devmentor/src/data/backend-build-curriculum.ts) (7 lessons) | — |
| 1 | Data modeling & persistence | ✅ | [0002](./docs/adr/0002-postgres-prisma-data-modeling.md) | [Phase 1 module](../devmentor/src/data/backend-build-curriculum.ts) (5 lessons) | — |
| 2 | API design & validation | ✅ | [0003](./docs/adr/0003-rest-api-style.md) | [Phase 2 module](../devmentor/src/data/backend-build-curriculum.ts) (5 lessons) | — |
| 3 | Authentication & security | ✅ | [0004](./docs/adr/0004-custom-jwt-auth.md) | [Phase 3 module](../devmentor/src/data/backend-build-curriculum.ts) (6 lessons) | — |
| 4 | Caching & read performance (Redis) | ✅ | [0005](./docs/adr/0005-redis-cache-aside.md) | [Phase 4 module](../devmentor/src/data/backend-build-curriculum.ts) (4 lessons) | — |
| 5 | Concurrency & consistency | ✅ | [0006](./docs/adr/0006-concurrency-strategy.md) | [Phase 5 module](../devmentor/src/data/backend-build-curriculum.ts) (5 lessons) | — |
| 6 | Async processing & queues (BullMQ) | ✅ | [0007](./docs/adr/0007-bullmq-task-queue.md) | [Phase 6 module](../devmentor/src/data/backend-build-curriculum.ts) (3 lessons) | — |
| 7 | Event-driven architecture & outbox | ✅ | [0008](./docs/adr/0008-transactional-outbox.md) | [Phase 7 module](../devmentor/src/data/backend-build-curriculum.ts) (4 lessons) | — |
| 8 | Notifications (multi-channel, realtime) | ✅ | [0009](./docs/adr/0009-notifications-ports-adapters-realtime.md) | [Phase 8 module](../devmentor/src/data/backend-build-curriculum.ts) (4 lessons) | — |
| 9 | Quizzes & timed assessments | ✅ | [0010](./docs/adr/0010-server-authoritative-timing.md) | [Phase 9 module](../devmentor/src/data/backend-build-curriculum.ts) (6 lessons) | — |
| 10 | Messaging at scale (Kafka) | ⬜ | — | — | — |
| 11 | Search & content delivery | ⬜ | — | — | — |
| 12 | Observability & operations | ⬜ | — | — | — |
| 13 | Testing & quality | ⬜ | — | — | — |
| 14 | Containerization (Docker) | ⬜ | — | — | — |
| 15 | CI/CD, deployment & scaling | ⬜ | — | — | — |

**Milestones:** A = Phases 0–5 (shippable MVP) · B = 6–9 (reactive platform) · C = 10–11 (scale & streaming) · D = 12–15 (production excellence).

---

## Architecture Decision Records

Every real decision is recorded in [`docs/adr/`](./docs/adr) as `NNNN-title.md` (problem → options → decision → consequences). Index:

| ADR | Title | Phase | Status |
|---|---|---|---|
| [0001](./docs/adr/0001-foundational-stack.md) | Foundational stack & project shape | 0 | Accepted |
| [0002](./docs/adr/0002-postgres-prisma-data-modeling.md) | PostgreSQL + Prisma, normalized + JSONB | 1 | Accepted |
| [0003](./docs/adr/0003-rest-api-style.md) | REST as the API style (over GraphQL/tRPC) | 2 | Accepted |
| [0004](./docs/adr/0004-custom-jwt-auth.md) | Custom JWT auth (over Auth.js/managed) | 3 | Accepted |
| [0005](./docs/adr/0005-redis-cache-aside.md) | Redis cache-aside for read performance | 4 | Accepted |
| [0006](./docs/adr/0006-concurrency-strategy.md) | Concurrency: idempotency, OCC, transactions, locks | 5 | Accepted |
| [0007](./docs/adr/0007-bullmq-task-queue.md) | BullMQ for background jobs (not Kafka yet) | 6 | Accepted |
| [0008](./docs/adr/0008-transactional-outbox.md) | Transactional outbox for domain events | 7 | Accepted |
| [0009](./docs/adr/0009-notifications-ports-adapters-realtime.md) | Notifications: ports/adapters + realtime behind a flag | 8 | Accepted |
| [0010](./docs/adr/0010-server-authoritative-timing.md) | Server-authoritative timing for quiz attempts | 9 | Accepted |

---

## License / status

Internal learning + product project. Work in progress — see the phase tracker for what's live.
