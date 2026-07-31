import { startConsumer, type KafkaConsumerHandle } from '../consumer';
import { parseEnvelope } from '../envelope';
import { DOMAIN_EVENTS_TOPIC } from '../topics';
import { redis } from '../../lib/redis';
import { prisma } from '../../lib/prisma';
import { withEventGuard } from '../../lib/eventGuard';
import { logger } from '../../lib/logger';
import type { LessonCompletedPayload } from '../../events/contracts';

const GROUP_ID = 'search-index-consumer';
const GUARD_TTL_SECONDS = 30 * 24 * 3600;

/**
 * Gives the Phase 10 scaffold real behavior (Task 11.3): on `LessonCompleted`,
 * increment that lesson's `SearchIndexEntry.completionCount` — the
 * EVENT-DRIVEN half of the search read model, distinct from `reindexSearch`'s
 * bulk-rebuilt descriptive content. Its own consumer group means it reads
 * the exact same `domain-events` stream as the analytics consumer without
 * competing with it for messages.
 */
async function bumpCompletionCount(lessonId: string): Promise<void> {
  const updated = await prisma.searchIndexEntry.updateMany({
    where: { lessonId },
    data: { completionCount: { increment: 1 } },
  });

  if (updated.count > 0) return;

  // No row yet — a reindex hasn't run since this lesson was added, or it's
  // brand new. Create it with a starting count of 1 rather than silently
  // dropping the signal; `upsert`'s `update` branch covers the rare race
  // where something else creates the row between the updateMany above and here.
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: { module: { include: { course: true } } },
  });
  if (!lesson) return; // lesson was deleted since the event fired — nothing to index

  await prisma.searchIndexEntry.upsert({
    where: { lessonId: lesson.id },
    create: {
      lessonId: lesson.id,
      courseSlug: lesson.module.course.slug,
      courseTitle: lesson.module.course.title,
      lessonSlug: lesson.slug,
      lessonTitle: lesson.title,
      description: lesson.description,
      level: lesson.level,
      completionCount: 1,
    },
    update: { completionCount: { increment: 1 } },
  });
}

export function startSearchIndexConsumer(): Promise<KafkaConsumerHandle> {
  return startConsumer(GROUP_ID, [DOMAIN_EVENTS_TOPIC], async ({ message }) => {
    const envelope = parseEnvelope(message.value);
    if (!envelope) {
      logger.warn('search-index consumer: dropped a malformed or unrecognized message');
      return;
    }

    if (envelope.type !== 'LessonCompleted') {
      logger.debug({ type: envelope.type }, 'search-index consumer: no reaction for this event type yet');
      return;
    }

    const payload = envelope.payload as LessonCompletedPayload;
    const result = await withEventGuard(redis, `kafka:${GROUP_ID}:${envelope.eventId}`, GUARD_TTL_SECONDS, () =>
      bumpCompletionCount(payload.lessonId),
    );

    if (result === 'skipped-duplicate') {
      logger.info({ eventId: envelope.eventId }, 'search-index: already processed this event — skipping duplicate');
    }
  });
}
