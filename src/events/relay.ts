import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { eventsQueue } from '../queues/events.queue';

const BATCH_SIZE = 20;
const POLL_INTERVAL_MS = 1000;

interface OutboxRow {
  id: string;
  type: string;
  payload: unknown;
}

/**
 * One relay tick: claim a batch of undispatched rows, publish each to the
 * "events" queue, then mark them dispatched — all guarded by one DB
 * transaction using `FOR UPDATE SKIP LOCKED`.
 *
 * `SKIP LOCKED` is what makes this safe to run as MULTIPLE relay replicas: if
 * two relay instances tick at the same moment, each locks a disjoint set of
 * rows instead of blocking on (or double-claiming) the other's batch — no
 * distributed lock needed just to poll a table.
 *
 * Publish happens BEFORE the rows are marked dispatched and BEFORE the
 * transaction commits. That ordering is deliberate: if the process dies
 * between `eventsQueue.add` and the commit, the transaction rolls back, the
 * rows stay undispatched, and the next tick re-publishes them — but
 * `jobId: event:<id>` makes that re-publish a no-op (BullMQ already has that
 * job). This is the same choice we made in Phase 6: prefer at-least-once
 * delivery over risking an event that's marked "sent" but never was.
 */
async function relayBatch(): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<OutboxRow[]>`
      SELECT id, type, payload
      FROM "OutboxEvent"
      WHERE "dispatchedAt" IS NULL
      ORDER BY "createdAt" ASC
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    `;
    if (rows.length === 0) return 0;

    for (const row of rows) {
      await eventsQueue.add(
        row.type,
        { eventId: row.id, type: row.type, payload: row.payload },
        { jobId: `event:${row.id}` },
      );
    }

    await tx.outboxEvent.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { dispatchedAt: new Date() },
    });

    return rows.length;
  });
}

export interface OutboxRelay {
  stop: () => Promise<void>;
}

/** Starts the poll loop. Call `.stop()` during graceful shutdown to let an in-flight tick finish. */
export function startOutboxRelay(): OutboxRelay {
  let stopped = false;
  let inFlight: Promise<void> | undefined;
  let timer: NodeJS.Timeout | undefined;

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      const count = await relayBatch();
      if (count > 0) logger.info({ count }, 'outbox: relayed events to queue');
    } catch (err) {
      logger.error({ err }, 'outbox relay: tick failed — will retry next interval');
    }
    if (!stopped) timer = setTimeout(() => void (inFlight = tick()), POLL_INTERVAL_MS);
  }

  void (inFlight = tick());

  return {
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      await inFlight;
    },
  };
}
