import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { idempotency } from '../../middleware/idempotency';
import { validate } from '../../middleware/validate';
import { completeParams } from './progress.schema';
import * as progressController from './progress.controller';
import { registerProgressOpenApi } from './progress.openapi';

export const progressRouter = Router();

progressRouter.get('/', requireAuth, progressController.getProgress);
progressRouter.post(
  '/lessons/:id/complete',
  requireAuth,
  idempotency,
  validate({ params: completeParams }),
  progressController.completeLesson,
);

registerProgressOpenApi();
