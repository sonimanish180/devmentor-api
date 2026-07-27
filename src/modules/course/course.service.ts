import { AppError } from '../../lib/AppError';
import { cacheAside, invalidate, invalidateByPrefix } from '../../lib/cache';
import { cacheKeys } from '../../lib/cacheKeys';
import type { PageParams } from '../../lib/pagination';
import { getCourseBySlug, listPublishedCourses } from './course.repository';

/**
 * Course business logic. Reads go through the Redis cache-aside layer: the
 * catalog and course detail are identical for everyone and change rarely, so
 * caching them takes that load off Postgres. A loader that throws (404) is not
 * cached.
 */

const LIST_TTL = 60; // seconds — catalog list
const DETAIL_TTL = 300; // seconds — a single course

export function listCourses(params: PageParams) {
  const key = cacheKeys.courseList(params.cursor ?? '', params.limit ?? 20);
  return cacheAside(key, LIST_TTL, () => listPublishedCourses(params));
}

export function getCourse(slug: string) {
  return cacheAside(cacheKeys.course(slug), DETAIL_TTL, async () => {
    const course = await getCourseBySlug(slug);
    if (!course || !course.published) {
      throw AppError.notFound(`Course not found: ${slug}`);
    }
    return course;
  });
}

/**
 * Clear cached entries for a course. Called by write paths / event subscribers
 * when a course changes (admin edits arrive in a later phase). Clearing the
 * whole list prefix is coarse but correct — cursors make targeted list
 * invalidation impractical.
 */
export async function invalidateCourse(slug: string): Promise<void> {
  await invalidate(cacheKeys.course(slug));
  await invalidateByPrefix(cacheKeys.courseListPrefix);
}
