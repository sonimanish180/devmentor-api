import { AppError } from '../../lib/AppError';
import { withLock } from '../../lib/lock';
import { occUpdate } from '../../lib/occ';
import { scoreAnswers, toPublicQuestion, type QuizQuestion, type SubmittedAnswer } from '../../lib/scoring';
import * as repo from './quiz.repository';

const START_LOCK_TTL_MS = 5_000;

interface StartableQuiz {
  durationSeconds: number;
  questions: unknown;
  contestMode: boolean;
}
interface Attempt {
  id: string;
  startedAt: Date;
  deadlineAt: Date;
}

function toStartResponse(attempt: Attempt, quiz: StartableQuiz) {
  const questions = (quiz.questions as QuizQuestion[]).map(toPublicQuestion);
  return {
    attemptId: attempt.id,
    startedAt: attempt.startedAt,
    deadlineAt: attempt.deadlineAt, // the client counts down against THIS — never its own clock
    durationSeconds: quiz.durationSeconds,
    questions,
  };
}

/**
 * Start (or resume) a timed attempt. Wrapped in `withLock` (Task 5.4's
 * distributed lock, reused here) because "check for an existing active
 * attempt, then create one" is a read-then-write race: two simultaneous
 * start requests could both see no active attempt and both create one
 * without the lock serializing them per (user, quiz).
 */
export async function startAttempt(userId: string, quizId: string) {
  return withLock(`quiz:start:${userId}:${quizId}`, START_LOCK_TTL_MS, async () => {
    const quiz = await repo.findQuizById(quizId);
    if (!quiz || !quiz.published) throw AppError.notFound(`Quiz not found: ${quizId}`);

    const existing = await repo.findActiveAttempt(userId, quizId);
    if (existing) {
      if (existing.deadlineAt.getTime() > Date.now()) {
        return toStartResponse(existing, quiz); // still within time — resume the same attempt
      }
      await repo.expireAttempt(existing.id); // stale; the sweeper (Task 9.4) would also catch this eventually
    }

    const startedAt = new Date();
    // The SERVER computes the deadline. A client-supplied duration/deadline
    // would let anyone extend their own time limit — never trust it.
    const deadlineAt = new Date(startedAt.getTime() + quiz.durationSeconds * 1000);
    const attempt = await repo.createAttempt({ userId, quizId, startedAt, deadlineAt });
    return toStartResponse(attempt, quiz);
  });
}

/**
 * Submit answers. Enforces the deadline against the SERVER's clock (not
 * anything the client claims), transitions the attempt exactly once under
 * concurrency via OCC, and treats a losing duplicate submit as an idempotent
 * replay of the winner's result rather than a hard error.
 */
export async function submitAttempt(userId: string, attemptId: string, answers: SubmittedAnswer[]) {
  const attempt = await repo.findAttemptById(attemptId);
  if (!attempt || attempt.userId !== userId) throw AppError.notFound(`Attempt not found: ${attemptId}`);

  if (attempt.status !== 'IN_PROGRESS') {
    return { attemptId: attempt.id, score: attempt.score ?? 0, alreadySubmitted: true };
  }

  if (attempt.deadlineAt.getTime() < Date.now()) {
    // Too late by the server's own clock — reject even though the sweeper
    // (Task 9.4) may not have flipped this row's status yet.
    await repo.expireAttempt(attempt.id);
    throw AppError.conflict('The deadline for this attempt has passed');
  }

  const score = scoreAnswers(attempt.quiz.questions as QuizQuestion[], answers);

  try {
    await occUpdate(() =>
      repo.submitAttemptTx(attempt, score, answers, {
        userId,
        quizId: attempt.quizId,
        attemptId: attempt.id,
        score,
        contestMode: attempt.quiz.contestMode,
      }),
    );
  } catch (e) {
    if (e instanceof AppError && e.code === 'CONFLICT') {
      // A concurrent duplicate submit already won the version race — replay
      // its result instead of surfacing an error for what the client sees
      // as "I submitted this already."
      const fresh = await repo.findAttemptById(attempt.id);
      return { attemptId: attempt.id, score: fresh?.score ?? 0, alreadySubmitted: true };
    }
    throw e;
  }

  return { attemptId: attempt.id, score, alreadySubmitted: false };
}

export async function getAttempt(userId: string, attemptId: string) {
  const attempt = await repo.findAttemptById(attemptId);
  if (!attempt || attempt.userId !== userId) throw AppError.notFound(`Attempt not found: ${attemptId}`);
  return {
    attemptId: attempt.id,
    status: attempt.status,
    startedAt: attempt.startedAt,
    deadlineAt: attempt.deadlineAt,
    score: attempt.score,
  };
}
