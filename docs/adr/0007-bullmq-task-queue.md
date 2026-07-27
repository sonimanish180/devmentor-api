# ADR-0007: BullMQ for background jobs (not Kafka yet)

- Status: Accepted
- Date: 2026-06-21
- Phase: 6 — Async Processing & Queues
- Deciders: DevMentor team

## Problem

Slow/external side-effects (welcome emails now; notification fan-out, grading, analytics later) must move
off the request path onto durable background processing with retries. We need to pick a queue/broker — and,
critically, decide *when* the simple choice stops being enough.

## Options considered

1. **BullMQ (Redis-backed task queue)** — job queues with retries/backoff, delayed jobs, concurrency, and a
   failed-set (DLQ). Reuses the Redis we already run; minimal new infra; great DX. (chosen)
2. **RabbitMQ** — mature broker with rich routing; another stateful system to run, heavier than we need for
   task queues at this stage.
3. **Kafka** — a distributed, replayable log for high-throughput, multi-consumer event streaming. Powerful,
   but operationally heavy and overkill for task queues; its strengths (replay, many independent consumers,
   huge throughput) aren't needed yet.

## Decision

Use **BullMQ** for task/job work: a separate worker process, `attempts` + exponential backoff, a retained
failed set as a dead-letter queue, and **idempotent handlers** (at-least-once delivery). It reuses Redis
(already in the stack for caching/locks). **Kafka is deferred to Phase 10**, adopted only when we hit its
graduation criteria.

### Graduation criteria — adopt Kafka when we need:
- high-throughput **event streaming** (analytics, activity feeds) beyond task queues;
- **multiple independent consumers** of the same event stream;
- **replay / audit** of an event log over time;
- durable ordering/partitioning at a scale Redis queues strain under.

## Consequences

- **+** Fast to build, no new infra, retries/backoff/DLQ out of the box; scales the worker independently.
- **+** Clear, measurable trigger for moving to Kafka rather than a premature adoption.
- **−** BullMQ is Redis-bound (not a durable log; limited replay/multi-consumer semantics) — the very gap
  Kafka fills later.
- **−** At-least-once delivery pushes idempotency onto handlers (by design).
- **Revisit when:** any graduation criterion above is met (Phase 10 introduces Kafka alongside BullMQ, each
  for what it's best at).
