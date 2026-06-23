import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import * as lessonService from './lesson.service';

export const getLesson = asyncHandler(async (req: Request, res: Response) => {
  res.json(await lessonService.getLesson(req.params.id as string));
});
