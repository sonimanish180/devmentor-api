import type { Prisma } from '@prisma/client';
import type { DomainEvent } from './contracts';

/**
 * Write a domain event to the outbox — MUST be called with the same `tx`
 * (transaction client) used for the business change it describes. That's
 * the entire trick: Postgres either commits both rows (the change + the
 * event) or neither. There is no window where the change is visible but the
 * event was never recorded, and no window where an event fires for a change
 * that got rolled back.
 */
export async function writeOutboxEvent(tx: Prisma.TransactionClient, event: DomainEvent): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      type: event.type,
      payload: event.payload as Prisma.InputJsonValue,
    },
  });
}
