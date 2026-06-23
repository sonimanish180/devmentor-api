import { AppError } from '../../lib/AppError';
import type { PageParams } from '../../lib/pagination';
import { getCourseBySlug, listPublishedCourses } from './course.repository';

/**
 * Course business logic. The service sits between HTTP (controller) and data
 * (repository): it enforces rules like "only published courses are visible" and
 * translates "not found" into a domain error, so controllers stay thin.
 */

export function listCourses(params: PageParams) {
  return listPublishedCourses(params);
}

export async function getCourse(slug: string) {
  const course = await getCourseBySlug(slug);
  // Hide unpublished/absent courses behind the same 404 (don't leak existence).
  if (!course || !course.published) {
    throw AppError.notFound(`Course not found: ${slug}`);
  }
  return course;
}
