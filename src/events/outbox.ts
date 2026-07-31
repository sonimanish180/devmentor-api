import type { Prisma } from '@prisma/client';
import type { DomainEvent } from './contracts';
import { captureTraceCarrier } from '../observability/context';

/**
 * Write a domain event to the outbox — MUST be called with the same `tx`
 * (transaction client) used for the business change it describes. That's
 * the entire trick: Postgres either commits both rows (the change + the
 * event) or neither. There is no window where the change is visible but the
 * event was never recorded, and no window where an event fires for a change
 * that got rolled back.
 *
 * As of Task 12.1, this also captures the CURRENT trace context (whatever
 * request/span is active when the transaction runs) and stores it alongside
 * the event. Relays forward it untouched; a subscriber can later use it to
 * process the event inside a span linked to the original request's trace,
 * instead of an orphaned one with no visible cause.
 */
export async function writeOutboxEvent(tx: Prisma.TransactionClient, event: DomainEvent): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      type: event.type,
      payload: event.payload as Prisma.InputJsonValue,
      traceCarrier: captureTraceCarrier() as Prisma.InputJsonValue,
    },
  });
}
