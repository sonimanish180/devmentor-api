import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import * as searchService from './search.service';

export const search = asyncHandler(async (req: Request, res: Response) => {
  const { q, page, limit } = req.query as unknown as { q: string; page?: number; limit?: number };
  res.json(await searchService.search({ q, page, limit }));
});
