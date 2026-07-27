import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/AppError';

/** Prisma throws P2002 on a unique-constraint violation. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

/**
 * Mark a lesson complete and award its XP — exactly once, even under concurrent
 * duplicate requests.
 *
 * The award runs in a TRANSACTION (completion row + XP increment commit together
 * or not at all), and XP is an ATOMIC increment (no read-modify-write race). The
 * real exactly-once guard is the composite PK on LessonCompletion: if two
 * requests race, the second `create` violates the unique constraint, its
 * transaction rolls back, and we treat it as "already completed" — so XP is
 * never awarded twice.
 */
export async function completeLesson(userId: string, lessonId: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const lesson = await tx.lesson.findUnique({ where: { id: lessonId }, select: { xp: true } });
      if (!lesson) throw AppError.notFound(`Lesson not found: ${lessonId}`);

      await tx.lessonCompletion.create({ data: { userId, lessonId } }); // throws P2002 if already done
      await tx.userStats.update({
        where: { userId },
        data: { totalXP: { increment: lesson.xp } }, // atomic increment
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
