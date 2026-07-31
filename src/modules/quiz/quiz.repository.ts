import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { writeOutboxEvent } from '../../events/outbox';
import type { QuizSubmittedPayload } from '../../events/contracts';
import type { SubmittedAnswer } from '../../lib/scoring';

export function findQuizById(quizId: string) {
  return prisma.quiz.findUnique({ where: { id: quizId } });
}

/** A user has at most one attempt "in flight" per quiz — this is what `startAttempt` checks. */
export function findActiveAttempt(userId: string, quizId: string) {
  return prisma.quizAttempt.findFirst({ where: { userId, quizId, status: 'IN_PROGRESS' } });
}

export function createAttempt(data: { userId: string; quizId: string; startedAt: Date; deadlineAt: Date }) {
  return prisma.quizAttempt.create({ data });
}

export function findAttemptById(attemptId: string) {
  return prisma.quizAttempt.findUnique({ where: { id: attemptId }, include: { quiz: true } });
}

/** Best-effort immediate flip to EXPIRED (the sweeper, Task 9.4, would also eventually catch this). */
export function expireAttempt(attemptId: string) {
  return prisma.quizAttempt.updateMany({
    where: { id: attemptId, status: 'IN_PROGRESS' },
    data: { status: 'EXPIRED', submittedAt: new Date(), score: 0 },
  });
}

/**
 * The versioned transition IN_PROGRESS -> SUBMITTED, plus (only if this call
 * actually won the race) the `QuizSubmitted` outbox event, in the SAME
 * transaction — the same transactional-outbox shape as `completeLesson`
 * (Phase 7), reused here for a new event type.
 */
export function submitAttemptTx(
  attempt: { id: string; version: number },
  score: number,
  answers: SubmittedAnswer[],
  outboxPayload: QuizSubmittedPayload,
): Promise<{ count: number }> {
  return prisma.$transaction(async (tx) => {
    const result = await tx.quizAttempt.updateMany({
      where: { id: attempt.id, version: attempt.version, status: 'IN_PROGRESS' },
      data: {
        status: 'SUBMITTED',
        score,
        submittedAt: new Date(),
        answers: answers as unknown as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    });
    if (result.count === 1) {
      await writeOutboxEvent(tx, { type: 'QuizSubmitted', payload: outboxPayload });
    }
    return result;
  });
}
