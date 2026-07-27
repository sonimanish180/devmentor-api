import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import * as progressService from './progress.service';

export const getProgress = asyncHandler(async (req: Request, res: Response) => {
  res.json(await progressService.getProgress(req.auth!.userId));
});

export const completeLesson = asyncHandler(async (req: Request, res: Response) => {
  const result = await progressService.completeLesson(req.auth!.userId, req.params.id as string);
  // 201 when newly completed, 200 when it was already done (idempotent).
  res.status(result.alreadyCompleted ? 200 : 201).json(result);
});
