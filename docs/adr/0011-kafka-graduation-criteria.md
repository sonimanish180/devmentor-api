# ADR-0011: Adopting Kafka alongside BullMQ (graduation criteria met)

- Status: Accepted
- Date: 2026-08-10
- Phase: 10 — Messaging at Scale (Kafka)
- Deciders: DevMentor team

## Problem

ADR-0007 (Phase 6) deferred Kafka, listing explicit graduation criteria: high-throughput event streaming
beyond task queues, multiple independent consumers of the same stream, replay/audit of an event log, and
durable ordering/partitioning at a scale Redis queues strain under. By Phase 9 we have two consumers that
want the SAME domain events for entirely different reasons — an analytics pipeline that wants to see every
event ever, and a future search indexer (Phase 11) that wants the same stream, independently — plus a clear
want for eventual replay (rebuild a read model from history) that a BullMQ queue, which deletes jobs once
processed, cannot provide. That's the graduation criteria being met, not a preference for a newer
technology.

## Options considered

1. **Add Kafka as a second outbox destination, alongside BullMQ** — the existing task-oriented reactions
   (award XP, send a notification, update a contest leaderboard) stay on BullMQ, which is the right tool for
   them; Kafka is added specifically for the multi-consumer, replay-oriented use cases. (chosen)
2. **Migrate everything from BullMQ to Kafka** — Kafka can technically do task-queue-style work too, but it's
   a worse fit for it (no built-in delayed jobs, retries/backoff, or a dead-letter concept as clean as
   BullMQ's) — replacing a good fit with Kafka "because we're adopting it anyway" would be adoption for its
   own sake, the anti-pattern ADR-0007 was written to avoid.
3. **Add more BullMQ queues, one per new consumer, instead of Kafka** — technically possible (fan out to N
   queues at enqueue time), but each new independent consumer means a producer-side change; a Kafka topic
   with N consumer groups instead lets a new consumer subscribe without the producer knowing it exists —
   exactly the fan-out property we needed and BullMQ's design doesn't provide.

## Decision

Run Kafka **alongside** BullMQ, each doing what it's actually good at. The `OutboxEvent` table gains a
second, independent dispatch cursor (`kafkaDispatchedAt`) and a second relay (`startKafkaRelay`, Task 10.2)
that publishes to one topic, `domain-events`, partitioned by `userId` for per-user ordering. Two consumer
groups (`analytics-consumer`, `search-index-consumer`, Task 10.3) each read the ENTIRE topic independently —
neither competes with the other, or with the BullMQ `events` queue's subscribers, for messages. A versioned
message envelope (`{ eventId, type, version, payload }`, Task 10.4) is validated with zod at the consumer
boundary, because a Kafka topic is shared, longer-lived infrastructure that outlives any one PR — unlike a
BullMQ queue, which has exactly one producer and one set of subscribers, all living in this codebase.
Consumers are idempotent by `eventId`, and this time it's load-bearing, not optional: KafkaJS's
`idempotent: true` producer setting only dedupes retries within one producer session, not a relay process
restarting and re-publishing an event it already sent.

## Consequences

- **+** Each transport does what it's actually best at: BullMQ for retries/backoff/DLQ on discrete jobs,
  Kafka for durable, replayable, multi-consumer-group streaming — matching ADR-0007's explicit criteria
  rather than a wholesale migration.
- **+** Adding a third independent consumer of domain events (a future audit log, a recommendation model
  trainer) is "subscribe a new consumer group to the existing topic" — no producer-side change at all.
- **+** The dual-cursor outbox (`dispatchedAt` / `kafkaDispatchedAt`) generalizes cleanly: a future fourth
  sink is another column and another relay, not a rewrite of the first two.
- **−** Running Kafka locally is real operational weight compared to BullMQ-on-Redis — a JVM-adjacent
  broker process, its own compose service, its own healthcheck, its own client library. This cost is
  precisely why ADR-0007 deferred it until the criteria were actually met.
- **−** Kafka's producer-side idempotence does not cover a relay restart, so unlike the BullMQ relay's
  `jobId` dedupe (mostly sufficient on its own), the Kafka consumers' `eventId` guards are load-bearing, not
  a defense-in-depth extra — a subtlety worth calling out explicitly so nobody assumes `idempotent: true`
  means "exactly once."
- **−** A single dev-mode broker (KRaft, one node) has none of a real cluster's replication guarantees —
  fine for local development and this course, not representative of a production Kafka deployment.
- **Revisit when:** a consumer needs strict ordering across ALL events of one entity type regardless of
  which user triggered them (our per-`userId` partition key doesn't guarantee that) — that would need either
  a different partition key (trading away per-user ordering) or a dedicated topic per entity type.
