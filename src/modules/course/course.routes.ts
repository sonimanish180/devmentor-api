import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { methodNotAllowed } from '../../middleware/methodNotAllowed';
import { paginationQuery } from '../../api/schemas';
import { courseSlugParams } from './course.schema';
import * as courseController from './course.controller';
import { registerCourseOpenApi } from './course.openapi';

export const courseRouter = Router();

courseRouter.get('/', validate({ query: paginationQuery }), courseController.listCourses);
courseRouter.get('/:slug', validate({ params: courseSlugParams }), courseController.getCourse);

// 405 for unsupported methods on these known paths.
courseRouter.all('/', methodNotAllowed(['GET']));
courseRouter.all('/:slug', methodNotAllowed(['GET']));

registerCourseOpenApi();
