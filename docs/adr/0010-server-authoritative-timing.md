# ADR-0010: Server-authoritative timing for quiz attempts

- Status: Accepted
- Date: 2026-08-05
- Phase: 9 — Quizzes & Timed Assessments
- Deciders: DevMentor team

## Problem

A timed quiz needs a deadline nobody can move. If a client computes or reports "time remaining" and the
server trusts it, a modified client (or a paused debugger, a rewound clock, a replayed request) can extend
its own time limit arbitrarily — the exact opposite of what "timed" is supposed to guarantee. On top of pure
timing, a timed attempt is a small state machine (not started → in progress → submitted or expired) that
must survive being hit from multiple tabs, retried requests, and abandoned sessions, while a scored result is
awarded exactly once even when a client double-submits.

## Options considered

1. **Server sets and enforces the deadline; client only reads it** — the server records
   `startedAt`/`deadlineAt` when an attempt starts and is the sole authority on whether a submission is late,
   at submit time, independent of any sweep. (chosen)
2. **Client reports elapsed/remaining time; server trusts it** — trivial to implement, but trivially
   defeated by any client the user controls (a modified request body, a paused JS timer).
3. **Server issues a signed, time-boxed token (e.g. a JWT with `exp`) instead of a DB row** — avoids a
   write at start time, but still needs a durable row for the single-active-attempt guarantee, the score,
   and the submitted answers, so it doesn't actually remove the need for `QuizAttempt`; it would just move
   the deadline into a token that has to be validated against the same clock anyway.

For enforcing "only one active attempt" and "exactly-once scoring" specifically:

1. **A Redis distributed lock (`withLock`, Task 5.4) around start, and OCC (`occUpdate`, Task 5.2) around
   submit** — reuses primitives already proven in Phase 5, one for the read-then-write race at start, the
   other for the double-submit race at finish. (chosen)
2. **Rely on a database unique constraint alone** — would need a partial/filtered unique index
   (`WHERE status = 'IN_PROGRESS'`), which Prisma's schema DSL doesn't express directly; achievable via a raw
   migration, but doesn't remove the need for OCC on submit, so it's an addition, not a replacement.

## Decision

`startAttempt` computes `deadlineAt = now() + quiz.durationSeconds`, entirely server-side, and never accepts
a client-supplied duration or deadline. It runs inside `withLock('quiz:start:<user>:<quiz>', ...)` because
"check for an existing active attempt, then create one" is a read-then-write race that a lock (not a
`SELECT` alone) closes. `submitAttempt` independently re-checks `deadlineAt` against `Date.now()` at submit
time — it does **not** rely on the sweeper (Task 9.4) having already flipped the row to `EXPIRED` — so a
late submission is rejected even in the window before the next sweep runs. The `IN_PROGRESS -> SUBMITTED`
transition uses `occUpdate` (Task 5.2) on a versioned row; a losing concurrent duplicate submit doesn't error
out, it replays the winner's already-computed result, the same idempotent-response idiom used since Phase 5.
A background **sweeper** (poll loop, same shape as the Task 7.3 outbox relay) reconciles attempts nobody ever
submitted — abandoned tabs, dropped connections — flipping them to `EXPIRED` once their deadline has passed.

Scoring reuses Phase 7's transactional outbox: the version-guarded `UPDATE` and a `QuizSubmitted` event write
happen in one transaction, so an event exists if and only if the scoring transition actually committed.
Two independent subscribers react to it (Phase 8's pattern again) — one updates a contest-mode leaderboard,
one sends a notification — without touching `submitAttempt`.

## Consequences

- **+** No client input can extend a deadline — the only clock that matters is the server's, checked twice
  (once by whichever request happens to submit late, once by the sweeper for attempts nobody submits at all).
- **+** Reuses two Phase 5 primitives (`withLock`, `occUpdate`) instead of inventing new concurrency
  mechanisms — the "single active attempt" and "exactly-once score" problems are structurally the same shape
  as problems already solved for lesson completion.
- **+** The sweeper and the submit-time check are redundant with each other by design: either one alone
  would eventually produce a correct terminal state, but checking at submit time means a user doesn't have to
  wait for the next sweep tick to be told they're too late.
- **−** `withLock`'s 409-on-busy means a genuine double-click on "start quiz" can surface a transient 409
  to the client, not just a malicious duplicate — clients should treat a 409 here as "retry shortly," not a
  hard failure.
- **−** The sweeper's `updateMany` is a blunt reconciliation pass (no per-row outbox event on expiry) — an
  abandoned attempt currently produces no notification or leaderboard update when it expires; only an
  explicit submit does. Acceptable for now; revisit if "you ran out of time" needs to be a first-class event.
- **−** A single-instance Redis lock (not full Redlock) is "good enough here," per Task 5.4's original
  scope — the same trade-off carries forward into quiz start.
- **Revisit when:** contest mode needs strict, provable fairness (e.g. anti-cheat, server-side answer
  randomization, or disqualifying attempts that are statistically implausible) — none of that is in scope
  here; this ADR only covers correctness of timing and exactly-once scoring.
