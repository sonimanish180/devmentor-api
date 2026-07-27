# ADR-0006: Concurrency strategy — idempotency, OCC, transactions, locks

- Status: Accepted
- Date: 2026-06-21
- Phase: 5 — Concurrency & Consistency
- Deciders: DevMentor team

## Problem

Concurrent and repeated requests must not corrupt state: a double-clicked/retried "complete lesson" must
not award XP twice, two tabs editing one record must not silently lose an update, and some operations must
run one-at-a-time across replicas. We need a coherent set of techniques and a rule for when to use each.

## Options considered

- **Do nothing / hope** — races corrupt data under load. Rejected.
- **Pessimistic locking everywhere** — lock rows for the duration of work. Correct but low-throughput and
  deadlock-prone; overkill for most paths.
- **A layered toolkit** — pick the lightest correct tool per situation. (chosen)

## Decision

Adopt a layered toolkit and apply the lightest sufficient tool:

1. **Idempotency keys** on state-changing POSTs — safe retries (sequential duplicates return the stored result).
2. **Database constraints + transactions + atomic increments** — the primary guard. Composite-PK unique
   constraints make writes exactly-once; multi-write invariants run in a transaction; counters use atomic
   `increment` (never read-modify-write).
3. **Optimistic concurrency (version → 409)** — for read-modify-write on mutable rows (lost-update
   prevention) without holding locks.
4. **Redis distributed lock (`SET NX PX` + token release)** — only for cross-request critical sections that
   constraints/transactions can't express.

Prefer DB constraints/transactions first; reach for OCC when editing mutable rows; use a distributed lock
only when nothing else expresses the invariant.

## Consequences

- **+** Correct under concurrent load with minimal locking; each mechanism is small, testable, and reusable
  (OCC and the lock feed Phase 9's timed quizzes directly).
- **+** Exactly-once effects proven by parallel-request tests.
- **−** More concepts for contributors to learn; the wrong tool (e.g. a lock where a constraint would do)
  adds needless contention.
- **−** The idempotency middleware and the lock are in-memory/single-Redis; a hard multi-node guarantee would
  need full Redlock. Acceptable at current scale.
- **Revisit when:** contention on a hot row is high (consider queueing/serialization), or we need
  multi-region correctness (full Redlock / a consensus store).
