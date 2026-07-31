# ADR-0009: Notifications via ports & adapters, with realtime behind a flag

- Status: Accepted
- Date: 2026-07-31
- Phase: 8 — Notifications (multi-channel, realtime-ready)
- Deciders: DevMentor team

## Problem

Users need to learn about things that happen asynchronously — today, that a lesson completed and XP was
earned; soon, course updates, streak warnings, and (once Phase 9 lands) quiz/contest results. That's already
more than one channel (an in-app bell now; email and live push are obvious next steps) and more than one
event type. If notification-sending logic is written directly against "insert a row" today, adding email or
push later means touching every call site. We also want a live "instant" experience eventually (a
WebSocket push, not a page-refresh-to-see-it), but building and operating that before anything actually
needs it is premature cost.

## Options considered

1. **Ports & adapters (hexagonal): a `Notifier` interface, N adapters behind it** — callers depend only on
   `notify(message)`; the in-app DB write is one adapter among possibly several. Adding a channel is a new
   adapter + one line in a registry, not a change to every caller. (chosen)
2. **Direct, channel-specific calls at each call site** — simplest to write once, but every new channel
   (email, push) means finding and editing every place a notification is triggered; channels and business
   logic become tangled.
3. **A generic "notification service" with hard-coded channel logic inside one function** — centralizes the
   fan-out, but the function itself grows a conditional per channel and mixes concerns (data access, per-
   channel delivery, preference checks) in one place instead of separating them.

For realtime specifically:

1. **A WebSocket gateway scaffold, behind `REALTIME_ENABLED`, using Redis pub/sub for cross-replica
   delivery** — the shape (auth'd connections, a `Notifier` adapter, pub/sub fan-out) exists now, at near-
   zero cost while off, ready to flip on when a feature needs it. (chosen)
2. **Build it fully and turn it on immediately** — same shape, but pays the operational cost (an extra
   long-lived connection type per client, another thing to monitor) before anything depends on it.
3. **Polling from the client instead of push** — zero new infrastructure, but adds latency and either wastes
   requests (aggressive polling) or feels laggy (conservative polling); doesn't scale well as "instant"
   features (Phase 9's live leaderboard) get added.

## Decision

Introduce a `Notifier` **port** (`src/notifications/notifier.ts`) — `send(message): Promise<void>` — and
route every notification through one `notify()` fan-out (`src/notifications/index.ts`) that calls every
**registered adapter** whose channel the user hasn't disabled. The first adapter is `inAppNotifier`
(Task 8.1), which durably writes to the `Notification` table — the record backing the bell/history API
(Task 8.2, `GET /notifications`, unread-count, mark-read). `LessonCompleted` (Phase 7's outbox event) now
has **two independent subscribers** — award XP, and send a notification — added without touching
`completeLesson`, the relay, or each other; that's the direct payoff of Phase 7's decoupling.

A `realtimeNotifier` adapter (Task 8.3) pushes over WebSocket, fronted by **Redis pub/sub** so delivery is
correct across multiple API replicas (a client's socket lives on exactly one replica; pub/sub lets whichever
replica holds it forward the message, with no sticky sessions or shared connection registry). It's registered
in the notifier registry only when `REALTIME_ENABLED=true` — off by default, a scaffold, not yet
load-bearing.

**Channel preferences** (Task 8.4, `NotificationPreference`, one row per user, missing row = all-defaults-on)
gate the fan-out: `notify()` checks `getPreferences(userId)` and only calls adapters the user has left
enabled. `GET`/`PATCH /notifications/preferences` let a user change them.

## Consequences

- **+** Adding a channel (email, push) is additive: write an adapter implementing `Notifier`, register it
  (optionally behind its own flag), done — no existing caller of `notify()` changes.
- **+** Two subscribers reacting to one outbox event (XP, notification) with zero coupling between them
  demonstrates Phase 7's decoupling actually paying off, not just a diagram.
- **+** The realtime scaffold costs nothing while `REALTIME_ENABLED=false` (no WS server started, no extra
  Redis connection opened) — the architecture is ready without the operational bill coming due early.
- **+** `NotificationPreference` needed no backfill migration: a missing row defaults to "everything on,"
  so every pre-existing user is correctly handled without a data migration step.
- **−** Every `notify()` call now does a preference lookup before sending — one extra read on a path that's
  already async (a background job), so the added latency doesn't touch any user-facing request; would need
  caching if it moved onto a hot synchronous path.
- **−** The realtime gateway's in-memory `socketsByUser` map is per-process; a replica restart drops its
  local connections (clients reconnect) — acceptable for "nice-to-have live push," not appropriate as the
  only delivery mechanism, which is exactly why the in-app row remains the durable source of truth regardless
  of realtime's state.
- **−** Letting a user disable the in-app channel means they can end up with no record of a notification at
  all (not just no live push) — worth reconsidering (e.g. force in-app always-on, gate only the "extra"
  channels) if this becomes a real support complaint.
- **Revisit when:** a channel needs delivery guarantees the current best-effort model doesn't provide (e.g.
  email must never silently fail) — at that point the email adapter likely needs its own queue + retry/DLQ,
  the same pattern ADR-0007 already established for jobs.
