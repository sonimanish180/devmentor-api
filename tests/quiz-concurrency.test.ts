import { describe, it, expect } from 'vitest';
import { scoreAnswers, toPublicQuestion, type QuizQuestion } from '../src/lib/scoring';

/**
 * Pure unit tests for scoring — no I/O, run anywhere. The DB/Redis-backed
 * concurrency and timing tests below are gated behind RUN_DB_TESTS, same as
 * `tests/concurrency.test.ts` (Task 5.5), so `pnpm test` stays fast locally
 * and the full suite runs in CI (Phase 13) where Postgres + Redis exist.
 */
describe('scoreAnswers', () => {
  const questions: QuizQuestion[] = [
    { id: 'q1', prompt: '2+2?', options: ['3', '4'], correctIndex: 1, points: 1 },
    { id: 'q2', prompt: 'Capital of France?', options: ['Paris', 'Lyon'], correctIndex: 0, points: 2 },
  ];

  it('sums points for correct answers only', () => {
    const score = scoreAnswers(questions, [
      { questionId: 'q1', selectedIndex: 1 }, // correct, 1pt
      { questionId: 'q2', selectedIndex: 1 }, // wrong, 0pt
    ]);
    expect(score).toBe(1);
  });

  it('scores 0 for a question the client never answered', () => {
    const score = scoreAnswers(questions, [{ questionId: 'q1', selectedIndex: 1 }]);
    expect(score).toBe(1); // only q1 answered (correctly); q2 defaults to 0, not an error
  });

  it('ignores an answer referencing a question id not in this quiz', () => {
    const score = scoreAnswers(questions, [{ questionId: 'does-not-exist', selectedIndex: 0 }]);
    expect(score).toBe(0);
  });

  it('defaults points to 1 when a question omits it', () => {
    const q: QuizQuestion = { id: 'q3', prompt: '?', options: ['a', 'b'], correctIndex: 0 };
    expect(scoreAnswers([q], [{ questionId: 'q3', selectedIndex: 0 }])).toBe(1);
  });
});

describe('toPublicQuestion', () => {
  it('strips correctIndex before a question reaches the client', () => {
    const q: QuizQuestion = { id: 'q1', prompt: '2+2?', options: ['3', '4'], correctIndex: 1 };
    const pub = toPublicQuestion(q);
    expect(pub).not.toHaveProperty('correctIndex');
    expect(pub).toMatchObject({ id: 'q1', prompt: '2+2?', options: ['3', '4'] });
  });
});

/**
 * Integration: exercise the actual concurrency/timing guarantees against a
 * live Postgres + Redis.
 *
 *   pnpm test:integration        # == RUN_DB_TESTS=1 vitest run
 *
 * As of Task 13.1, `global-setup.ts` provisions a short-duration
 * (`durationSeconds: 2`), published, contestMode=false quiz against the
 * disposable Postgres container itself and writes its id to TEST_QUIZ_ID —
 * this file no longer expects a developer to have hand-seeded one.
 */
describe.skipIf(!process.env.RUN_DB_TESTS)('quiz attempts under concurrency', () => {
  it('firing N parallel start requests for the same user+quiz yields exactly one attempt row', async () => {
    const { startAttempt } = await import('../src/modules/quiz/quiz.service');
    const { prisma } = await import('../src/lib/prisma');
    const userId = process.env.TEST_USER_ID!;
    const quizId = process.env.TEST_QUIZ_ID!;

    const results = await Promise.allSettled(Array.from({ length: 10 }, () => startAttempt(userId, quizId)));
    const attemptIds = new Set(
      results.filter((r): r is PromiseFulfilledResult<{ attemptId: string }> => r.status === 'fulfilled').map((r) => r.value.attemptId),
    );
    // Every successful call should report the SAME attempt id (the lock serializes
    // create-vs-resume); any that lost the lock race surface as a 409, not a second row.
    expect(attemptIds.size).toBe(1);

    const rows = await prisma.quizAttempt.count({ where: { userId, quizId, status: 'IN_PROGRESS' } });
    expect(rows).toBe(1);
  });

  it('firing N parallel submits for the same attempt scores it exactly once', async () => {
    const { startAttempt, submitAttempt } = await import('../src/modules/quiz/quiz.service');
    const userId = process.env.TEST_USER_ID!;
    const quizId = process.env.TEST_QUIZ_ID!;

    const { attemptId, questions } = await startAttempt(userId, quizId);
    const answers = questions.map((q) => ({ questionId: q.id, selectedIndex: 0 }));

    const results = await Promise.all(Array.from({ length: 10 }, () => submitAttempt(userId, attemptId, answers)));
    const winners = results.filter((r) => !r.alreadySubmitted);
    // Exactly one request should report having actually scored it; the rest
    // replay the same result via the OCC-conflict -> refetch path.
    expect(winners).toHaveLength(1);
    expect(new Set(results.map((r) => r.score)).size).toBe(1); // every response agrees on the final score
  });

  it('rejects a submit after the server-set deadline has passed, regardless of client-side timing', async () => {
    const { startAttempt, submitAttempt } = await import('../src/modules/quiz/quiz.service');
    const userId = process.env.TEST_USER_ID!;
    const quizId = process.env.TEST_QUIZ_ID!; // seed this quiz with a short durationSeconds (e.g. 1)

    const { attemptId, durationSeconds, questions } = await startAttempt(userId, quizId);
    await new Promise((resolve) => setTimeout(resolve, (durationSeconds + 1) * 1000)); // let the deadline pass

    const answers = questions.map((q) => ({ questionId: q.id, selectedIndex: 0 }));
    await expect(submitAttempt(userId, attemptId, answers)).rejects.toMatchObject({ statusCode: 409 });
  });
});
