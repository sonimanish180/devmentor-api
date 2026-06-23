import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { paginationQuery } from '../../api/schemas';
import { courseSlugParams } from './course.schema';
import * as courseController from './course.controller';
import { registerCourseOpenApi } from './course.openapi';

export const courseRouter = Router();

courseRouter.get('/', validate({ query: paginationQuery }), courseController.listCourses);
courseRouter.get('/:slug', validate({ params: courseSlugParams }), courseController.getCourse);

registerCourseOpenApi();
