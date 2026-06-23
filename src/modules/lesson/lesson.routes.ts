import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { methodNotAllowed } from '../../middleware/methodNotAllowed';
import { lessonIdParams } from './lesson.schema';
import * as lessonController from './lesson.controller';
import { registerLessonOpenApi } from './lesson.openapi';

export const lessonRouter = Router();

lessonRouter.get('/:id', validate({ params: lessonIdParams }), lessonController.getLesson);
lessonRouter.all('/:id', methodNotAllowed(['GET']));

registerLessonOpenApi();
