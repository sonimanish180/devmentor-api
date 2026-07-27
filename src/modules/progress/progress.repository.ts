import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/AppError';
import { writeOutboxEvent } from '../../events/outbox';

/** Prisma throws P2002 on a unique-constraint violation. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

/**
 * Mark a lesson complete — exactly once, even under concurrent duplicate
 * requests — and RECORD (not directly award) the XP via a domain event.
 *
 * Through Phase 5 this transaction also incremented `UserStats.totalXP`
 * inline. As of Phase 7 it instead writes a `LessonCompleted` OutboxEvent row
 * in the SAME transaction as the completion. Why the split: XP-awarding is
 * about to have more than one interested party (an Task 7.4 subscriber today;
 * notifications/streak logic soon) and none of that fan-out belongs on the
 * request's critical path or coupled into this module. The completion write
 * and the "announce it happened" write still commit atomically together
 * (no dual-write risk) — only the XP increment itself moves to an async,
 * idempotent subscriber (`src/queues/events.worker.ts`). The composite PK on
 * LessonCompletion is still what makes *this* request exactly-once: a racing
 * duplicate hits P2002, its transaction rolls back, and no event is ever
 * written for it.
 *
 * Trade-off: `totalXP` is now EVENTUALLY consistent with completions — it
 * catches up once the relay (Task 7.3) and subscriber (Task 7.4) run, which
 * is normally milliseconds, not zero. `getProgress` below still reads
 * `completedLessons` (always current) and `totalXP` (eventually current).
 */
export async function completeLesson(userId: string, lessonId: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const lesson = await tx.lesson.findUnique({ where: { id: lessonId }, select: { xp: true } });
      if (!lesson) throw AppError.notFound(`Lesson not found: ${lessonId}`);

      await tx.lessonCompletion.create({ data: { userId, lessonId } }); // throws P2002 if already done
      await writeOutboxEvent(tx, {
        type: 'LessonCompleted',
        payload: { userId, lessonId, xp: lesson.xp },
      });

      return { alreadyCompleted: false, xpAwarded: lesson.xp };
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { alreadyCompleted: true, xpAwarded: 0 };
    throw e;
  }
}

export async function getProgress(userId: string) {
  const [stats, completions] = await Promise.all([
    prisma.userStats.findUnique({ where: { userId } }),
    prisma.lessonCompletion.findMany({
      where: { userId },
      select: { lessonId: true, completedAt: true },
      orderBy: { completedAt: 'desc' },
    }),
  ]);
  return {
    totalXP: stats?.totalXP ?? 0,
    streak: stats?.streak ?? 0,
    completedCount: completions.length,
    completedLessons: completions,
  };
}
