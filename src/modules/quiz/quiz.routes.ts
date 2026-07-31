import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { idempotency } from '../../middleware/idempotency';
import { validate } from '../../middleware/validate';
import { quizIdParams, attemptIdParams, submitAttemptBody, leaderboardQuery } from './quiz.schema';
import * as quizController from './quiz.controller';
import { registerQuizOpenApi } from './quiz.openapi';

export const quizRouter = Router();

quizRouter.post('/:id/start', requireAuth, validate({ params: quizIdParams }), quizController.startAttempt);
quizRouter.get('/:id/leaderboard', validate({ params: quizIdParams, query: leaderboardQuery }), quizController.getLeaderboard);
quizRouter.get('/attempts/:attemptId', requireAuth, validate({ params: attemptIdParams }), quizController.getAttempt);
quizRouter.post(
  '/attempts/:attemptId/submit',
  requireAuth,
  idempotency,
  validate({ params: attemptIdParams, body: submitAttemptBody }),
  quizController.submitAttempt,
);

registerQuizOpenApi();
