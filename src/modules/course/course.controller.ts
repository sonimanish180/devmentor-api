import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import * as courseService from './course.service';

/**
 * Thin HTTP adapters: read the (already validated + coerced) request, call the
 * service, send the result. No business logic, no DB calls here.
 */

export const listCourses = asyncHandler(async (req: Request, res: Response) => {
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
  const limit = typeof req.query.limit === 'number' ? req.query.limit : undefined;
  res.json(await courseService.listCourses({ cursor, limit }));
});

export const getCourse = asyncHandler(async (req: Request, res: Response) => {
  res.json(await courseService.getCourse(req.params.slug as string));
});
