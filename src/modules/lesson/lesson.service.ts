import { AppError } from '../../lib/AppError';
import { cacheAside, invalidate } from '../../lib/cache';
import { cacheKeys } from '../../lib/cacheKeys';
import { getLessonById } from './lesson.repository';

const DETAIL_TTL = 300; // seconds

/**
 * A lesson is only visible if its course is published. Cached by id; a missing
 * or hidden lesson returns the same 404 (not cached).
 */
export function getLesson(id: string) {
  return cacheAside(cacheKeys.lesson(id), DETAIL_TTL, async () => {
    const lesson = await getLessonById(id);
    if (!lesson || !lesson.module.course.published) {
      throw AppError.notFound(`Lesson not found: ${id}`);
    }
    return lesson;
  });
}

export async function invalidateLesson(id: string): Promise<void> {
  await invalidate(cacheKeys.lesson(id));
}
