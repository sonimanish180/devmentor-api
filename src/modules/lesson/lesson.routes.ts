import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { lessonIdParams } from './lesson.schema';
import * as lessonController from './lesson.controller';
import { registerLessonOpenApi } from './lesson.openapi';

export const lessonRouter = Router();

lessonRouter.get('/:id', validate({ params: lessonIdParams }), lessonController.getLesson);

registerLessonOpenApi();
