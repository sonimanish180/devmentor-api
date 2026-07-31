import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import * as quizService from './quiz.service';
import * as leaderboard from '../../quiz/leaderboard';

export const startAttempt = asyncHandler(async (req: Request, res: Response) => {
  const result = await quizService.startAttempt(req.auth!.userId, req.params.id as string);
  res.status(201).json(result);
});

export const getAttempt = asyncHandler(async (req: Request, res: Response) => {
  res.json(await quizService.getAttempt(req.auth!.userId, req.params.attemptId as string));
});

export const submitAttempt = asyncHandler(async (req: Request, res: Response) => {
  const result = await quizService.submitAttempt(req.auth!.userId, req.params.attemptId as string, req.body.answers);
  // 201 when this call actually scored it; 200 when replaying an earlier submit (idempotent).
  res.status(result.alreadySubmitted ? 200 : 201).json(result);
});

export const getLeaderboard = asyncHandler(async (req: Request, res: Response) => {
  const { limit } = req.query as { limit?: number };
  res.json(await leaderboard.getLeaderboard(req.params.id as string, limit));
});
