import { AppError } from '../../lib/AppError';
import { getLessonById } from './lesson.repository';

/**
 * A lesson is only visible if its course is published. A missing lesson and a
 * lesson under an unpublished course both return the same 404 (don't leak
 * existence).
 */
export async function getLesson(id: string) {
  const lesson = await getLessonById(id);
  if (!lesson || !lesson.module.course.published) {
    throw AppError.notFound(`Lesson not found: ${id}`);
  }
  return lesson;
}
