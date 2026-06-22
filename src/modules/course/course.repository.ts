import type { Course } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { buildPage, keysetParams, type Page, type PageParams } from '../../lib/pagination';

/**
 * Data access for the course catalog. Repositories isolate Prisma calls so the
 * rest of the app talks to intent-revealing functions, and so query shape (and
 * its performance) lives in one place.
 */

/** Published courses, keyset-paginated by id. */
export async function listPublishedCourses(params: PageParams): Promise<Page<Course>> {
  const { limit, take, cursorId } = keysetParams(params);

  const rows = await prisma.course.findMany({
    where: { published: true },
    orderBy: { id: 'asc' },
    take,
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}), // skip the cursor row itself
  });

  return buildPage(rows, limit, (c) => c.id);
}

/**
 * A course with its modules and each module's lessons, fetched in ONE query
 * via nested includes. The naive alternative — fetch the course, then loop
 * modules issuing a lessons query each — is the classic N+1 problem (1 + N
 * round-trips). `include` lets Prisma resolve it with a single batched query.
 * Heavy lesson `blocks` are omitted from this list view via `select`.
 */
export function getCourseBySlug(slug: string) {
  return prisma.course.findUnique({
    where: { slug },
    include: {
      modules: {
        orderBy: { order: 'asc' },
        include: {
          lessons: {
            orderBy: { order: 'asc' },
            select: {
              id: true,
              slug: true,
              title: true,
              level: true,
              duration: true,
              xp: true,
              order: true,
            },
          },
        },
      },
    },
  });
}
