import { z } from 'zod';

/**
 * Schema discipline (Task 10.4): a BullMQ queue has exactly one owner (this
 * codebase) on both ends, so `DomainEvent` (src/events/contracts.ts) is
 * enough of a contract. A Kafka topic is shared, longer-lived infrastructure
 * — over time, producers and consumers you don't control end up reading and
 * writing it. An explicit, VERSIONED envelope is what lets a consumer safely
 * ignore a message shape it doesn't understand yet (or has been deprecated)
 * instead of crashing on it.
 */
export const domainEventEnvelope = z.object({
  eventId: z.string().min(1),
  type: z.string().min(1),
  version: z.literal(1),
  payload: z.unknown(),
});
export type DomainEventEnvelope = z.infer<typeof domainEventEnvelope>;

/** Parse defensively: a malformed or future/unknown-version message is skipped, never a thrown crash. */
export function parseEnvelope(raw: Buffer | string | null | undefined): DomainEventEnvelope | null {
  if (raw == null) return null;
  try {
    return domainEventEnvelope.parse(JSON.parse(raw.toString()));
  } catch {
    return null;
  }
}
