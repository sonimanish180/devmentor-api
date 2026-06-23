import { prisma } from '../../lib/prisma';

/**
 * Fetch a single lesson with its full content (blocks/quiz are returned by
 * default). We also pull the parent module's course publish flag in the same
 * query so the service can enforce visibility without a second round-trip.
 */
export function getLessonById(id: string) {
  return prisma.lesson.findUnique({
    where: { id },
    include: {
      module: {
        select: {
          slug: true,
          course: { select: { slug: true, published: true } },
        },
      },
    },
  });
}
