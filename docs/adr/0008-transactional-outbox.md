# ADR-0008: Transactional outbox for domain events (not direct publish)

- Status: Accepted
- Date: 2026-07-27
- Phase: 7 — Event-Driven Architecture & Outbox
- Deciders: DevMentor team

## Problem

Some request-path changes need to tell other parts of the system "this happened" — award XP when a lesson
completes today; notify, update a streak, or feed analytics tomorrow. That requires two writes to two
different systems: a Postgres change, and a message to a broker/queue. Postgres transactions don't span
Redis/BullMQ, so a naive "commit, then publish" (already in this codebase: Task 6.1's registration flow
calls `emailQueue.add()` right after `prisma.user.create()`) can silently lose the message if the publish
call fails after the DB commit — the **dual-write problem**. We need every domain event to be exactly as
durable as the change it describes, without coupling the request path's success to a broker being reachable.

## Options considered

1. **Transactional outbox** — write an `OutboxEvent` row in the *same* DB transaction as the business
   change; a separate relay process polls undispatched rows and publishes them to a queue, then marks them
   dispatched. The event's existence is as atomic with the change as any other row in that transaction.
   (chosen)
2. **Publish-after-commit, best effort** — call the queue right after the transaction commits (what Task 6.1
   does today for welcome emails). Simple, zero new infrastructure, but a crash/network blip between commit
   and publish loses the event with no record it should have existed.
3. **Two-phase commit (2PC) across Postgres and the broker** — theoretically solves atomicity across both
   systems, but few brokers support real distributed transactions, and it couples the availability and
   latency of two systems together on every write — the opposite of the decoupling we want events for.
4. **Change Data Capture (CDC) off the WAL** (e.g. Debezium) — reads committed rows directly from Postgres's
   write-ahead log, no outbox table needed. Powerful and used at larger scale, but a new heavyweight
   operational dependency (a CDC connector + Kafka/streaming platform) — premature before we've even
   introduced Kafka (deferred to Phase 10 per ADR-0007's graduation criteria).

## Decision

Adopt the **transactional outbox** pattern. Domain events are typed contracts (`src/events/contracts.ts`)
written via `writeOutboxEvent(tx, event)` inside the *same* Prisma transaction as the change they describe
(`OutboxEvent` model, Task 7.1–7.2). A separate **relay** (`src/events/relay.ts`, run in the worker process)
polls undispatched rows with `SELECT ... FOR UPDATE SKIP LOCKED` — safe to run as multiple replicas with no
external lock — publishes each to a BullMQ **"events" queue** with a deterministic `jobId: event:<id>` (so a
re-publish after a crash mid-batch is a dedupe, not a duplicate), then marks the batch dispatched, all inside
one transaction (Task 7.3). A subscriber worker (`src/queues/events.worker.ts`) fans out on `event.type` and
is itself idempotent, guarding each side effect with a Redis marker keyed by the **outbox event's id** (Task
7.4) — the same shape of fix as ADR-0007's idempotent job handlers, one layer up.

The first payoff: `completeLesson`'s transaction (Phase 5) no longer increments XP inline. It only creates
the `LessonCompletion` row and a `LessonCompleted` event, in one transaction. The XP increment moved to the
async subscriber. `totalXP` is therefore now **eventually consistent** with completions (normally
milliseconds) — an explicit trade-off in exchange for a write path that doesn't need to know who reacts to a
completion, and stays exactly-once (the composite PK on `LessonCompletion` still guards that) regardless of
how many things react to it later.

## Consequences

- **+** No dual-write risk: an event's existence is guaranteed by the same transaction as the change it
  describes — a crash can lose neither, since they commit or roll back together.
- **+** Decouples producers from consumers: `completeLesson` doesn't import a queue or know that XP-awarding
  (or future streak/notification logic) exists. Adding a new subscriber to `LessonCompleted` never touches
  the write path.
- **+** `FOR UPDATE SKIP LOCKED` makes the relay horizontally scalable with zero coordination
  infrastructure — a plain Postgres transaction is the only "lock service" needed.
- **−** `totalXP` (and anything else driven by an outbox event) is eventually, not immediately, consistent
  with the write that caused it — a small window (relay poll interval + subscriber processing) now exists
  between "lesson completed" and "XP visible". Callers that need read-your-writes strength on XP specifically
  would need to special-case it (not currently required).
- **−** More moving parts than a direct publish: a table, a relay loop, a queue, and a subscriber, versus one
  `queue.add()` call. Justified once more than one thing needs to react to the same change (which is already
  true here, and will be more true from Phase 8 notifications on).
- **−** At-least-once delivery persists at every hop (relay → queue → subscriber), so subscriber idempotency
  is mandatory, not optional — the same discipline ADR-0007 established for job queues, now required one
  layer further out.
- **Revisit when:** event volume or replay/audit needs outgrow a polled Postgres table — that's exactly
  Kafka's turf, and ADR-0007's Kafka graduation criteria apply equally here (Phase 10 can source its Kafka
  producer directly from this same outbox table).
