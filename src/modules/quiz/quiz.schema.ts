import { z } from 'zod';

export const quizIdParams = z.object({ id: z.string().min(1) });
export type QuizIdParams = z.infer<typeof quizIdParams>;

export const attemptIdParams = z.object({ attemptId: z.string().min(1) });
export type AttemptIdParams = z.infer<typeof attemptIdParams>;

export const submitAttemptBody = z.object({
  answers: z.array(
    z.object({
      questionId: z.string().min(1),
      selectedIndex: z.coerce.number().int().min(0),
    }),
  ),
});
export type SubmitAttemptBody = z.infer<typeof submitAttemptBody>;

export const leaderboardQuery = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
});
export type LeaderboardQuery = z.infer<typeof leaderboardQuery>;
