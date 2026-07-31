import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../../lib/prisma';

/**
 * Bulk-builds the `SearchIndexEntry` read model from the current catalog —
 * the "baseline content" half of Task 11.3's CQRS-lite split. There's no
 * course/lesson-authoring event stream yet (content is seeded, not edited
 * through an API), so a rebuild like this is the honest way to populate the
 * read model's descriptive fields; safe to re-run any time content changes
 * out-of-band (a reseed, a manual DB edit).
 *
 * Deliberately does NOT touch `completionCount` on an existing row — that
 * field is owned by the event-driven path (the Kafka search-index-consumer
 * reacting to `LessonCompleted`), not this bulk path. Rebuilding descriptive
 * content should never wipe an accumulated popularity signal.
 *
 * Accepts an optional client so `prisma/seed.ts` (which creates its own
 * `PrismaClient`) can pass that one in, instead of this call opening a
 * second connection pool alongside the app's shared singleton.
 */
export async function reindexSearch(client: PrismaClient | typeof defaultPrisma = defaultPrisma): Promise<number> {
  const prisma = client;
  const lessons = await prisma.lesson.findMany({
    where: { module: { course: { published: true } } },
    include: { module: { include: { course: true } } },
  });

  let count = 0;
  for (const lesson of lessons) {
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
      },
      update: {
        courseSlug: lesson.module.course.slug,
        courseTitle: lesson.module.course.title,
        lessonSlug: lesson.slug,
        lessonTitle: lesson.title,
        description: lesson.description,
        level: lesson.level,
        // completionCount intentionally omitted — see doc comment above.
      },
    });
    count++;
  }
  return count;
}
